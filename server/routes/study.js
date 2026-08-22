import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { DocumentService } from "../documents/index.js";
import { startSse, writeSse } from "../chat/shared.js";
import {
  GENERATE_MAX_MS,
  clampQuizCount,
  collectFlashcardModes,
  flashcardModeAllowed,
  generateFlashcards,
  generateQuiz,
  generateSummary,
  normalizeFlashcardMode,
  normalizeNoteMode,
  noteBody,
  noteModeAllowed,
  noteModesFromNotes,
  resolvedFlashcardMode
} from "../study/generate.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { requireChatContext } from "./context.js";
import { attachmentStorageKeys } from "./uploads.js";

// ponytail: in-process only — one Node process. Durable/DB lock if multi-replica duplicate generation becomes real.
const activeStudyGenerations = new Set();

async function requireCourse(context, courseId, signal) {
  const project = await context.db.getProject(context.user.id, courseId, { signal });
  if (!project || project.kind !== "course") throw new HttpError(404, "Course not found.");
  return project;
}

async function requireCourseSource(context, course, body, signal) {
  const documentFileId = typeof body.documentFileId === "string" ? body.documentFileId.trim() : "";
  const noteId = typeof body.noteId === "string" ? body.noteId.trim() : "";
  if (Boolean(documentFileId) === Boolean(noteId)) {
    throw new HttpError(400, "Provide exactly one of documentFileId or noteId.");
  }
  if (documentFileId) {
    const documentFile = await context.db.getDocumentFile(context.user.id, documentFileId, { signal });
    if (!documentFile || documentFile.project_id !== course.id) throw new HttpError(404, "Material not found.");
    if (!documentFile.text_ready_at && !documentFile.visual_ready_at) {
      throw new HttpError(409, "Material is still processing.");
    }
    return { documentFile };
  }
  const note = await context.db.getStudyNote(context.user.id, noteId, { signal });
  if (!note || note.project_id !== course.id) throw new HttpError(404, "Material not found.");
  return { note };
}

function publicQuiz(quiz) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  return {
    id: quiz.id,
    title: quiz.title || "",
    project_id: quiz.project_id,
    created_at: quiz.created_at,
    questions: questions.map((entry) => {
      const answer = Number(entry?.answer);
      const whys = Array.isArray(entry?.whys) ? entry.whys.map((why) => String(why || "")) : [];
      return {
        q: String(entry?.q || ""),
        topic: String(entry?.topic || ""),
        choices: Array.isArray(entry?.choices) ? entry.choices.map((choice) => String(choice || "")) : [],
        answer: Number.isInteger(answer) ? answer : null,
        explanation: String(entry?.explanation || ""),
        whys
      };
    })
  };
}

function documentTitle(documentFile) {
  return documentFile?.attachments?.file_name || documentFile?.file_name || "Document";
}

function cleanCardSide(value, label) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be a non-empty string.`);
  const text = value.trim();
  if (!text) throw new HttpError(400, `${label} must be a non-empty string.`);
  if (text.length > 2000) throw new HttpError(400, `${label} is too long.`);
  return text;
}

function courseMetaObject(course) {
  return course?.meta && typeof course.meta === "object" && !Array.isArray(course.meta) ? course.meta : {};
}

function deckTitlesFromMeta(meta) {
  const titles = meta?.deckTitles;
  return titles && typeof titles === "object" && !Array.isArray(titles) ? titles : {};
}

function flashcardModesFromMeta(meta) {
  const modes = meta?.flashcardModes;
  return modes && typeof modes === "object" && !Array.isArray(modes) ? { ...modes } : {};
}

function generationLockKey({ userId, courseId, type, source, mode }) {
  const src = source.documentFile
    ? `doc:${source.documentFile.id}`
    : `note:${source.note.id}`;
  let key = `${userId}:${courseId}:${src}:${type}`;
  if (type === "notes") key += `:${mode || "summary"}`;
  return key;
}

function endStudySse(res) {
  if (!res.writableEnded && !res.destroyed) {
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

function hiddenDocumentIdsFromMeta(meta) {
  return (Array.isArray(meta?.hiddenDocumentIds) ? meta.hiddenDocumentIds : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function sourceDeckInput(source) {
  return source.documentFile
    ? { documentFileId: source.documentFile.id }
    : { noteId: source.note.id };
}

function parseDeckSource(input = {}) {
  const documentFileId = typeof input.documentFileId === "string" ? input.documentFileId.trim() : "";
  const noteId = typeof input.noteId === "string" ? input.noteId.trim() : "";
  const manual = input.manual === true || input.manual === "1" || input.manual === "true";
  const count = Number(Boolean(documentFileId)) + Number(Boolean(noteId)) + Number(manual);
  if (count !== 1) throw new HttpError(400, "Provide exactly one of documentFileId, noteId, or manual.");
  return { documentFileId, noteId, manual };
}

function deckKey(source) {
  if (source.manual) return "manual";
  if (source.documentFileId) return `doc:${source.documentFileId}`;
  return `note:${source.noteId}`;
}

function cardBelongsToSource(card, { documentFileId, noteId } = {}) {
  if (documentFileId) return card.document_file_id === documentFileId;
  if (noteId) return card.note_id === noteId;
  return !card.document_file_id && !card.note_id;
}

function cleanDeckTitle(value) {
  if (typeof value !== "string") throw new HttpError(400, "title must be a non-empty string.");
  const title = value.trim();
  if (!title) throw new HttpError(400, "title must be a non-empty string.");
  if (title.length > 120) throw new HttpError(400, "title is too long.");
  return title;
}

export async function handleStudyCourseMaterials(req, res, config, courseId) {
  if (req.method !== "GET" && req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  if (req.method === "DELETE") {
    const body = await parseJsonBody(req);
    const documentFileId = typeof body.documentFileId === "string" ? body.documentFileId.trim() : "";
    if (!documentFileId) throw new HttpError(400, "documentFileId is required.");
    const documentFile = await context.db.getDocumentFile(context.user.id, documentFileId, { signal: req.signal });
    if (!documentFile || documentFile.project_id !== course.id) throw new HttpError(404, "Material not found.");
    const nested = Array.isArray(documentFile.attachments) ? documentFile.attachments[0] : documentFile.attachments;
    const attachmentId = documentFile.attachment_id || nested?.id;
    const attachment = attachmentId
      ? await context.db.getAttachment(context.user.id, attachmentId, { signal: req.signal })
      : null;
    if (attachment) {
      const keys = await attachmentStorageKeys(context, attachment, config, req.signal);
      if (keys.length) await context.r2.deleteObjects(keys, { signal: req.signal });
      // ponytail: keep the attachment/document_files rows so decks/quizzes stay keyed; course delete cascades them.
      if (Number(attachment.size_bytes) !== 0) {
        await context.db.updateAttachment(context.user.id, attachment.id, { size_bytes: 0 }, { signal: req.signal });
      }
    }
    const meta = courseMetaObject(course);
    const hiddenDocumentIds = hiddenDocumentIdsFromMeta(meta);
    if (!hiddenDocumentIds.includes(documentFileId)) hiddenDocumentIds.push(documentFileId);
    await context.db.updateProject(context.user.id, course.id, {
      meta: { ...meta, hiddenDocumentIds }
    }, { signal: req.signal });
    sendJson(res, 200, { ok: true });
    return;
  }
  const [documents, notes, cards] = await Promise.all([
    context.db.listProjectDocuments(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyCards(context.user.id, course.id, {
      select: "document_file_id,note_id",
      signal: req.signal
    })
  ]);
  const hidden = new Set(hiddenDocumentIdsFromMeta(courseMetaObject(course)));
  sendJson(res, 200, {
    documents: (documents || []).filter((doc) => !hidden.has(doc.id)),
    notes: notes || [],
    flashcardModes: collectFlashcardModes(courseMetaObject(course).flashcardModes, cards)
  });
}

export async function handleStudyCourseGenerate(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const type = String(body.type || "").trim() === "summary" ? "notes" : String(body.type || "").trim();
  if (!["flashcards", "quiz", "notes"].includes(type)) {
    throw new HttpError(400, "type must be flashcards, quiz, or notes.");
  }
  const source = await requireCourseSource(context, course, body, req.signal);

  let mode = null;
  let count = null;
  let existingFronts = [];
  if (type === "flashcards") {
    mode = normalizeFlashcardMode(body.mode);
    if (!mode) throw new HttpError(400, "mode must be rapid or deep.");
    const key = deckKey(sourceDeckInput(source));
    const listed = await context.db.listStudyCards(context.user.id, course.id, {
      select: "document_file_id,note_id,front",
      signal: req.signal
    }) || [];
    const mine = listed.filter((card) => source.documentFile
      ? card.document_file_id === source.documentFile.id
      : card.note_id === source.note.id);
    const meta = courseMetaObject(course);
    const current = resolvedFlashcardMode(flashcardModesFromMeta(meta)[key], mine.length > 0);
    if (!flashcardModeAllowed(current, mode)) {
      throw new HttpError(409, current === "deep"
        ? "Deep deck already created."
        : "Rapid already created. Use Deep for a full rundown.");
    }
    if (mode === "deep") existingFronts = mine.map((card) => card.front);
  } else if (type === "quiz") {
    count = clampQuizCount(body.count);
  } else {
    if (!source.documentFile) throw new HttpError(400, "Notes can only be generated from a file.");
    mode = normalizeNoteMode(body.mode) || "summary";
    const listed = await context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal });
    const existing = noteModesFromNotes(listed, source.documentFile.id);
    if (!noteModeAllowed(existing, mode)) {
      throw new HttpError(409, mode === "detailed"
        ? "Detailed review already created."
        : "Summary already created.");
    }
  }

  await createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  }).checkBudget(req.signal);

  const lockKey = generationLockKey({
    userId: context.user.id,
    courseId: course.id,
    type,
    source,
    mode
  });
  if (activeStudyGenerations.has(lockKey)) {
    throw new HttpError(409, type === "flashcards"
      ? "Flashcard generation is already in progress for this material."
      : "Generation is already in progress for this material.");
  }
  activeStudyGenerations.add(lockKey);

  const controller = new AbortController();
  let finished = false;
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const onReqAbort = () => abort(req.signal?.reason);
  const onClose = () => {
    if (!finished && !res.writableEnded) abort();
  };
  const maxRunMs = config.study?.maxRunMs || GENERATE_MAX_MS;
  const deadline = setTimeout(() => abort(new Error("study_request_timeout")), maxRunMs);
  const heartbeat = setInterval(() => {
    if (finished || res.writableEnded || res.destroyed) return;
    writeSse(res, { type: "heartbeat" });
  }, 15_000);

  if (req.signal?.aborted) abort(req.signal.reason);
  else if (req.signal) req.signal.addEventListener("abort", onReqAbort, { once: true });
  res.on("close", onClose);

  const signal = controller.signal;
  const emitStage = (stage) => writeSse(res, { type: "status", stage });
  let warning = null;
  const onWarning = (message) => {
    if (message) warning = String(message);
  };

  try {
    startSse(res);

    let result;
    if (type === "flashcards") {
      const cards = await generateFlashcards({
        context,
        config,
        course,
        source,
        mode,
        existingFronts,
        signal,
        onWarning,
        onStage: emitStage
      });
      const meta = courseMetaObject(course);
      const key = deckKey(sourceDeckInput(source));
      const completedMode = meta.flashcardModes?.[key] === "deep" || mode === "deep" ? "deep" : "rapid";
      const flashcardModes = {
        ...(meta.flashcardModes && typeof meta.flashcardModes === "object" ? meta.flashcardModes : {}),
        [key]: completedMode
      };
      await context.db.updateProject(context.user.id, course.id, {
        meta: { ...meta, flashcardModes }
      }, { signal });
      result = {
        type,
        count: cards.length,
        mode: completedMode,
        ...(warning ? { warning } : {})
      };
    } else if (type === "quiz") {
      const generated = await generateQuiz({
        context,
        config,
        course,
        source,
        count,
        signal,
        onWarning,
        onStage: emitStage
      });
      result = {
        type,
        id: generated.quiz.id,
        title: generated.quiz.title || "Quiz",
        count: Array.isArray(generated.quiz.questions) ? generated.quiz.questions.length : 0,
        ...(generated.partial ? { partial: true } : {}),
        ...(warning ? { warning } : {})
      };
    } else {
      const generated = await generateSummary({
        context,
        config,
        course,
        source,
        mode,
        signal,
        onWarning,
        onStage: emitStage
      });
      result = {
        type,
        id: generated.note.id,
        title: generated.note.title || "",
        mode: mode || "summary",
        ...(generated.partial ? { partial: true } : {}),
        ...(warning ? { warning } : {})
      };
    }

    writeSse(res, { type: "complete", result });
    finished = true;
    endStudySse(res);
  } catch (error) {
    finished = true;
    if (res.headersSent) {
      const aborted = signal.aborted || error?.name === "AbortError";
      const message = aborted
        ? "Generation cancelled."
        : (error instanceof HttpError ? error.message : (error?.message || "Generation failed, try again."));
      writeSse(res, { type: "error", error: message });
      endStudySse(res);
      return;
    }
    throw error;
  } finally {
    finished = true;
    clearTimeout(deadline);
    clearInterval(heartbeat);
    if (req.signal) req.signal.removeEventListener("abort", onReqAbort);
    if (typeof res.off === "function") res.off("close", onClose);
    else if (typeof res.removeListener === "function") res.removeListener("close", onClose);
    activeStudyGenerations.delete(lockKey);
  }
}

export async function handleStudyCoursePractice(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const [documents, notes, cards, quizzes] = await Promise.all([
    context.db.listProjectDocuments(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyCards(context.user.id, course.id, {
      select: "id,document_file_id,note_id",
      signal: req.signal
    }),
    context.db.listStudyQuizzes(context.user.id, course.id, { signal: req.signal })
  ]);
  const docTitles = new Map((documents || []).map((doc) => [doc.id, documentTitle(doc)]));
  const noteTitles = new Map((notes || []).map((note) => [note.id, note.title || "Note"]));
  const meta = courseMetaObject(course);
  const decks = new Map();
  const manualKey = "manual";
  for (const card of cards || []) {
    const key = card.document_file_id
      ? `doc:${card.document_file_id}`
      : card.note_id
        ? `note:${card.note_id}`
        : manualKey;
    const source = key === manualKey
      ? { manual: true }
      : card.document_file_id
        ? { documentFileId: card.document_file_id }
        : { noteId: card.note_id };
    const fallback = key === manualKey
      ? "Your cards"
      : card.document_file_id
        ? (docTitles.get(card.document_file_id) || "Document")
        : (noteTitles.get(card.note_id) || "Note");
    const deck = decks.get(key) || {
      id: key,
      ...source,
      title: String(deckTitlesFromMeta(meta)[key] || "").trim() || fallback,
      cardCount: 0
    };
    deck.cardCount += 1;
    decks.set(key, deck);
  }
  sendJson(res, 200, {
    decks: [...decks.values()],
    quizzes: (quizzes || []).map((quiz) => ({
      id: quiz.id,
      title: quiz.title || "",
      questionCount: Array.isArray(quiz.questions) ? quiz.questions.length : 0
    }))
  });
}

export async function handleStudyCourseCards(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const front = cleanCardSide(body.front, "front");
  const back = cleanCardSide(body.back, "back");
  const card = {
    project_id: course.id,
    front,
    back
  };
  const quizId = typeof body.quizId === "string" ? body.quizId.trim() : "";
  if (quizId) {
    const quiz = await context.db.getStudyQuiz(context.user.id, quizId, { signal: req.signal });
    if (!quiz || quiz.project_id !== course.id) throw new HttpError(404, "Quiz not found.");
    card.document_file_id = quiz.document_file_id || null;
    card.note_id = quiz.note_id || null;
    const listed = await context.db.listStudyCards(context.user.id, course.id, {
      select: "id,document_file_id,note_id,front,back",
      signal: req.signal
    }) || [];
    const existing = listed.find((row) => row.front === front && cardBelongsToSource(row, {
      documentFileId: card.document_file_id,
      noteId: card.note_id
    }));
    if (existing) {
      sendJson(res, 200, { card: existing });
      return;
    }
  }
  const cards = await context.db.createStudyCards(context.user.id, [card], { signal: req.signal });
  sendJson(res, 201, { card: cards[0] || null });
}

export async function handleStudyCourseQueue(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const params = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`).searchParams;
  const source = parseDeckSource({
    documentFileId: params.get("documentFileId") || "",
    noteId: params.get("noteId") || "",
    manual: params.get("manual") === "1" || params.get("manual") === "true"
  });
  const cards = (await context.db.listStudyCards(context.user.id, course.id, { signal: req.signal }) || []).filter((card) => (
    source.documentFileId ? card.document_file_id === source.documentFileId
      : source.noteId ? card.note_id === source.noteId
        : !card.document_file_id && !card.note_id
  ));
  sendJson(res, 200, {
    cards: cards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back
    }))
  });
}

export async function handleStudyCourseDecks(req, res, config, courseId) {
  if (req.method !== "PATCH" && req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const source = parseDeckSource(body);

  if (req.method === "PATCH") {
    const title = cleanDeckTitle(body.title);
    const meta = courseMetaObject(course);
    const deckTitles = { ...deckTitlesFromMeta(meta), [deckKey(source)]: title };
    await context.db.updateProject(context.user.id, course.id, {
      meta: { ...meta, deckTitles }
    }, { signal: req.signal });
    sendJson(res, 200, { title });
    return;
  }

  await context.db.deleteStudyCardsForSource(context.user.id, {
    projectId: course.id,
    documentFileId: source.documentFileId || undefined,
    noteId: source.noteId || undefined,
    manual: source.manual || undefined,
    signal: req.signal
  });
  const meta = courseMetaObject(course);
  const key = deckKey(source);
  const flashcardModes = flashcardModesFromMeta(meta);
  if (flashcardModes[key]) {
    delete flashcardModes[key];
    await context.db.updateProject(context.user.id, course.id, {
      meta: { ...meta, flashcardModes }
    }, { signal: req.signal });
  }
  sendJson(res, 200, { ok: true });
}

export async function handleStudyCard(req, res, config, cardId) {
  if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const card = await context.db.getStudyCard(context.user.id, cardId, { signal: req.signal });
  if (!card) throw new HttpError(404, "Card not found.");
  await requireCourse(context, card.project_id, req.signal);
  await context.db.deleteStudyCard(context.user.id, card.id, { signal: req.signal });
  sendJson(res, 200, { ok: true });
}

export async function handleStudyQuizById(req, res, config, quizId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const quiz = await context.db.getStudyQuiz(context.user.id, quizId, { signal: req.signal });
  if (!quiz) throw new HttpError(404, "Quiz not found.");
  await requireCourse(context, quiz.project_id, req.signal);
  const listed = await context.db.listStudyCards(context.user.id, quiz.project_id, {
    select: "document_file_id,note_id,front",
    signal: req.signal
  }) || [];
  const existingFronts = listed
    .filter((card) => cardBelongsToSource(card, {
      documentFileId: quiz.document_file_id,
      noteId: quiz.note_id
    }))
    .map((card) => card.front);
  sendJson(res, 200, { quiz: publicQuiz(quiz), existingFronts });
}

export async function handleStudyQuizAttempts(req, res, config, quizId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const quiz = await context.db.getStudyQuiz(context.user.id, quizId, { signal: req.signal });
  if (!quiz) throw new HttpError(404, "Quiz not found.");
  await requireCourse(context, quiz.project_id, req.signal);
  const body = await parseJsonBody(req);
  const submitted = Array.isArray(body.answers) ? body.answers : null;
  if (!submitted) throw new HttpError(400, "answers must be an array.");
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const answers = questions.map((_, index) => {
    const value = submitted[index];
    if (value === -1) return -1;
    const n = Number(value);
    return Number.isInteger(n) ? n : -1;
  });
  const results = questions.map((question, index) => {
    const answer = Number(question.answer);
    const yourAnswer = answers[index];
    return {
      correct: yourAnswer === answer,
      answer,
      yourAnswer,
      explanation: String(question.explanation || "")
    };
  });
  const score = results.filter((row) => row.correct).length;
  const total = questions.length;
  sendJson(res, 200, { score, total, results });
}

export async function handleStudyNote(req, res, config, noteId) {
  if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const note = await context.db.getStudyNote(context.user.id, noteId, { signal: req.signal });
  if (!note) throw new HttpError(404, "Note not found.");
  await requireCourse(context, note.project_id, req.signal);
  await context.db.deleteStudyNote(context.user.id, note.id, { signal: req.signal });
  sendJson(res, 200, { ok: true });
}

export async function handleStudyNoteExport(req, res, config, noteId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const note = await context.db.getStudyNote(context.user.id, noteId, { signal: req.signal });
  if (!note) throw new HttpError(404, "Note not found.");
  const body = await parseJsonBody(req);
  const format = String(body.format || "").toLowerCase();
  if (!["docx", "pdf"].includes(format)) throw new HttpError(400, "Export format must be docx or pdf.");
  const markdown = noteBody(note).trim();
  if (!markdown) throw new HttpError(400, "Note has no content.");
  const documents = new DocumentService({
    config,
    db: context.db,
    r2: context.r2,
    userId: context.user.id,
    conversationId: null,
    plan: context.plan,
    signal: req.signal
  });
  const result = await documents.enqueueAndWait({
    jobType: `document.create.${format}`,
    generatedCount: 1,
    input: {
      format,
      title: String(note.title || "Summary").trim() || "Summary",
      instructions: "",
      content: markdown,
      content_source: "study_note",
      sections: [],
      tables: [],
      data: {},
      editor_markdown: markdown
    }
  });
  const output = result.output || {};
  if (result.pending) {
    sendJson(res, 202, { status: "processing", jobId: result.job?.id || output.job_id });
    return;
  }
  if (!result.ok || !output.attachment_id) {
    throw new HttpError(502, result.error?.message || "Document export failed.");
  }
  sendJson(res, 200, {
    status: "ready",
    artifact: {
      attachment_id: output.attachment_id,
      file_name: output.file_name,
      format: output.kind
    }
  });
}
