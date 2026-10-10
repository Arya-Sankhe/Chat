// AI tutor: a live voice call that teaches from a course's sources.
// Before the call we write a lesson plan and compact notes once, so every live turn is one small
// streamed model call over a stable, cacheable prompt. Replies are spoken sentence by sentence
// (Pocket TTS, or Kokoro when Pocket is full) while the model is still writing, so the first
// audio starts within a second or two.
import { HttpError } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, OPENROUTER_VISION_MODEL, resolveProvider } from "../providers.js";
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { loadGenerationSourceText, parseStudyJson, sourceFallbackTitle, streamComplete } from "./generate.js";
import { createSessionStore, createSpeechSession, pocketPool } from "../speech/engine.js";
import { PODCAST_VOICES, TTS_CREDITS_PER_CHAR, TTS_MODEL, speakable, synthesizeSpeech } from "./podcast.js";
import { assertRaster } from "./whiteboard.js";
import { LIMITS } from "../../public/js/whiteboard/schema.js";
import { BOARD_LIMITS, blockNames, boardNames, cleanLessonBlock, cleanLessonBoard, cleanText, describeBlock, parseBoardCue } from "../../public/js/whiteboard/lesson.js";

export const TUTOR_MAX_SECONDS = 30 * 60;
// Wall-clock allowance for a call, so pauses cannot keep a session open forever.
const TUTOR_WALL_SECONDS = 90 * 60;
const WRAP_UP_SECONDS = 4 * 60;
const MAX_TURNS = 160;
const PLAN_SOURCE_CHARS = 120_000;
const CALL_SOURCE_CHARS = 30_000;
const TURN_MAX_TOKENS = 1500; // includes the low-effort reasoning
const TTS_PARALLEL = 3;
const BOARD_SOURCE_CHARS = 24_000;
// A sketch the tutor asks for mid-reply is drawn alongside the speech; the reply waits this long for it.
const DRAW_WAIT_MS = 15_000;
const PART_NAME = /^[\w-]{1,40}$/;
// Kokoro latency through OpenRouter swings from about 1 s to 15 s. Chunks play in order, so one
// slow chunk leaves the tutor silent mid-reply; after this long a second request races the first.
// Pocket is never hedged: a duplicate would only queue behind the original on the same workers.
const TTS_HEDGE_MS = 3500;
// One speech engine per call, so the tutor's voice stays the same for the whole call.
const callSpeech = createSessionStore({ ttlMs: 2 * 60 * 60_000 });

export const TUTOR_STYLES = {
  teacher: {
    name: "Patient teacher",
    guide: "Patient teacher. Explain each idea from the ground up in plain language with one vivid everyday analogy or concrete example, then check understanding with a short question. When the student struggles, explain it a different way rather than repeating yourself. Praise specific progress, briefly."
  },
  buddy: {
    name: "Study buddy",
    guide: "Study buddy. You are a friendly classmate who is a step ahead in the course: casual, warm, and lightly funny. Say we, admit when something is tricky, share a memory trick when it helps, give a hint before giving the answer, quiz the student often, and celebrate wins. Never condescending."
  },
  socratic: {
    name: "Socratic guide",
    guide: "Socratic guide. Teach mainly through questions. Ask one focused question at a time that leads the student to reason the idea out, and build on what they say. When they are stuck give a small hint; after two tries explain it clearly, then ask them to put the conclusion in their own words. Keep your turns especially short."
  },
  professor: {
    name: "Strict professor",
    guide: "Strict professor running an oral exam, like a viva. Ask precise exam-style questions one at a time and expect exact terms and definitions. Point out errors and omissions directly and briefly, give the correct answer when they are wrong, and push with follow-ups such as why, and what is the mechanism. Professional and demanding, never rude; acknowledge a genuinely strong answer in a few words and raise the difficulty."
  }
};

// How the call runs, separate from the style's personality. "quiz" is the original question-led
// call and stays the default for sessions and clients that predate the choice.
export const TUTOR_FORMATS = {
  teach: {
    name: "Teach me",
    plan: "This is a lesson for someone meeting the material for the first time: the tutor explains each idea like a first lecture on it, so plan a clear teaching order and give each step the points needed to explain it from scratch.",
    start: "Greet the student warmly in one sentence and say in one sentence what you will teach together. Then start teaching step 1 from the basics and end with a short check-in.",
    nudge: "The student has been quiet for a while. In one short sentence, ask whether they would like you to carry on or explain that last part another way.",
    rules: `- This is a lesson: you do most of the talking, like a good teacher explaining the topic to someone hearing it for the first time. Follow the plan in order and assume no prior knowledge.
- Teach one small piece per reply, usually 50 to 120 words: the idea in plain words, why it matters, and a concrete example. Never cram a whole step into one reply.
- End every reply with a short check-in that hands the turn back, such as asking whether that makes sense or if they have questions before you go on. At the end of each step, ask its check question instead and wait for the answer.
- When the student says yes, okay, or go on, continue straight to the next piece without greeting or recapping. When they ask a question, answer it, then check in again. When they seem lost, explain it again a different way.`
  },
  quiz: {
    name: "Test me",
    plan: "The call is led by questions: the tutor briefly frames each idea, then asks the student about it.",
    start: "Greet the student warmly in one sentence, say in one sentence what you will cover together, then start step 1 with a question.",
    nudge: "The student has been quiet for a while. Check in gently in one short sentence: offer a hint or rephrase your last question.",
    rules: `- Work through the plan in order, adapting to the student. Move on once they show understanding, slow down where they struggle, and skip ahead if they clearly know a step already.
- Keep replies short: usually one to three sentences and under 70 words. It is a conversation, not a lecture; give a longer explanation only when the student asks for one.
- Ask one question at a time, then stop and wait. Never answer your own question in the same reply.`
  }
};

export function tutorFormatOf(session) {
  return Object.hasOwn(TUTOR_FORMATS, session?.plan?.format) ? session.plan.format : "quiz";
}

export function normalizeTutorOptions(body = {}) {
  const style = Object.hasOwn(TUTOR_STYLES, body.style) ? body.style : "teacher";
  const format = Object.hasOwn(TUTOR_FORMATS, body.format) ? body.format : "quiz";
  const voice = PODCAST_VOICES.some((item) => item.id === body.voice) ? body.voice : PODCAST_VOICES[0].id;
  const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1000) : "";
  // The whiteboard is on unless the student turned it off.
  const board = body.board !== false;
  return { style, format, voice, instructions, board };
}

/* ---------- Lesson plan ---------- */

function planPrompt({ style, format, instructions }) {
  return `You are preparing a one-to-one spoken tutoring call of up to 30 minutes, built from a student's study material. The tutor's style: ${TUTOR_STYLES[style].name}. ${TUTOR_FORMATS[format].plan}
${instructions ? `The student's instructions for this session: ${instructions}\n` : ""}
Plan a session that teaches the most important, most testable ideas in a logical order, simplest foundations first. A call covers about four to six steps; if the material is large, choose what matters most (and what the student asked for).

Return ONLY valid JSON, no markdown:
{"title": "<session title, at most 7 words>",
 "goal": "<one sentence: what the student will be able to explain by the end>",
 "steps": [{"title": "<short topic, at most 6 words>", "points": ["<a key fact or idea to teach>", "..."], "check": "<one question that checks understanding of this step>"}],
 "notes": "<dense reference notes for the tutor to rely on during the call: definitions, key facts and numbers, mechanisms, examples, and common mistakes, in 250 to 450 words>"}

Give each step three to five points. Only use facts supported by the material.`;
}

function cleanPlan(value, fallbackTitle) {
  const text = (item, max) => String(item ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const steps = (Array.isArray(value?.steps) ? value.steps : [])
    .map((step) => ({
      title: text(step?.title, 80),
      points: (Array.isArray(step?.points) ? step.points : []).map((point) => text(point, 300)).filter(Boolean).slice(0, 6),
      check: text(step?.check, 300)
    }))
    .filter((step) => step.title)
    .slice(0, 7);
  if (!steps.length) throw new HttpError(502, "The lesson plan came back empty. Try again.");
  return {
    title: text(value?.title, 90) || fallbackTitle,
    goal: text(value?.goal, 300),
    steps,
    notes: String(value?.notes ?? "").trim().slice(0, 6000)
  };
}

/* ---------- Whiteboard plan ---------- */

const BLOCK_GUIDE = `Block types. Every block and every part has a short, unique, lowercase kebab-case key such as "heart-atria"; the tutor points at things by key, so make keys descriptive and never reuse one.
- {"type": "note", "key", "text"}: one key sentence, at most 15 words.
- {"type": "formula", "key", "text", "caption"}: an equation or rule in plain symbols (× ÷ → ² √ Δ ≈ ≤), caption optional.
- {"type": "flow", "key", "title", "direction": "right" | "down", "cycle": false, "nodes": [{"key", "text"}], "labels": ["<label on arrow 1>", ...]}: 2 to 6 steps of a process or a chain of cause and effect. Use "cycle": true for a loop of 3 to 6 nodes. title and labels are optional.
- {"type": "tree", "key", "root": {"key", "text"}, "children": [{"key", "text", "children": [{"key", "text"}]}]}: a breakdown or classification; up to 4 children, each with up to 3 leaves.
- {"type": "table", "key", "columns": ["..."], "rows": [["..."]]}: 2 to 4 columns and up to 6 rows. Rows are pointed at as "<key>-r1", "<key>-r2" and so on.
- {"type": "timeline", "key", "events": [{"key", "label", "text"}]}: 2 to 6 dated or ordered events.
- {"type": "compare", "key", "left": {"key", "title", "points": ["..."]}, "right": {"key", "title", "points": ["..."]}}: two things side by side, up to 5 short points each.
- {"type": "plot", "key", "title", "x": {"label", "min", "max"}, "y": {"label", "min", "max"}, "curves": [{"key", "label", "fn": "<expression in x>"} or {"key", "label", "points": [[x, y], ...]}], "marks": [{"key", "x", "y", "label"}]}: a graph. fn may use x, numbers, + - * / ^, brackets, sin cos tan exp ln log sqrt abs, pi and e. Up to 3 curves and 4 marked points; pick ranges that show the interesting part.
- {"type": "sketch", "key", "title", "ops": [...]}: a labelled drawing (a cell, a circuit, a lever, a triangle) inside 900 wide by 560 tall. ops are {"op": "shape", "key", "shape": "rectangle" | "ellipse" | "diamond", "x", "y", "width", "height", "text", "color", "fill"}, {"op": "text", "key", "x", "y", "width", "text"}, {"op": "line", "key", "points": [[x, y], ...], "closed", "arrow", "smooth", "labels": ["A", "B", ...]} and {"op": "connect", "from": "<shape key>", "to": "<shape key>", "label"}. Up to 16 ops; text, color, fill, closed, arrow, smooth and labels are optional. Label the parts that matter.
Keep every label short (one to five words): a board is read at a glance.`;

function boardPrompt() {
  return `You are sketching the whiteboard for a one-to-one spoken tutoring call. While talking, the tutor reveals these blocks piece by piece, like a teacher drawing on a board, so each block should show what is worth seeing: the structure, process, comparison, formula or graph behind the step, not a copy of the explanation.

For each lesson step give one to three blocks (four at most). Prefer visual blocks (flow, tree, table, timeline, compare, plot, sketch) to notes; use a note only for a definition or rule worth writing down.

${BLOCK_GUIDE}

Return ONLY valid JSON, no markdown: {"steps": [{"blocks": [...]}, ...]} with exactly one entry per lesson step, in order. Only use facts supported by the material.`;
}

function planForBoard(plan) {
  const steps = plan.steps.map((step, index) => `Step ${index + 1}: ${step.title}\n${step.points.map((point) => `- ${point}`).join("\n")}`).join("\n\n");
  return `Session goal: ${plan.goal}\n\nLesson plan:\n${steps}\n\nTutor notes:\n${plan.notes}`;
}

/** The planned board for a lesson, or null when nothing usable came back. */
export async function planLessonBoard({ context, config, plan, text, signal, complete = streamComplete }) {
  const streamed = await complete({
    context,
    config,
    signal,
    maxTokens: 8000,
    temperature: 0.3,
    system: boardPrompt(),
    user: `${planForBoard(plan)}\n\n<material>\n${String(text || "").slice(0, BOARD_SOURCE_CHARS)}\n</material>`,
    expect: "json"
  });
  return cleanLessonBoard(parseStudyJson(streamed.content).value, plan.steps.length);
}

export async function prepareTutorSession({ context, config, course, source, options = {}, signal, onStage, onWarning, complete = streamComplete }) {
  const settings = normalizeTutorOptions(options);
  onStage?.("reading");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage, cap: PLAN_SOURCE_CHARS });
  // Several sources are trimmed to the call's smaller budget fairly too, not just the first few kept.
  const callText = source.documentFiles?.length > 1
    ? await loadGenerationSourceText({ context, config, source, signal, cap: CALL_SOURCE_CHARS })
    : text.slice(0, CALL_SOURCE_CHARS);
  onStage?.("planning");
  const streamed = await complete({
    context,
    config,
    signal,
    maxTokens: 3500,
    temperature: 0.3,
    system: planPrompt(settings),
    user: text.slice(0, PLAN_SOURCE_CHARS),
    expect: "json"
  });
  const plan = cleanPlan(parseStudyJson(streamed.content).value, sourceFallbackTitle(source) || "Tutor session");
  let board = null;
  if (settings.board) {
    onStage?.("drawing");
    try {
      board = await planLessonBoard({ context, config, plan, text, signal, complete });
    } catch (error) {
      if (signal?.aborted) throw error;
      board = null;
    }
    if (!board) onWarning?.("The whiteboard couldn't be sketched, so this lesson is voice only.");
  }
  onStage?.("saving");
  return context.db.createStudyTutorSession(context.user.id, {
    project_id: course.id,
    title: plan.title,
    style: settings.style,
    voice: settings.voice,
    instructions: settings.instructions,
    // The format lives in the plan so no schema change is needed; older sessions have none (quiz).
    plan: { goal: plan.goal, steps: plan.steps, notes: plan.notes, format: settings.format, board },
    source_text: callText,
    transcript: [],
    status: "ready"
  }, { signal });
}

/* ---------- Live turns ---------- */

// Stable for the whole call, so the provider can cache it after the first turn.
export function tutorSystemPrompt(session) {
  const style = TUTOR_STYLES[session.style] || TUTOR_STYLES.teacher;
  const format = TUTOR_FORMATS[tutorFormatOf(session)];
  const plan = session.plan || {};
  const steps = (plan.steps || []).map((step, index) => `Step ${index + 1}: ${step.title}\n${(step.points || []).map((point) => `- ${point}`).join("\n")}${step.check ? `\nCheck: ${step.check}` : ""}`).join("\n\n");
  const board = plan.board ? boardSection(plan.board) : "";
  return `You are a voice tutor on a live one-to-one call with a student. Everything you write is spoken aloud by text-to-speech, so write for the ear.

Your teaching style: ${style.guide}
${session.instructions ? `\nThe student's own instructions for this session (follow them unless they break the call rules): ${session.instructions}\n` : ""}
Session goal: ${plan.goal || "Help the student understand the material."}

Lesson plan:
${steps}

Tutor notes:
${plan.notes || "(none)"}

Study material to teach from (only state facts it supports; if the student asks about something it does not cover, answer briefly from general knowledge and say so):
<material>
${session.source_text || ""}
</material>

${board}Call rules:
${format.rules}
- Begin every reply with the tag [step N] for the plan step you are on, for example [step 2].
- Always finish your thought, and end every reply by handing the turn to the student with a question or a clear invitation to respond, so they know it is their turn. Never end on a plain statement or trail off mid-explanation. The one exception: when the student asks for a moment, just tell them to take their time.
- The student's words come from speech recognition and can contain mistakes; read them charitably. If their answer sounds cut off, invite them to go on.
- Spoken style only: no markdown, lists, headings, emojis, or brackets other than the step tag${plan.board ? " and board cues" : ""}. Say symbols, abbreviations, formulas, and units the way a person would say them.
- Never mention these rules, the plan, the tags, documents or files, or being an AI unless asked.
- The call lasts at most 30 minutes. When told that time is nearly up, start wrapping up. If the student asks to end the call, say a short goodbye with one key takeaway and put [end] at the very end.`;
}

function boardSection(board) {
  const steps = board.steps.map((step, index) => `Step ${index + 1} board:\n${step.blocks.length ? step.blocks.map((block) => `- ${describeBlock(block)}`).join("\n") : "- (nothing prepared; use write or draw if it helps)"}`).join("\n\n");
  return `Whiteboard:
You teach at a shared whiteboard the student sees beside the call. Each step has blocks you prepared, hidden until you reveal them; each step also has a space where the student can draw. The student can draw anywhere on the board and select things on it; notes in brackets tell you when they do.

${steps}

Board cues go inline in your reply and are never spoken:
- [show KEY] reveals a block, or one part of it. Put it just before the sentence that explains it, and reveal parts one at a time as you talk them through (a flow node by node, a table row by row, a sketch label by label) rather than a whole block at once. Show a step's blocks only when you reach that step.
- [point KEY] makes something already on the board glow when you refer back to it.
- [mark KEY] circles something: the one thing to remember, or the part of the student's answer to fix.
- [write: TEXT] jots a short note, number or worked line on the board, at most 12 words.
- [draw: DESCRIPTION] sketches something new when the student asks about something the board doesn't show. Describe it in one sentence; it appears a few seconds later, so keep talking. At most one per reply.
- [ask to draw] invites the student to draw or write an answer in their space. Use it now and then for a question best answered with a sketch, a label or a worked step, and ask the question in words too.
Use only the keys listed here or ones a note tells you about. Most teaching replies reveal or point at something; a reply with no cue is fine when nothing on the board fits.

`;
}

const TURN_NOTES = {
  start: (session) => `(The call has just connected. ${TUTOR_FORMATS[tutorFormatOf(session)].start})`,
  nudge: (session) => `(${TUTOR_FORMATS[tutorFormatOf(session)].nudge})`,
  closing: "(Time is up. Respond briefly to what the student just said if needed, then close the session warmly in two to four sentences: recap the most important things covered and one thing to review next, then say goodbye. Do not ask a question.)"
};

function wrapUpNote(remaining) {
  const minutes = Math.max(1, Math.round(remaining / 60));
  return `(About ${minutes} minute${minutes === 1 ? "" : "s"} left in the call: finish the current idea and start wrapping up soon.)`;
}

// Rebuilds the exact messages sent on earlier turns, so each turn extends a cached prefix.
export function tutorMessages(session, entry) {
  const messages = [{ role: "system", content: tutorSystemPrompt(session) }];
  for (const item of [...(session.transcript || []), entry]) {
    if (!item) continue;
    if (item.role === "tutor") messages.push({ role: "assistant", content: `[step ${item.step || 1}] ${item.cued || item.text}` });
    else if (item.prompt) messages.push({ role: "user", content: item.prompt });
  }
  return messages;
}

const STEP_TAG = /^\s*\[\s*step\s*(\d+)\s*\]\s*/i;

// Splits the streamed reply into speakable chunks: a short first chunk so audio starts fast,
// then fuller ones (Kokoro stumbles on very short inputs and rushes very long ones).
export function createSpeechChunker({ first = 6, min = 14, max = 42 } = {}) {
  let buffer = "";
  let emitted = 0;
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  const take = (final) => {
    const out = [];
    for (;;) {
      const target = emitted ? min : first;
      const ends = [...buffer.matchAll(/[.!?]+["')\]]*(?=\s|$)/g)].map((match) => match.index + match[0].length);
      let cut = -1;
      for (const end of ends) {
        const count = words(buffer.slice(0, end));
        if (count >= target) { cut = end; break; }
        if (count > max) break;
      }
      if (cut < 0 && words(buffer) > max * 1.4) {
        const clause = [...buffer.matchAll(/[,;:](?=\s)/g)].map((match) => match.index + 1).filter((end) => words(buffer.slice(0, end)) >= min).at(-1);
        cut = clause || -1;
      }
      if (cut < 0 || (!final && cut === buffer.trimEnd().length && !/\s$/.test(buffer))) break;
      const chunk = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut);
      if (chunk) { out.push(chunk); emitted += 1; }
    }
    if (final && buffer.trim()) {
      out.push(buffer.trim());
      buffer = "";
      emitted += 1;
    }
    return out;
  };
  // A chunk goes out once at least `first` more words follow it (milliseconds of model output,
  // hidden behind audio already playing), so a short closing line such as "Ready?" joins the
  // chunk before it instead of going to Kokoro alone.
  let held = "";
  const release = (chunks, final) => {
    const out = [];
    for (const chunk of chunks) {
      if (held) out.push(held);
      held = chunk;
    }
    if (final && held) {
      if (out.length && words(held) < first) out[out.length - 1] = `${out.at(-1)} ${held}`;
      else out.push(held);
      held = "";
    } else if (held && words(buffer) >= first) {
      out.push(held);
      held = "";
    }
    return out;
  };
  return {
    push: (text) => { buffer += text; return release(take(false), false); },
    flush: () => release(take(true), true)
  };
}

// Runs tts, and if it has not answered within hedgeMs, a second identical request alongside it.
// The first to succeed wins and the other is cancelled; it rejects only when both fail.
export function hedgedSpeech(tts, { hedgeMs = TTS_HEDGE_MS } = {}) {
  return (args) => new Promise((resolve, reject) => {
    const controllers = [];
    let failures = 0;
    let settled = false;
    let timer = null;
    const launch = () => {
      const controller = new AbortController();
      controllers.push(controller);
      const signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal;
      tts({ ...args, signal }).then((audio) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const other of controllers) if (other !== controller) other.abort();
        resolve(audio);
      }, (error) => {
        if (settled) return;
        failures += 1;
        if (controllers.length === 1 && !args.signal?.aborted) {
          clearTimeout(timer);
          launch(); // the first failed quickly: try once more straight away
        } else if (failures >= controllers.length) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    };
    launch();
    timer = setTimeout(() => { if (!settled && controllers.length === 1 && !args.signal?.aborted) launch(); }, hedgeMs);
  });
}

// Speaks chunks with limited parallelism and hands them back in order. Never rejects:
// a chunk that fails to record is delivered as text only, so the call keeps going.
export function createSpeechQueue({ config, voice, signal, tts, speech = null, onAudio, gate = Promise.resolve(true), hedgeMs }) {
  const hedged = speech ? null : hedgedSpeech(tts, { hedgeMs });
  const speak = speech ? (args) => speech.speak(args) : async (args) => ({ audio: await hedged(args), engine: "kokoro" });
  const pending = [];
  const ready = new Map();
  let active = 0;
  let count = 0;
  let next = 0;
  let characters = 0;
  let closed = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const flush = () => {
    while (ready.has(next)) {
      const item = ready.get(next);
      ready.delete(next);
      onAudio(item);
      next += 1;
    }
    if (closed && next === count) resolveDone({ characters });
  };
  const pump = () => {
    while (active < TTS_PARALLEL && pending.length) {
      const job = pending.shift();
      active += 1;
      (async () => {
        let audio = null;
        let engine = null;
        const spoken = speakable(job.text);
        // Nothing is synthesized until the turn's speech reservation has been granted.
        if (spoken && !signal?.aborted && await gate && !signal?.aborted) {
          try {
            ({ audio, engine } = await speak({ config, text: spoken, voice, signal }));
            characters += spoken.length;
          } catch {
            audio = null;
          }
        }
        active -= 1;
        ready.set(job.seq, { seq: job.seq, text: job.text, audio: audio && !signal?.aborted ? audio.toString("base64") : null, ...(engine ? { engine } : {}), ...job.meta });
        flush();
        pump();
      })();
    }
  };
  return {
    // `meta` travels with the chunk to onAudio (where the chunk sits in the reply, for board cues).
    add(text, meta = {}) {
      pending.push({ seq: count, text, meta });
      count += 1;
      pump();
    },
    close() {
      closed = true;
      flush();
      return done;
    },
    done
  };
}

function sessionElapsed(session, clientElapsed) {
  const claimed = Math.max(0, Number(clientElapsed) || 0);
  const started = session.started_at ? Date.parse(session.started_at) : Date.now();
  const wall = Math.max(0, (Date.now() - started) / 1000);
  return { elapsed: Math.min(claimed, wall + 5), wall };
}

export function tutorTurnGuard(session, { mode, elapsed }) {
  if (session.status === "ended") throw new HttpError(409, "This tutor session has ended.");
  if ((session.transcript || []).length >= MAX_TURNS * 2) throw new HttpError(409, "This call has reached its limit.");
  if (session.status === "ready" && mode !== "start") throw new HttpError(409, "Start the call first.");
  const { elapsed: seconds, wall } = sessionElapsed(session, elapsed);
  if (mode !== "closing" && (seconds > TUTOR_MAX_SECONDS + 30 || (session.started_at && wall > TUTOR_WALL_SECONDS))) {
    throw new HttpError(409, "This call has reached its time limit.", { code: "tutor_time_up" });
  }
  return seconds;
}

/* ---------- Whiteboard during the call ---------- */

/**
 * What the student did on the board, from a turn request: the parts of the tutor's drawing they
 * selected (by name), what they typed on the board, and a picture of what they drew since the
 * last turn. Throws HttpError for an image that is not a small PNG, JPEG or WebP.
 */
export function normalizeTutorBoard(value) {
  if (!value || typeof value !== "object") return null;
  const pointing = [...new Set((Array.isArray(value.pointing) ? value.pointing : []).filter((name) => typeof name === "string" && PART_NAME.test(name)))].slice(0, 8);
  const writing = cleanText(value.writing, 1000);
  let image = null;
  if (value.image) {
    const data = String(value.image.data || "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(LIMITS.contextImageBytes / 3) * 4) throw new HttpError(413, "The board snapshot is too large.");
    const info = assertRaster(Buffer.from(data, "base64"), { maxBytes: LIMITS.contextImageBytes, types: ["image/png", "image/jpeg", "image/webp"] });
    image = { mime: info.mime, data };
  }
  return pointing.length || writing || image ? { pointing, writing, image } : null;
}

/** A few words on what the student drew, for a tutor who can't see the board. Metered like any model call. */
export async function describeStudentDrawing({ context, config, session, image, writing = "", step = 1, signal }) {
  const provider = resolveProvider("openrouter", config);
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: 0.03
  });
  const topic = session.plan?.steps?.[step - 1]?.title || session.title || "";
  const upstream = await meter.streamChatCompletion({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: provider.id,
    signal,
    body: {
      model: OPENROUTER_VISION_MODEL,
      reasoning: { enabled: false },
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: "You describe a student's whiteboard work to their tutor, who cannot see it. Transcribe words, numbers and formulas exactly; describe any diagram (shapes, arrows, labels and how they connect); and say which parts of the tutor's blue drawing they circled, crossed out or wrote on, if any. Do not judge whether it is right. Plain sentences, at most 80 words. If it is blank or unreadable, say so." },
        { role: "user", content: [
          { type: "text", text: `Lesson topic: ${topic}${writing ? `\nText the student typed on the board: ${writing}` : ""}\nDescribe what the student drew.` },
          { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }
        ] }
      ]
    }
  });
  const result = await streamProviderAndAccumulate(upstream, () => {});
  return cleanText(result.content, 700);
}

function improvisePrompt() {
  return `You draw one block on a tutor's whiteboard, in the middle of a spoken lesson, to show what the tutor just described. Draw only what was asked, small and clear.

${BLOCK_GUIDE}

Return ONLY valid JSON, no markdown: one block object. Only use facts supported by the tutor notes, or well-established general knowledge.`;
}

/** One block for a [draw: …] cue, cleaned against the names already on the board; null when unusable. */
export async function improviseBlock({ context, config, session, description, step = 1, used, signal, complete = streamComplete }) {
  const lesson = session.plan?.steps?.[step - 1];
  const streamed = await complete({
    context,
    config,
    signal,
    maxTokens: 1800,
    temperature: 0.3,
    system: improvisePrompt(),
    user: `Lesson step: ${lesson?.title || session.title || ""}\n${(lesson?.points || []).map((point) => `- ${point}`).join("\n")}\n\nTutor notes:\n${String(session.plan?.notes || "").slice(0, 2000)}\n\nDraw: ${description}`,
    expect: "json"
  });
  return cleanLessonBlock(parseStudyJson(streamed.content).value, used);
}

/** The tag a cue was written as, for replaying the tutor's own reply to it on later turns. */
function cueTag(cue) {
  if (cue.op === "write") return `[write: ${cue.text}]`;
  if (cue.op === "add") return `[draw: ${cue.text}]`;
  if (cue.op === "ask") return "[ask to draw]";
  return `[${cue.op} ${cue.key}]`;
}

/** `text` (the spoken reply) with its board cues put back where they were, up to `end`. */
export function withCues(text, cues, end = text.length) {
  let out = "";
  let at = 0;
  for (const { at: offset, cue } of [...cues].sort((a, b) => a.at - b.at)) {
    if (offset > end || cue.op === "step") continue;
    out += `${text.slice(at, offset)}${cueTag(cue)} `;
    at = offset;
  }
  return `${out}${text.slice(at, end)}`.replace(/\s+/g, " ").trim();
}

/** Where `chunk` sits in `text`, searching from `from`; chunks are trimmed slices, so this is near exact. */
export function chunkSpan(text, chunk, from) {
  const head = chunk.slice(0, 24);
  const tail = chunk.slice(-24);
  const startAt = text.indexOf(head, from);
  const start = startAt >= 0 ? startAt : from;
  const tailAt = text.indexOf(tail, Math.max(start, start + chunk.length - tail.length - 8));
  const end = tailAt >= 0 ? tailAt + tail.length : Math.min(text.length, start + chunk.length);
  return { start, end: Math.max(start, end) };
}

/**
 * Runs one exchange: the student's words (already transcribed) in, the tutor's reply out as
 * streamed text plus in-order audio chunks. The transcript is saved even when the student
 * interrupts, so the next turn continues from what was actually said. With a whiteboard, the
 * reply's board cues go out as `board` events placed by their offset in the spoken text, and
 * each audio chunk carries its own start and end offsets, so the browser draws in time with speech.
 */
export async function runTutorTurn({
  context, config, session, mode = "reply", text = "", elapsed = 0, board: studentBoard = null, signal, emit,
  tts = synthesizeSpeech, pool = pocketPool(config), describe = describeStudentDrawing, improvise = improviseBlock
}) {
  const seconds = tutorTurnGuard(session, { mode, elapsed });
  const said = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (mode === "reply" && !said) throw new HttpError(400, "Say something first.");
  const remaining = TUTOR_MAX_SECONDS - seconds;
  const plannedBoard = session.plan?.board || null;
  const previous = [...(session.transcript || [])].reverse().find((item) => item.role === "tutor") || null;
  let prompt = said;
  if (mode === "start" || mode === "nudge") prompt = TURN_NOTES[mode](session);
  else if (mode === "closing") prompt = said ? `${said}\n\n${TURN_NOTES.closing}` : TURN_NOTES.closing;
  else if (remaining <= WRAP_UP_SECONDS) prompt = `${said}\n\n${wrapUpNote(remaining)}`;

  if (said) emit({ type: "heard", text: said });
  // Board notes come first, so the tutor reads what is on the board before what was said.
  const notes = [];
  if (plannedBoard) {
    for (const item of previous?.drawn || []) {
      const parts = (item.parts || []).slice(0, 12);
      notes.push(`(Your sketch "${item.text}" is now on the board as ${item.key}${parts.length ? `, with parts ${parts.join(", ")}` : ""}.)`);
    }
    if (studentBoard?.pointing?.length) notes.push(`(On the board, the student has selected: ${studentBoard.pointing.join(", ")}.)`);
    if (studentBoard?.image) {
      let seen = "";
      try {
        seen = await describe({ context, config, session, image: studentBoard.image, writing: studentBoard.writing, step: previous?.step || 1, signal });
      } catch (error) {
        if (signal?.aborted) throw error;
      }
      notes.push(seen ? `(The student just drew on the whiteboard: ${seen})` : "(The student drew something on the whiteboard, but it couldn't be read.)");
    } else if (studentBoard?.writing) notes.push(`(The student wrote on the whiteboard: ${studentBoard.writing})`);
  }
  if (notes.length) prompt = `${notes.join("\n")}\n\n${prompt}`;
  const entry = said
    ? { role: "student", text: said, prompt, at: Math.round(seconds) }
    : { role: "cue", prompt, at: Math.round(seconds) };

  const provider = resolveProvider("openrouter", config);
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: 0.05,
    stickyProviders: session.provider_pin ? { [OPENROUTER_TEXT_MODEL]: session.provider_pin } : null
  });

  const chunker = createSpeechChunker();
  const delivered = [];
  let deliveredEnd = 0;
  let openGate;
  const gate = new Promise((resolve) => { openGate = resolve; });
  const engine = callSpeech.get(`${session.id}`, () => createSpeechSession({ pool, kokoro: hedgedSpeech(tts) }));
  engine.beginReply();
  const queue = createSpeechQueue({
    config,
    voice: session.voice,
    signal,
    tts,
    speech: engine,
    gate,
    onAudio: (item) => {
      if (signal?.aborted) return; // the student cut in; nothing more reaches them
      delivered.push(item.text);
      deliveredEnd = Math.max(deliveredEnd, item.end || 0);
      emit({ type: "audio", ...item });
    }
  });
  // One reservation covers every chunk this turn records; it settles on what was spoken.
  const speech = meter.runReserved({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, providerId: "openrouter", body: { model: TTS_MODEL }, signal }, async ({ markSubmitted }) => {
    openGate(true);
    const { characters } = await queue.done;
    if (characters) await markSubmitted();
    return { result: characters, usage: { cost: characters * TTS_CREDITS_PER_CHAR, characters } };
  }).catch(() => {}).finally(() => openGate(false)); // no reservation, no paid speech: the reply stays text-only

  // Names a cue may use: the planned board's, and sketches drawn earlier in the call.
  const known = plannedBoard ? boardNames(plannedBoard) : new Set();
  const drawnBefore = (session.transcript || []).flatMap((item) => item.drawn || []);
  for (const item of drawnBefore) for (const name of [item.key, ...(item.parts || [])]) known.add(name);
  const cues = []; // { at, cue } sent this turn, by offset in the spoken text
  const drawn = [];
  const draws = [];
  let writes = (session.transcript || []).reduce((sum, item) => sum + (item.writes || 0), 0);

  let raw = "";
  let shown = "";
  let placed = 0; // how far into `shown` the speech chunks reach
  let step = 0;
  let ended = false;
  let failure = null;
  let tagsSeen = 0;
  const sendCue = (at, cue) => {
    cues.push({ at, cue });
    emit({ type: "board", at, cue });
  };
  const onTag = (inner, at) => {
    const stepTag = inner.match(/^\s*step\s*(\d+)\s*$/i);
    if (stepTag) {
      step = Number(stepTag[1]) || step;
      if (plannedBoard && step) sendCue(at, { op: "step", n: Math.min(step, plannedBoard.steps.length) });
      return;
    }
    if (/^\s*end\s*$/i.test(inner)) { ended = true; return; }
    if (!plannedBoard) return;
    const cue = parseBoardCue(inner);
    if (!cue) return;
    if (cue.op === "show" || cue.op === "point" || cue.op === "mark") {
      if (known.has(cue.key)) sendCue(at, cue);
    } else if (cue.op === "write") {
      if (writes >= BOARD_LIMITS.extras * 2) return;
      writes += 1;
      sendCue(at, { op: "write", text: cue.text });
    } else if (cue.op === "ask") {
      sendCue(at, cue);
    } else if (cue.op === "draw" && !draws.length && drawnBefore.length + drawn.length < BOARD_LIMITS.extras) {
      const description = cue.text;
      const used = new Set(known);
      draws.push(improvise({ context, config, session, description, step: step || lastStep(session), used, signal: AbortSignal.any([signal, AbortSignal.timeout(DRAW_WAIT_MS)].filter(Boolean)) })
        .then((block) => {
          if (!block || signal?.aborted) return;
          for (const name of used) known.add(name);
          drawn.push({ key: block.key, text: description, parts: blockNames(block).filter((name) => name !== block.key) });
          sendCue(at, { op: "add", block, text: description });
        })
        .catch(() => {})); // a sketch that fails just isn't drawn; the reply goes on
    }
  };
  // Hold back the start of the reply until the step tag is resolved, then stream the rest.
  // Every bracketed tag is cut out of the spoken text; board cues keep their place as an offset.
  const release = (final) => {
    if (!step) {
      const tag = raw.match(STEP_TAG);
      if (!tag && !final && /^\s*\[?\s*(s(t(e(p\s*\d*\s*\]?)?)?)?)?$/i.test(raw)) return;
    }
    let body = "";
    let last = 0;
    let index = 0;
    for (const match of raw.matchAll(/\[([^\]]*)\]\s*/g)) {
      body += raw.slice(last, match.index);
      last = match.index + match[0].length;
      if (index >= tagsSeen) onTag(match[1], body.length);
      index += 1;
    }
    tagsSeen = index;
    // An unfinished tag is held back while streaming, and never spoken at the end.
    body += raw.slice(last).replace(/\[[^\]]*$/, "");
    const delta = body.slice(shown.length);
    if (!delta) return;
    shown = body;
    emit({ type: "text", delta });
    for (const chunk of chunker.push(delta)) addChunk(chunk);
  };
  const addChunk = (chunk) => {
    const span = chunkSpan(shown, chunk, placed);
    placed = span.end;
    queue.add(chunk, span);
  };

  try {
    const upstream = await meter.streamChatCompletion({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: provider.id,
      signal,
      body: {
        model: OPENROUTER_TEXT_MODEL,
        // A little thinking keeps the tutoring sharp; the reasoning itself is never spoken.
        reasoning: { effort: "low", exclude: true },
        messages: tutorMessages(session, entry),
        temperature: 0.6,
        max_tokens: TURN_MAX_TOKENS
      }
    });
    await streamProviderAndAccumulate(upstream, (event) => {
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        raw += delta;
        release(false);
      }
    });
    release(true);
  } catch (error) {
    failure = error;
  }
  if (!signal?.aborted) for (const chunk of chunker.flush()) addChunk(chunk);
  await Promise.all([queue.close(), Promise.allSettled(draws)]);
  await speech;

  // When the student cut in, keep only what reached them as speech.
  const interrupted = Boolean(failure) || Boolean(signal?.aborted);
  const reply = (interrupted ? delivered.join(" ") : shown).replace(/\s+/g, " ").trim();
  if (!reply && failure) {
    if (signal?.aborted) {
      // Cut off before any speech: nothing to save, but the call has still started.
      if (session.status === "ready") {
        await context.db.updateStudyTutorSession(context.user.id, session.id, { status: "live", started_at: new Date().toISOString() }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
      }
      return null;
    }
    throw failure instanceof HttpError ? failure : new HttpError(502, "The tutor could not answer. Try again.");
  }
  const transcript = [...(session.transcript || []), entry];
  if (reply) {
    const end = interrupted ? deliveredEnd : shown.length;
    const kept = cues.filter((item) => item.at <= end && item.cue.op !== "step");
    // Sketches that landed after the student cut in were never shown, so they aren't remembered.
    const keptDrawn = interrupted ? drawn.filter((item) => kept.some((cue) => cue.cue.op === "add" && cue.cue.block.key === item.key)) : drawn;
    transcript.push({
      role: "tutor",
      text: reply,
      step: step || lastStep(session),
      at: Math.round(seconds),
      ...(interrupted ? { interrupted: true } : {}),
      ...(kept.length ? { cued: withCues(shown, kept, end) } : {}),
      ...(keptDrawn.length ? { drawn: keptDrawn } : {}),
      ...(kept.some((item) => item.cue.op === "write") ? { writes: kept.filter((item) => item.cue.op === "write").length } : {})
    });
  }
  const pin = meter.pinnedProviders()[OPENROUTER_TEXT_MODEL] || session.provider_pin || null;
  const patch = {
    transcript,
    provider_pin: pin,
    active_seconds: Math.max(Number(session.active_seconds) || 0, Math.round(seconds)),
    ...(session.status === "ready" ? { status: "live", started_at: new Date().toISOString() } : {})
  };
  // Save even when the student cut the reply short; the request itself may already be gone.
  const saved = await context.db.updateStudyTutorSession(context.user.id, session.id, patch, { signal: AbortSignal.timeout(15_000) });
  const result = { step: step || lastStep(session), ended: ended || mode === "closing", remaining: Math.max(0, Math.round(remaining)) };
  if (!signal?.aborted) emit({ type: "done", ...result });
  return { session: saved || { ...session, ...patch }, ...result };
}

function lastStep(session) {
  return [...(session.transcript || [])].reverse().find((item) => item.role === "tutor")?.step || 1;
}

/* ---------- Wrap-up ---------- */

function summaryPrompt() {
  return `You write the recap a student reads after a spoken tutoring call. Base it only on what was actually covered in the transcript. Write every field in the second person, speaking to the student as "you" (never "the student").
Return ONLY valid JSON, no markdown:
{"overview": "<two or three sentences on what the session covered and how it went>",
 "concepts": [{"term": "<key concept, at most 5 words>", "detail": "<one or two sentences the student should remember>"}],
 "strengths": ["<something the student understood or answered well>"],
 "review": ["<one plain sentence naming a gap, mistake, or topic to revisit, and the correct idea>"],
 "next": "<one sentence suggesting what to study next>"}
Give three to six concepts, up to three strengths, and up to three review items. Every strengths and review item is a plain string, never an object. Use empty lists when the call was too short to judge.`;
}

// Models sometimes return list items as objects ({ topic, correction }) instead of
// strings; flatten those into "Topic: rest" rather than "[object Object]".
export function recapLine(item) {
  if (item == null) return "";
  if (typeof item !== "object") return String(item).trim();
  const parts = (Array.isArray(item) ? item : Object.values(item)).map(recapLine).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const [head, ...rest] = parts;
  return `${head.replace(/[.:;,\s]+$/, "")}: ${rest.join(" ")}`;
}

export async function summarizeTutorSession({ context, config, session, signal, complete = streamComplete }) {
  const lines = (session.transcript || [])
    .filter((item) => item.role === "tutor" || item.role === "student")
    .map((item) => `${item.role === "tutor" ? "Tutor" : "Student"}: ${item.text}`);
  if (lines.filter((line) => line.startsWith("Student:")).length < 1) return null;
  const steps = (session.plan?.steps || []).map((step, index) => `${index + 1}. ${step.title}`).join("\n");
  const streamed = await complete({
    context,
    config,
    signal,
    maxTokens: 1800,
    temperature: 0.2,
    system: summaryPrompt(),
    user: `Lesson plan:\n${steps}\n\nTranscript:\n${lines.join("\n").slice(-60_000)}`,
    expect: "json"
  });
  const value = parseStudyJson(streamed.content).value || {};
  const list = (items, max, size = 400) => (Array.isArray(items) ? items : []).map((item) => recapLine(item).slice(0, size)).filter(Boolean).slice(0, max);
  return {
    overview: String(value.overview || "").trim().slice(0, 1200),
    concepts: (Array.isArray(value.concepts) ? value.concepts : [])
      .map((item) => ({ term: String(item?.term || "").trim().slice(0, 80), detail: String(item?.detail || "").trim().slice(0, 500) }))
      .filter((item) => item.term)
      .slice(0, 8),
    strengths: list(value.strengths, 4),
    review: list(value.review, 4),
    next: String(value.next || "").trim().slice(0, 400)
  };
}

export async function endTutorSession({ context, config, session, elapsed, signal, summarize = summarizeTutorSession }) {
  const { elapsed: seconds } = sessionElapsed(session, elapsed);
  const activeSeconds = Math.min(TUTOR_MAX_SECONDS, Math.max(Number(session.active_seconds) || 0, Math.round(seconds)));
  let summary = session.summary || null;
  if (!summary) {
    try {
      summary = await summarize({ context, config, session, signal });
    } catch {
      summary = null; // The transcript is still saved; the recap can be retried by reopening.
    }
  }
  return context.db.updateStudyTutorSession(context.user.id, session.id, {
    status: "ended",
    ended_at: session.ended_at || new Date().toISOString(),
    active_seconds: session.started_at ? activeSeconds : 0,
    summary
  }, { signal });
}

export function publicTutorSession(session) {
  return {
    id: session.id,
    title: session.title || "Tutor session",
    style: session.style,
    format: tutorFormatOf(session),
    voice: session.voice,
    instructions: session.instructions || "",
    plan: { goal: session.plan?.goal || "", steps: (session.plan?.steps || []).map((step) => ({ title: step.title, check: step.check || "" })), board: session.plan?.board || null },
    boardId: session.plan?.boardId || null,
    transcript: (Array.isArray(session.transcript) ? session.transcript : [])
      .filter((item) => item.role === "tutor" || item.role === "student")
      .map((item) => ({ role: item.role, text: item.text, at: item.at || 0, ...(item.step ? { step: item.step } : {}), ...(item.interrupted ? { interrupted: true } : {}) })),
    summary: session.summary || null,
    status: session.status,
    activeSeconds: Number(session.active_seconds) || 0,
    maxSeconds: TUTOR_MAX_SECONDS,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    createdAt: session.created_at
  };
}
