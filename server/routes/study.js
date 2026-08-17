import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { gradeCard } from "../study/fsrs.js";
import {
  generateFlashcards,
  generateQuiz,
  generateSummary,
  scaffoldCourseMeta
} from "../study/generate.js";
import { requireChatContext } from "./context.js";

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
    if (!documentFile.text_ready_at) throw new HttpError(409, "Material is still processing.");
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
    questions: questions.map((entry) => ({
      q: String(entry?.q || ""),
      choices: Array.isArray(entry?.choices) ? entry.choices.map((choice) => String(choice || "")) : []
    }))
  };
}

function documentTitle(documentFile) {
  return documentFile?.attachments?.file_name || documentFile?.file_name || "Document";
}

function flattenQuizAttempt(attempt) {
  if (!attempt) return null;
  const nested = attempt.study_quizzes;
  const { study_quizzes, ...rest } = attempt;
  return { ...rest, title: nested?.title || attempt.title || "" };
}

function cleanCardSide(value, label) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be a non-empty string.`);
  const text = value.trim();
  if (!text) throw new HttpError(400, `${label} must be a non-empty string.`);
  if (text.length > 2000) throw new HttpError(400, `${label} is too long.`);
  return text;
}

export async function handleStudyCourseOverview(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const now = Date.now();
  const [documents, notes, cards, quizzes, attempts, reviewRows] = await Promise.all([
    context.db.listProjectDocuments(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyCards(context.user.id, course.id, {
      select: "id,document_file_id,note_id,due_at",
      signal: req.signal
    }),
    context.db.listStudyQuizzes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyQuizAttempts(context.user.id, { projectId: course.id, signal: req.signal }),
    context.db.listRecentStudyReviewDates(context.user.id, { signal: req.signal })
  ]);
  const meta = course.meta && typeof course.meta === "object" && !Array.isArray(course.meta) ? course.meta : {};
  sendJson(res, 200, {
    course,
    dueCount: (cards || []).filter((card) => card.due_at && new Date(card.due_at).getTime() <= now).length,
    reviewDates: (reviewRows || []).map((row) => row.reviewed_at).filter(Boolean),
    deadlines: Array.isArray(meta.deadlines) ? meta.deadlines : [],
    counts: {
      materials: (documents || []).length,
      cards: (cards || []).length,
      quizzes: (quizzes || []).length,
      notes: (notes || []).length
    },
    latestQuizAttempt: flattenQuizAttempt(attempts?.[0])
  });
}

export async function handleStudyCourseMaterials(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const [documents, notes] = await Promise.all([
    context.db.listProjectDocuments(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal })
  ]);
  sendJson(res, 200, { documents: documents || [], notes: notes || [] });
}

export async function handleStudyCourseGenerate(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const type = String(body.type || "").trim();
  if (!["flashcards", "quiz", "summary"].includes(type)) {
    throw new HttpError(400, "type must be flashcards, quiz, or summary.");
  }
  const source = await requireCourseSource(context, course, body, req.signal);
  const params = { context, config, course, source, signal: req.signal };
  if (type === "flashcards") {
    const cards = await generateFlashcards(params);
    sendJson(res, 200, { cards });
    return;
  }
  if (type === "quiz") {
    const quiz = await generateQuiz({ ...params, count: body.count });
    sendJson(res, 200, { quiz });
    return;
  }
  const note = await generateSummary(params);
  sendJson(res, 200, { note });
}

export async function handleStudyCoursePractice(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const now = Date.now();
  const [documents, notes, cards, quizzes, attempts] = await Promise.all([
    context.db.listProjectDocuments(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyNotes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyCards(context.user.id, course.id, {
      select: "id,document_file_id,note_id,due_at",
      signal: req.signal
    }),
    context.db.listStudyQuizzes(context.user.id, course.id, { signal: req.signal }),
    context.db.listStudyQuizAttempts(context.user.id, { projectId: course.id, signal: req.signal })
  ]);
  const docTitles = new Map((documents || []).map((doc) => [doc.id, documentTitle(doc)]));
  const noteTitles = new Map((notes || []).map((note) => [note.id, note.title || "Note"]));
  const decks = new Map();
  const manualKey = "manual";
  for (const card of cards || []) {
    const key = card.document_file_id
      ? `doc:${card.document_file_id}`
      : card.note_id
        ? `note:${card.note_id}`
        : manualKey;
    const deck = decks.get(key) || {
      ...(key === manualKey
        ? { manual: true, title: "Your cards" }
        : card.document_file_id
          ? { documentFileId: card.document_file_id, title: docTitles.get(card.document_file_id) || "Document" }
          : { noteId: card.note_id, title: noteTitles.get(card.note_id) || "Note" }),
      cardCount: 0,
      dueCount: 0
    };
    deck.cardCount += 1;
    if (card.due_at && new Date(card.due_at).getTime() <= now) deck.dueCount += 1;
    decks.set(key, deck);
  }
  const attemptsByQuiz = new Map();
  for (const attempt of attempts || []) {
    const list = attemptsByQuiz.get(attempt.quiz_id) || [];
    list.push(attempt);
    attemptsByQuiz.set(attempt.quiz_id, list);
  }
  sendJson(res, 200, {
    decks: [...decks.values()],
    quizzes: (quizzes || []).map((quiz) => {
      const quizAttempts = attemptsByQuiz.get(quiz.id) || [];
      const scores = quizAttempts.map((attempt) => Number(attempt.score) || 0);
      return {
        id: quiz.id,
        title: quiz.title || "",
        questionCount: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
        bestScore: scores.length ? Math.max(...scores) : null,
        lastScore: scores.length ? Number(quizAttempts[0].score) || 0 : null
      };
    })
  });
}

export async function handleStudyCourseCards(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const front = cleanCardSide(body.front, "front");
  const back = cleanCardSide(body.back, "back");
  const cards = await context.db.createStudyCards(context.user.id, [{
    project_id: course.id,
    front,
    back,
    state: "new",
    due_at: new Date().toISOString()
  }], { signal: req.signal });
  sendJson(res, 201, { card: cards[0] || null });
}

export async function handleStudyCourseQueue(req, res, config, courseId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const cards = await context.db.listDueStudyCards(
    context.user.id,
    course.id,
    new Date().toISOString(),
    100,
    { signal: req.signal }
  );
  sendJson(res, 200, {
    cards: (cards || []).map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      state: card.state
    }))
  });
}

export async function handleStudyCardReview(req, res, config, cardId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new HttpError(400, "rating must be 1, 2, 3, or 4.");
  }
  const card = await context.db.getStudyCard(context.user.id, cardId, { signal: req.signal });
  if (!card) throw new HttpError(404, "Card not found.");
  await requireCourse(context, card.project_id, req.signal);
  const now = new Date();
  const graded = gradeCard(card, rating, now);
  const updated = await context.db.updateStudyCard(context.user.id, card.id, graded, { signal: req.signal });
  await context.db.createStudyReview(context.user.id, {
    card_id: card.id,
    rating,
    reviewed_at: now.toISOString()
  }, { signal: req.signal });
  sendJson(res, 200, {
    card: {
      id: updated?.id || card.id,
      due_at: updated?.due_at || graded.due_at,
      state: updated?.state || graded.state
    }
  });
}

export async function handleStudyQuizById(req, res, config, quizId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const quiz = await context.db.getStudyQuiz(context.user.id, quizId, { signal: req.signal });
  if (!quiz) throw new HttpError(404, "Quiz not found.");
  await requireCourse(context, quiz.project_id, req.signal);
  sendJson(res, 200, { quiz: publicQuiz(quiz) });
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
  await context.db.createStudyQuizAttempt(context.user.id, {
    quiz_id: quiz.id,
    answers,
    score,
    total
  }, { signal: req.signal });
  sendJson(res, 200, { score, total, results });
}

export async function handleStudyCourseScaffold(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const documentFileId = typeof body.documentFileId === "string" ? body.documentFileId.trim() : "";
  if (!documentFileId) throw new HttpError(400, "documentFileId is required.");
  const documentFile = await context.db.getDocumentFile(context.user.id, documentFileId, { signal: req.signal });
  if (!documentFile || documentFile.project_id !== course.id) throw new HttpError(404, "Material not found.");
  if (!documentFile.text_ready_at) throw new HttpError(409, "Material is still processing.");
  const meta = await scaffoldCourseMeta({
    context,
    config,
    course,
    documentFile,
    signal: req.signal
  });
  sendJson(res, 200, { meta });
}
