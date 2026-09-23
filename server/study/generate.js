import { randomUUID } from "node:crypto";
import { HttpError } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL, resolveProvider } from "../providers.js";
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { salvageJsonObjects } from "./jsonSalvage.js";
import { enrichSourceWithSelectiveVision } from "./vision.js";

const GENERATE_MAX_MS = 10 * 60 * 1000;
const INACTIVITY_MS = 30_000;
const NOTE_CONTENT_CAP = 200_000;
const GENERATION_FAILED = "Generation failed, try again.";

function studyMeter(context, config, signal) {
  return createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  });
}

function stripFences(text) {
  return String(text || "").trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Aborted");
    error.name = "AbortError";
    error.cause = signal.reason;
    throw error;
  }
}

export function parseMarkdownNote(text, { fallbackTitle = "Summary" } = {}) {
  const content = stripFences(text);
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  let title = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const h1 = line.match(/^#\s+(.+)$/);
    if (h1) {
      title = h1[1].trim();
      bodyStart = i + 1;
    }
    break;
  }
  const body = lines.slice(bodyStart).join("\n").replace(/^\n+/, "").trimEnd();
  const saved = (title ? `# ${title}\n\n${body}` : content).trim();
  return {
    title: title || fallbackTitle,
    content: saved.slice(0, NOTE_CONTENT_CAP)
  };
}

export function parseStudyJson(text) {
  const cleaned = stripFences(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { value: parsed, partial: false };
    }
  } catch {
    // Fall through to brace-aware salvage.
  }
  const objects = salvageJsonObjects(cleaned);
  const preferred = objects.find((obj) => obj.cards || obj.flashcards || obj.questions || obj.title)
    || (objects.some((obj) => obj.front && obj.back)
      ? { cards: objects.filter((obj) => obj.front && obj.back) }
      : objects.some((obj) => (obj.q || obj.question) && (Array.isArray(obj.choices) || (obj.type === "short" && obj.modelAnswer)))
        ? { questions: objects.filter((obj) => (obj.q || obj.question) && (Array.isArray(obj.choices) || (obj.type === "short" && obj.modelAnswer))) }
        : objects[0]);
  if (preferred) return { value: preferred, partial: true };
  throw new HttpError(502, GENERATION_FAILED);
}

function createInactivityController(parentSignal, inactivityMs = INACTIVITY_MS) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }
  let timer = setTimeout(() => controller.abort(new Error("inactivity")), inactivityMs);
  const touch = () => {
    clearTimeout(timer);
    if (controller.signal.aborted) return;
    timer = setTimeout(() => controller.abort(new Error("inactivity")), inactivityMs);
  };
  const stop = () => {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  };
  return { signal: controller.signal, touch, stop, controller };
}

function visionModel(config) {
  return config?.study?.visionModel || OPENROUTER_VISION_MODEL;
}

async function streamComplete({
  context,
  config,
  signal,
  system,
  user,
  maxTokens = 4000,
  expect = "json"
}) {
  throwIfAborted(signal);
  const provider = resolveProvider("openrouter", config);
  const modelClient = studyMeter(context, config, signal);
  const gate = createInactivityController(signal, config.study?.inactivityMs || INACTIVITY_MS);
  let accumulated = null;
  try {
    const upstream = await modelClient.streamChatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: gate.signal,
      body: {
        model: OPENROUTER_TEXT_MODEL,
        reasoning: { enabled: false },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        max_tokens: maxTokens
      }
    });
    accumulated = await streamProviderAndAccumulate(upstream, () => gate.touch());
  } catch (error) {
    gate.stop();
    if (signal?.aborted) {
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      aborted.cause = signal.reason || error;
      throw aborted;
    }
    const partialContent = String(accumulated?.content || error?.partial?.content || "").trim();
    if (partialContent && (expect === "markdown" || expect === "json") && error?.name !== "AbortError") {
      return {
        content: partialContent,
        finishReason: accumulated?.finishReason || "length",
        partial: true
      };
    }
    if (error instanceof HttpError) throw error;
    if (gate.signal.aborted) {
      throw new HttpError(504, "Study generation timed out. Try again.");
    }
    throw new HttpError(502, GENERATION_FAILED);
  }
  gate.stop();
  throwIfAborted(signal);
  const content = String(accumulated?.content || "");
  if (!content.trim()) throw new HttpError(502, GENERATION_FAILED);
  return {
    content,
    finishReason: accumulated.finishReason || "stop",
    partial: accumulated.finishReason === "length"
  };
}

async function streamVisionBatch({ context, config, signal, pages }) {
  throwIfAborted(signal);
  const provider = resolveProvider("openrouter", config);
  const modelClient = studyMeter(context, config, signal);
  const gate = createInactivityController(signal, config.study?.inactivityMs || INACTIVITY_MS);
  const content = [
    {
      type: "text",
      text: [
        "Transcribe the attached study document page images.",
        "For each page, start with a line `Page N:` using the real page number.",
        "Provide a clean transcription of visible text plus a factual description of charts, diagrams, and figures.",
        "Do not invent content that is not visible."
      ].join(" ")
    },
    ...pages.flatMap((page) => ([
      { type: "text", text: `Page ${page.pageNumber}:` },
      { type: "image_url", image_url: { url: page.url } }
    ]))
  ];
  try {
    const upstream = await modelClient.streamChatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: gate.signal,
      body: {
        model: visionModel(config),
        reasoning: { enabled: false },
        messages: [{ role: "user", content }],
        temperature: 0.1,
        max_tokens: Math.min(16000, Math.max(2000, pages.length * 1400))
      }
    });
    const accumulated = await streamProviderAndAccumulate(upstream, () => gate.touch());
    gate.stop();
    throwIfAborted(signal);
    return String(accumulated.content || "").trim();
  } catch (error) {
    gate.stop();
    if (signal?.aborted) {
      const aborted = new Error("Aborted");
      aborted.name = "AbortError";
      aborted.cause = signal.reason || error;
      throw aborted;
    }
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, GENERATION_FAILED);
  }
}

export async function loadMaterialText(db, userId, { documentFile, note, signal } = {}) {
  if (note) return noteBody(note).trim();
  if (!documentFile?.id) return "";
  const chunks = await db.listDocumentChunksForFiles(userId, [documentFile.id], {
    limit: 5000,
    signal
  });
  return (chunks || []).map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join("\n").trim();
}

function fileDisplayName(file) {
  const nested = Array.isArray(file?.attachments) ? file.attachments[0] : file?.attachments;
  return nested?.file_name || file?.file_name || "Document";
}

function comboDeckKey() {
  return `combo_${randomUUID()}`;
}

async function loadComboSourceText({ context, source, signal }) {
  const files = source.documentFiles || [];
  const ids = files.map((file) => file.id).filter(Boolean);
  const chunks = await context.db.listDocumentChunksForFiles(context.user.id, ids, {
    limit: 5000,
    signal
  }) || [];
  const parts = [];
  for (const file of files) {
    const text = chunks
      .filter((chunk) => chunk.document_file_id === file.id)
      .map((chunk) => String(chunk.text || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) parts.push(`--- ${fileDisplayName(file)} ---\n${text}`);
  }
  const joined = parts.join("\n\n").trim();
  if (!joined) throw new HttpError(400, "Material has no extracted text.");
  // ponytail: dump-join, no vision; retrieve/cap per file if 5 fat PDFs start failing the model.
  return joined.slice(0, NOTE_CONTENT_CAP);
}

async function loadGenerationSourceText({ context, config, source, signal, onWarning, onStage }) {
  if (source.documentFiles?.length) return loadComboSourceText({ context, source, signal });
  if (source.note) {
    const text = noteBody(source.note).trim();
    if (!text) throw new HttpError(400, "Material has no extracted text.");
    return text;
  }
  const documentFile = source.documentFile;
  const chunks = await context.db.listDocumentChunksForFiles(context.user.id, [documentFile.id], {
    limit: 5000,
    signal
  }) || [];
  let text = "";
  let warning = null;
  if (documentFile.kind === "pdf" || documentFile.kind === "pptx" || documentFile.visual_ready_at) {
    const enriched = await enrichSourceWithSelectiveVision({
      context,
      config,
      documentFile,
      chunks,
      signal,
      onStage,
      streamVision: ({ pages, signal: visionSignal }) => streamVisionBatch({
        context,
        config,
        signal: visionSignal,
        pages
      })
    });
    text = enriched.text;
    warning = enriched.warning;
  } else {
    text = chunks.map((chunk) => String(chunk.text || "").trim()).filter(Boolean).join("\n").trim();
  }
  if (!text) throw new HttpError(400, "Material has no extracted text.");
  if (warning && onWarning) onWarning(warning);
  return text;
}

const FLASHCARD_CAPS = { rapid: 50, deep: 250 };

function clampPick(count, allowed) {
  const n = Number(count);
  return allowed.includes(n) ? n : allowed[0];
}

export function clampQuizCount(count) {
  return clampPick(count, [10, 5, 15, 20, 25]);
}

export function normalizeFlashcardMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "rapid" || mode === "deep" ? mode : "";
}

export function resolvedFlashcardMode(stored, hasCards) {
  if (!hasCards) return "";
  return normalizeFlashcardMode(stored) || "rapid";
}

export function flashcardModeAllowed(current, requested) {
  const next = normalizeFlashcardMode(requested);
  if (!next) return false;
  if (current === "deep") return false;
  if (next === "rapid" && current === "rapid") return false;
  return true;
}

export const DETAILED_NOTE_MARK = "<!--klui:detailed-->";

export function normalizeNoteMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "summary" || mode === "detailed" || mode === "mindmap" ? mode : "";
}

export function isDetailedNote(note) {
  if (!note) return false;
  if (note.kind === "detailed") return true;
  return String(note.content || "").startsWith(DETAILED_NOTE_MARK);
}

export function noteBody(note) {
  const text = String(note?.content || "");
  return text.replace(/^<!--klui:(?:detailed|mindmap)-->\n?/, "");
}

export function noteModesFromNotes(notes, documentFileId) {
  const modes = { summary: false, detailed: false };
  if (!documentFileId) return modes;
  for (const note of notes || []) {
    if (note.document_file_id !== documentFileId) continue;
    if (note.kind === "image_transcript") continue;
    if (String(note.content || "").startsWith("<!--klui:mindmap-->")) modes.mindmap = true;
    else if (isDetailedNote(note)) modes.detailed = true;
    else if (note.kind === "summary") modes.summary = true;
  }
  return modes;
}

export function noteModeAllowed(existing, requested) {
  const next = normalizeNoteMode(requested);
  if (!next) return false;
  return !existing?.[next];
}

export function collectFlashcardModes(stored, cards) {
  const bag = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const has = new Set();
  for (const card of cards || []) {
    if (card.deck_key) has.add(card.deck_key);
    else if (card.document_file_id) has.add(`doc:${card.document_file_id}`);
    else if (card.note_id) has.add(`note:${card.note_id}`);
  }
  const modes = {};
  for (const key of new Set([...Object.keys(bag), ...has])) {
    const mode = resolvedFlashcardMode(bag[key], has.has(key));
    if (mode) modes[key] = mode;
  }
  return modes;
}

export function cleanCards(parsed, max = FLASHCARD_CAPS.rapid, cardType = "") {
  const pairs = Array.isArray(parsed.cards) ? parsed.cards : Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  return pairs.flatMap((entry) => {
    let front = String(entry?.front || "").trim();
    let back = String(entry?.back || "").trim();
    if (!front || !back || (cardType === "basic" && (front.includes("___") || entry?.choices?.length)) || (cardType === "cloze" && (!front.includes("___") || entry?.choices?.length))) return [];
    if (cardType === "mcq") {
      const choices = Array.isArray(entry.choices) ? entry.choices.map(choice => String(choice || "").trim()) : [];
      const answer = entry.answer;
      if (choices.length !== 4 || choices.some(choice => !choice) || new Set(choices).size !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) return [];
      front += `\n\n${choices.map((choice, index) => `${"ABCD"[index]}. ${choice}`).join("\n")}`;
      back = `${"ABCD"[answer]}. ${choices[answer]}\n\n${back}`;
    }
    return [{ front, back }];
  }).slice(0, max);
}

export function cleanQuestions(parsed, count, examType = "mixed") {
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rows.flatMap((entry) => {
    const q = String(entry?.q || entry?.question || "").trim();
    if (entry?.type === "short") {
      if (examType === "mcq") return [];
      const modelAnswer = String(entry.modelAnswer || "").trim();
      if (!q || !modelAnswer) return [];
      return [{ q, type: "short", topic: String(entry.topic || "").trim(), choices: [modelAnswer, "Needs more practice"], answer: 0, explanation: String(entry.explanation || ""), whys: [] }];
    }
    if (examType === "short") return [];
    const choices = (Array.isArray(entry?.choices) ? entry.choices : [])
      .map((choice) => String(choice || "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const answer = Number(entry?.answer);
    if (!q || choices.length !== 4 || new Set(choices).size !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) return [];
    const whys = choices.map((_, index) => String(entry?.whys?.[index] || "").trim());
    const explanation = String(entry?.explanation || whys[answer] || "").trim();
    const topic = String(entry?.topic || "").trim();
    return [{ q, topic, choices, answer, explanation, whys }];
  }).slice(0, count);
  if (questions.length < Math.min(count, 1)) throw new HttpError(502, GENERATION_FAILED);
  return questions;
}

function sourceFallbackTitle(source) {
  if (source.documentFiles?.length) {
    const joined = source.documentFiles.map((file) => fileDisplayName(file)).join(", ");
    return joined.length > 120 ? `${joined.slice(0, 117)}...` : (joined || "Quiz");
  }
  if (source.documentFile) return fileDisplayName(source.documentFile);
  return String(source.note?.title || "Note").trim() || "Note";
}

export function studyGenerationGuidance(options = {}, type = "") {
  const difficulty = ["easy", "medium", "hard"].includes(options.difficulty) ? options.difficulty : "medium";
  const levels = {
    easy: "Test direct recall of facts and definitions, one concept at a time.",
    medium: "Ask learners to apply concepts to familiar examples and explain relationships.",
    hard: "Require analysis, synthesis, and multi-step reasoning using source-supported scenarios; avoid obscure trivia."
  };
  const formats = {
    basic: "Use question-and-answer cards only.",
    cloze: "Use fill-in-the-blank cards only: front contains ___ and back contains the missing text.",
    mcq: 'Use multiple-choice cards only. Return each card as {"front":"question without choices","choices":["choice A","choice B","choice C","choice D"],"answer":0,"back":"brief explanation"}. Use four distinct choices and a zero-based answer index.'
  };
  const styles = type === "notes" || type === "mindmap"
    ? { concise: "Keep headings and explanations short and direct.", exam: "Prioritize exam-style, testable ideas and applications.", conceptual: "Emphasize conceptual connections and relationships." }
    : { concise: "Keep questions and explanations concise.", exam: "Use exam-style application scenarios.", conceptual: "Emphasize conceptual connections and reasoning." };
  const style = Object.hasOwn(styles, options.style) ? styles[options.style] : "";
  const focus = typeof options.focus === "string" ? options.focus.trim().slice(0, 1000) : "";
  const level = type === "notes" || type === "mindmap" ? "" : `difficulty ${difficulty}. ${levels[difficulty]}`;
  return `\n\nStudy preferences: ${level} ${style} ${type === "flashcards" ? (Object.hasOwn(formats, options.cardType) ? formats[options.cardType] : "") : ""}${focus ? `\nFocus on: ${focus}` : ""}\nUse only supported facts from the source material.`;
}

export function studyQuizSystemPrompt(questionCount, examType, options = {}) {
  const mcq = '{"q":"...","topic":"short concept","choices":["A","B","C","D"],"answer":0,"whys":["why A","why B","why C","why D"]}';
  const short = '{"type":"short","q":"...","topic":"short concept","modelAnswer":"concise reference answer","explanation":"..."}';
  const mcqRules = "Multiple-choice questions need four distinct choices, a zero-based answer index, and four brief whys explaining the correct and incorrect choices.";
  const format = examType === "short"
    ? `Every question must be short answer in this shape: ${short}. Do not include multiple-choice questions.`
    : examType === "mixed"
      ? `Include exactly ${Math.floor(questionCount / 2)} short-answer questions in this shape: ${short}, and ${Math.ceil(questionCount / 2)} multiple-choice questions in this shape: ${mcq}. ${mcqRules}`
      : `Every question must be multiple choice in this shape: ${mcq}. Do not include short-answer questions. ${mcqRules}`;
  return `You create a practice test from source material. Produce exactly ${questionCount} questions. Return ONLY valid JSON: {"title":"...","questions":[...]}. No markdown, no commentary. ${format}${studyGenerationGuidance(options, "quiz")}`;
}

export async function generateFlashcards({
  context,
  config,
  course,
  source,
  options = {},
  mode,
  existingFronts = [],
  signal,
  onWarning,
  onStage
}) {
  onStage?.("preparing");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage });
  throwIfAborted(signal);
  const requested = normalizeFlashcardMode(mode) || "rapid";
  const cardCap = FLASHCARD_CAPS[requested];
  const skip = (existingFronts || [])
    .map((front) => String(front || "").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, FLASHCARD_CAPS.deep);
  const deep = requested === "deep";
  const system = deep
    ? `You create a Deep study deck from source material. First plan the complete relevant coverage, then fit it into no more than ${cardCap} cards. Cover every concept, definition, example, exception, process step, and detail needed to fully know the material. If necessary, combine closely related subpoints in one clear card rather than omitting relevant material. Do not create padding just to reach the limit. Follow the requested card format. If none is specified, mix short Q&A with fill-in-the-blank (front uses ___; back is the missing text). Return ONLY valid JSON: {"cards":[{"front":"...","back":"..."}]}; for multiple-choice cards also include choices and answer as specified. No markdown, no commentary.`
    : `You create a Rapid review deck from source material. First identify and rank the most important concepts, definitions, formulas, processes, and facts, then fit that essential coverage into no more than ${cardCap} cards. Prefer broad exam-relevant understanding, combine closely related points when clear, and omit trivia, repetition, and padding. Do not create extra cards just to reach the limit. Follow the requested card format. If none is specified, mix short Q&A with fill-in-the-blank (front uses ___; back is the missing text). Return ONLY valid JSON: {"cards":[{"front":"...","back":"..."}]}; for multiple-choice cards also include choices and answer as specified. No markdown, no commentary.`;
  const user = skip.length
    ? `${text}\n\nExisting card fronts (do not repeat or paraphrase):\n${skip.map((front) => `- ${front}`).join("\n")}`
    : text;
  onStage?.("generating");
  const streamed = await streamComplete({
    context,
    config,
    signal,
    maxTokens: deep ? 16000 : 14000,
    system: system + studyGenerationGuidance(options, "flashcards"),
    user,
    expect: "json"
  });
  throwIfAborted(signal);
  const parsed = parseStudyJson(streamed.content);
  const cards = cleanCards(parsed.value, cardCap, options.cardType);
  if (!cards.length) throw new HttpError(502, GENERATION_FAILED);
  onStage?.("saving");
  throwIfAborted(signal);
  const deckKey = source.documentFiles?.length ? comboDeckKey() : null;
  return context.db.createStudyCards(context.user.id, cards.map((card) => ({
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    note_id: source.note?.id || null,
    ...(deckKey ? { deck_key: deckKey } : {}),
    front: card.front,
    back: card.back
  })), { signal });
}

export async function generateQuiz({
  context,
  config,
  course,
  source,
  options = {},
  count,
  signal,
  onWarning,
  onStage
}) {
  onStage?.("preparing");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage });
  throwIfAborted(signal);
  const questionCount = clampQuizCount(count);
  const examType = ["mixed", "short", "mcq"].includes(options.examType) ? options.examType : "mcq";
  onStage?.("generating");
  const streamed = await streamComplete({
    context,
    config,
    signal,
    maxTokens: 16000,
    system: studyQuizSystemPrompt(questionCount, examType, options),
    user: text,
    expect: "json"
  });
  throwIfAborted(signal);
  const parsed = parseStudyJson(streamed.content);
  const questions = cleanQuestions(parsed.value, questionCount, examType);
  if (examType === "mixed" && (!questions.some(question => question.type === "short") || !questions.some(question => question.type !== "short"))) {
    throw new HttpError(502, "The test did not include both question formats. Please try again.");
  }
  const title = String(parsed.value.title || sourceFallbackTitle(source) || "Quiz").trim() || "Quiz";
  const partial = Boolean(parsed.partial || streamed.partial || streamed.finishReason === "length" || questions.length < questionCount);
  onStage?.("saving");
  throwIfAborted(signal);
  const deckKey = source.documentFiles?.length ? comboDeckKey() : null;
  const quiz = await context.db.createStudyQuiz(context.user.id, {
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    note_id: source.note?.id || null,
    ...(deckKey ? { deck_key: deckKey } : {}),
    title,
    questions
  }, { signal });
  return { quiz, partial };
}

export async function generateSummary({
  context,
  config,
  course,
  source,
  options = {},
  mode,
  signal,
  onWarning,
  onStage
}) {
  onStage?.("preparing");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage });
  throwIfAborted(signal);
  const requested = normalizeNoteMode(mode) || "summary";
  const detailed = requested === "detailed";
  const mindmap = requested === "mindmap";
  const fallbackTitle = sourceFallbackTitle(source);
  onStage?.("generating");
  const streamed = await streamComplete({
    context,
    config,
    signal,
    maxTokens: detailed ? 16000 : 4000,
    system: (mindmap
      ? "Create a concise concept map from the source material as markdown. Start with one # title. Use 3–8 ## branches for major concepts, each followed by 2–5 short bullet points for connected ideas. Keep each node under 15 words. Capture relationships and hierarchy; use only facts supported by the sources. No code fences or commentary."
      : detailed
      ? "You write a detailed study review from source material. Reply with clean markdown only — no JSON wrapper and no commentary. Start with a single H1 title. Cover every topic, definition, process, and example a student needs to know this chapter. Keep it readable and concise — thorough, not a dump."
      : "You write a brief study summary from source material. Reply with clean markdown only — no JSON wrapper and no commentary. Start with a single H1 title. Cover the most important concepts only. Skip trivia.") + studyGenerationGuidance(options, mindmap ? "mindmap" : "notes"),
    user: text,
    expect: "markdown"
  });
  throwIfAborted(signal);
  const parsed = parseMarkdownNote(streamed.content, {
    fallbackTitle: detailed ? fallbackTitle : (fallbackTitle || "Summary")
  });
  if (!parsed?.content) throw new HttpError(502, GENERATION_FAILED);
  const partial = Boolean(streamed.partial || streamed.finishReason === "length");
  onStage?.("saving");
  throwIfAborted(signal);
  const note = await context.db.createStudyNote(context.user.id, {
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    kind: "summary",
    title: parsed.title || (detailed ? "Detailed review" : "Summary"),
    content: mindmap ? `<!--klui:mindmap-->\n${parsed.content}` : detailed ? `${DETAILED_NOTE_MARK}\n${parsed.content}` : parsed.content
  }, { signal });
  return { note, partial };
}

export async function transcribeCourseImage({ context, config, course, attachment, signal }) {
  const provider = resolveProvider("openrouter", config);
  const modelClient = studyMeter(context, config, signal);
  const imageUrl = context.r2.readUrl(attachment.object_key);
  const absolute = AbortSignal.timeout(30_000);
  const gate = createInactivityController(
    signal ? AbortSignal.any([signal, absolute]) : absolute,
    INACTIVITY_MS
  );
  let content;
  try {
    const upstream = await modelClient.streamChatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: gate.signal,
      body: {
        model: visionModel(config),
        reasoning: { enabled: false },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Transcribe all text and describe any diagrams in this image of study notes, as clean organized markdown." },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }],
        temperature: 0.1,
        max_tokens: 4000
      }
    });
    const accumulated = await streamProviderAndAccumulate(upstream, () => gate.touch());
    content = accumulated.content;
  } catch (error) {
    gate.stop();
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, GENERATION_FAILED);
  }
  gate.stop();
  const markdown = String(content || "").trim();
  if (!markdown) throw new HttpError(502, GENERATION_FAILED);
  return context.db.createStudyNote(context.user.id, {
    project_id: course.id,
    kind: "image_transcript",
    title: String(attachment.file_name || "Image notes").trim() || "Image notes",
    content: markdown
  }, { signal });
}

export { createInactivityController, GENERATE_MAX_MS };
