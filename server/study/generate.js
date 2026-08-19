import { HttpError } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL, resolveProvider } from "../providers.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";

const SOURCE_CHAR_LIMIT = 40_000;
const GENERATE_TIMEOUT_MS = 60_000;
const VISION_TIMEOUT_MS = 30_000;
const GENERATION_FAILED = "Generation failed, try again.";

function studyMeter(context, config, signal) {
  return createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: config.desktop.chatReservationCredits
  });
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const sliced = unfenced.match(/\{[\s\S]*\}/)?.[0] || unfenced;
  try {
    const parsed = JSON.parse(sliced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to the shared generation-failed error.
  }
  throw new HttpError(502, GENERATION_FAILED);
}

async function completeJson({ context, config, signal, system, user, maxTokens = 4000, timeoutMs = GENERATE_TIMEOUT_MS }) {
  const provider = resolveProvider("openrouter", config);
  const crofai = studyMeter(context, config, signal);
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let content;
  try {
    content = await crofai.chatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: callSignal,
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
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (callSignal.aborted && !signal?.aborted) throw new HttpError(504, "Study generation timed out. Try again.");
    throw new HttpError(502, GENERATION_FAILED);
  }
  return parseJsonObject(content);
}

export async function loadMaterialText(db, userId, { documentFile, note, signal } = {}) {
  if (note) return String(note.content || "").trim().slice(0, SOURCE_CHAR_LIMIT);
  if (!documentFile?.id) return "";
  const chunks = await db.listDocumentChunksForFiles(userId, [documentFile.id], {
    limit: 2000,
    signal
  });
  let text = "";
  for (const chunk of chunks || []) {
    const piece = String(chunk.text || "");
    if (!piece) continue;
    if (text.length + piece.length + 1 >= SOURCE_CHAR_LIMIT) {
      text += `${text ? "\n" : ""}${piece.slice(0, SOURCE_CHAR_LIMIT - text.length)}`;
      break;
    }
    text += `${text ? "\n" : ""}${piece}`;
  }
  return text.trim();
}

function clampPick(count, allowed) {
  const n = Number(count);
  return allowed.includes(n) ? n : allowed[0];
}

export function clampQuizCount(count) {
  return clampPick(count, [10, 15, 25]);
}

function cleanCards(parsed, count) {
  const pairs = Array.isArray(parsed.cards) ? parsed.cards : Array.isArray(parsed.flashcards) ? parsed.flashcards : [];
  const cards = pairs.flatMap((entry) => {
    const front = String(entry?.front || "").trim();
    const back = String(entry?.back || "").trim();
    return front && back ? [{ front, back }] : [];
  }).slice(0, count);
  if (!cards.length) throw new HttpError(502, GENERATION_FAILED);
  return cards;
}

function cleanQuestions(parsed, count) {
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = rows.flatMap((entry) => {
    const q = String(entry?.q || entry?.question || "").trim();
    const choices = (Array.isArray(entry?.choices) ? entry.choices : [])
      .map((choice) => String(choice || "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const answer = Number(entry?.answer);
    const explanation = String(entry?.explanation || "").trim();
    if (!q || choices.length !== 4 || !Number.isInteger(answer) || answer < 0 || answer > 3) return [];
    return [{ q, choices, answer, explanation }];
  }).slice(0, count);
  if (questions.length < Math.min(count, 1)) throw new HttpError(502, GENERATION_FAILED);
  return questions;
}

export async function generateFlashcards({ context, config, course, source, count, signal }) {
  const text = await loadMaterialText(context.db, context.user.id, { ...source, signal });
  if (!text) throw new HttpError(400, "Material has no extracted text.");
  const cardCount = clampPick(count, [10, 20, 30]);
  const parsed = await completeJson({
    context,
    config,
    signal,
    maxTokens: 14000,
    system: `You create study flashcards from source material. Return ONLY valid JSON: {"cards":[{"front":"...","back":"..."}]}. Produce exactly ${cardCount} cards. Front is a precise prompt; back is the answer. No markdown, no commentary.`,
    user: text
  });
  const cards = cleanCards(parsed, cardCount);
  const nowIso = new Date().toISOString();
  return context.db.createStudyCards(context.user.id, cards.map((card) => ({
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    note_id: source.note?.id || null,
    front: card.front,
    back: card.back,
    state: "new",
    due_at: nowIso
  })), { signal });
}

export async function generateQuiz({ context, config, course, source, count, signal }) {
  const text = await loadMaterialText(context.db, context.user.id, { ...source, signal });
  if (!text) throw new HttpError(400, "Material has no extracted text.");
  const questionCount = clampQuizCount(count);
  const parsed = await completeJson({
    context,
    config,
    signal,
    maxTokens: 16000,
    system: `You create a multiple-choice quiz from source material. Return ONLY valid JSON: {"title":"...","questions":[{"q":"...","choices":["A","B","C","D"],"answer":0,"explanation":"..."}]}. Produce exactly ${questionCount} questions. choices must have 4 distinct strings. answer is the 0-based index of the correct choice. No markdown, no commentary.`,
    user: text
  });
  const questions = cleanQuestions(parsed, questionCount);
  const title = String(parsed.title || "Quiz").trim() || "Quiz";
  return context.db.createStudyQuiz(context.user.id, {
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    note_id: source.note?.id || null,
    title,
    questions
  }, { signal });
}

export async function generateSummary({ context, config, course, source, signal }) {
  const text = await loadMaterialText(context.db, context.user.id, { ...source, signal });
  if (!text) throw new HttpError(400, "Material has no extracted text.");
  const parsed = await completeJson({
    context,
    config,
    signal,
    maxTokens: 4000,
    system: "You write a study summary from source material. Return ONLY valid JSON: {\"title\":\"...\",\"content\":\"...\"}. content is clean markdown with headers and bullets covering the key ideas. No commentary outside the JSON.",
    user: text
  });
  const title = String(parsed.title || "").trim() || "Summary";
  const content = String(parsed.content || "").trim();
  if (!content) throw new HttpError(502, GENERATION_FAILED);
  return context.db.createStudyNote(context.user.id, {
    project_id: course.id,
    document_file_id: source.documentFile?.id || null,
    kind: "summary",
    title,
    content
  }, { signal });
}

const DEADLINE_TYPES = new Set(["exam", "assignment", "other"]);

function cleanScaffoldMeta(parsed) {
  const meta = {};
  const term = String(parsed.term || "").trim();
  if (term) meta.term = term;
  const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
    .map((topic) => String(topic || "").trim())
    .filter(Boolean)
    .slice(0, 100);
  if (topics.length) meta.topics = topics;
  const deadlines = (Array.isArray(parsed.deadlines) ? parsed.deadlines : [])
    .flatMap((entry) => {
      const title = String(entry?.title || "").trim();
      const date = String(entry?.date || "").trim();
      const type = String(entry?.type || "").trim();
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !DEADLINE_TYPES.has(type)) return [];
      return [{ title, date, type }];
    })
    .slice(0, 100);
  if (deadlines.length) meta.deadlines = deadlines;
  return meta;
}

export async function scaffoldCourseMeta({ context, config, course, documentFile, signal }) {
  const text = await loadMaterialText(context.db, context.user.id, { documentFile, signal });
  if (!text) throw new HttpError(400, "Material has no extracted text.");
  const parsed = await completeJson({
    context,
    config,
    signal,
    maxTokens: 2500,
    system: "Extract a course syllabus. Return ONLY valid JSON: {\"term\":\"optional term name\",\"topics\":[\"...\"],\"deadlines\":[{\"title\":\"...\",\"date\":\"YYYY-MM-DD\",\"type\":\"exam\"}]}. type must be exam, assignment, or other. Omit unknown fields. Dates must be ISO YYYY-MM-DD. No markdown, no commentary.",
    user: text
  });
  const extracted = cleanScaffoldMeta(parsed);
  const meta = { ...(course.meta && typeof course.meta === "object" ? course.meta : {}), ...extracted };
  const updated = await context.db.updateProject(context.user.id, course.id, { meta }, { signal });
  return updated?.meta || meta;
}

export async function transcribeCourseImage({ context, config, course, attachment, signal }) {
  const provider = resolveProvider("openrouter", config);
  const crofai = studyMeter(context, config, signal);
  const imageUrl = context.r2.readUrl(attachment.object_key);
  const callSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(VISION_TIMEOUT_MS)])
    : AbortSignal.timeout(VISION_TIMEOUT_MS);
  let content;
  try {
    content = await crofai.chatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal: callSignal,
      body: {
        model: OPENROUTER_VISION_MODEL,
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
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, GENERATION_FAILED);
  }
  const markdown = String(content || "").trim();
  if (!markdown) throw new HttpError(502, GENERATION_FAILED);
  return context.db.createStudyNote(context.user.id, {
    project_id: course.id,
    kind: "image_transcript",
    title: String(attachment.file_name || "Image notes").trim() || "Image notes",
    content: markdown
  }, { signal });
}
