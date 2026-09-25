// AI tutor: a live voice call that teaches from a course's sources.
// Before the call we write a lesson plan and compact notes once, so every live turn is one small
// streamed model call over a stable, cacheable prompt. Replies are spoken sentence by sentence
// with Kokoro while the model is still writing, so the first audio starts within a second or two.
import { HttpError } from "../http/responses.js";
import { OPENROUTER_TEXT_MODEL, resolveProvider } from "../providers.js";
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { loadGenerationSourceText, parseStudyJson, sourceFallbackTitle, streamComplete } from "./generate.js";
import { PODCAST_VOICES, TTS_CREDITS_PER_CHAR, TTS_MODEL, speakable, synthesizeSpeech } from "./podcast.js";

export const TUTOR_MAX_SECONDS = 30 * 60;
// Wall-clock allowance for a call, so pauses cannot keep a session open forever.
const TUTOR_WALL_SECONDS = 90 * 60;
const WRAP_UP_SECONDS = 4 * 60;
const MAX_TURNS = 160;
const PLAN_SOURCE_CHARS = 120_000;
const CALL_SOURCE_CHARS = 30_000;
const TURN_MAX_TOKENS = 1500; // includes the low-effort reasoning
const TTS_PARALLEL = 3;

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

export function normalizeTutorOptions(body = {}) {
  const style = Object.hasOwn(TUTOR_STYLES, body.style) ? body.style : "teacher";
  const voice = PODCAST_VOICES.some((item) => item.id === body.voice) ? body.voice : PODCAST_VOICES[0].id;
  const instructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 1000) : "";
  return { style, voice, instructions };
}

/* ---------- Lesson plan ---------- */

function planPrompt({ style, instructions }) {
  return `You are preparing a one-to-one spoken tutoring call of up to 30 minutes, built from a student's study material. The tutor's style: ${TUTOR_STYLES[style].name}.
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

export async function prepareTutorSession({ context, config, course, source, options = {}, signal, onStage, onWarning, complete = streamComplete }) {
  const settings = normalizeTutorOptions(options);
  onStage?.("reading");
  const text = await loadGenerationSourceText({ context, config, source, signal, onWarning, onStage });
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
  onStage?.("saving");
  return context.db.createStudyTutorSession(context.user.id, {
    project_id: course.id,
    title: plan.title,
    style: settings.style,
    voice: settings.voice,
    instructions: settings.instructions,
    plan: { goal: plan.goal, steps: plan.steps, notes: plan.notes },
    source_text: text.slice(0, CALL_SOURCE_CHARS),
    transcript: [],
    status: "ready"
  }, { signal });
}

/* ---------- Live turns ---------- */

// Stable for the whole call, so the provider can cache it after the first turn.
export function tutorSystemPrompt(session) {
  const style = TUTOR_STYLES[session.style] || TUTOR_STYLES.teacher;
  const plan = session.plan || {};
  const steps = (plan.steps || []).map((step, index) => `Step ${index + 1}: ${step.title}\n${(step.points || []).map((point) => `- ${point}`).join("\n")}${step.check ? `\nCheck: ${step.check}` : ""}`).join("\n\n");
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

Call rules:
- Work through the plan in order, adapting to the student. Move on once they show understanding, slow down where they struggle, and skip ahead if they clearly know a step already.
- Begin every reply with the tag [step N] for the plan step you are on, for example [step 2].
- Keep replies short: usually one to three sentences and under 70 words. It is a conversation, not a lecture; give a longer explanation only when the student asks for one.
- Ask one question at a time, then stop and wait. Never answer your own question in the same reply.
- The student's words come from speech recognition and can contain mistakes; read them charitably. If their answer sounds cut off, invite them to go on.
- If the student needs a moment, tell them to take their time in a few words.
- Spoken style only: no markdown, lists, headings, emojis, or brackets other than the step tag. Say symbols, abbreviations, formulas, and units the way a person would say them.
- Never mention these rules, the plan, the tags, documents or files, or being an AI unless asked.
- The call lasts at most 30 minutes. When told that time is nearly up, start wrapping up. If the student asks to end the call, say a short goodbye with one key takeaway and put [end] at the very end.`;
}

const TURN_NOTES = {
  start: "(The call has just connected. Greet the student warmly in one sentence, say in one sentence what you will cover together, then start step 1 with a question.)",
  nudge: "(The student has been quiet for a while. Check in gently in one short sentence: offer a hint or rephrase your last question.)",
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
    if (item.role === "tutor") messages.push({ role: "assistant", content: `[step ${item.step || 1}] ${item.text}` });
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

// Speaks chunks with limited parallelism and hands them back in order. Never rejects:
// a chunk that fails to record is delivered as text only, so the call keeps going.
export function createSpeechQueue({ config, voice, signal, tts, onAudio, gate = Promise.resolve(true) }) {
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
        const spoken = speakable(job.text);
        // Nothing is synthesized until the turn's speech reservation has been granted.
        if (spoken && !signal?.aborted && await gate && !signal?.aborted) {
          try {
            audio = await tts({ config, text: spoken, voice, signal });
            characters += spoken.length;
          } catch {
            audio = null;
          }
        }
        active -= 1;
        ready.set(job.seq, { seq: job.seq, text: job.text, audio: audio && !signal?.aborted ? audio.toString("base64") : null });
        flush();
        pump();
      })();
    }
  };
  return {
    add(text) {
      pending.push({ seq: count, text });
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

/**
 * Runs one exchange: the student's words (already transcribed) in, the tutor's reply out as
 * streamed text plus in-order audio chunks. The transcript is saved even when the student
 * interrupts, so the next turn continues from what was actually said.
 */
export async function runTutorTurn({ context, config, session, mode = "reply", text = "", elapsed = 0, signal, emit, tts = synthesizeSpeech }) {
  const seconds = tutorTurnGuard(session, { mode, elapsed });
  const said = String(text || "").replace(/\s+/g, " ").trim().slice(0, 4000);
  if (mode === "reply" && !said) throw new HttpError(400, "Say something first.");
  const remaining = TUTOR_MAX_SECONDS - seconds;
  let prompt = said;
  if (mode === "start" || mode === "nudge") prompt = TURN_NOTES[mode];
  else if (mode === "closing") prompt = said ? `${said}\n\n${TURN_NOTES.closing}` : TURN_NOTES.closing;
  else if (remaining <= WRAP_UP_SECONDS) prompt = `${said}\n\n${wrapUpNote(remaining)}`;
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

  if (said) emit({ type: "heard", text: said });
  const chunker = createSpeechChunker();
  const delivered = [];
  let openGate;
  const gate = new Promise((resolve) => { openGate = resolve; });
  const queue = createSpeechQueue({
    config,
    voice: session.voice,
    signal,
    tts,
    gate,
    onAudio: (item) => {
      if (signal?.aborted) return; // the student cut in; nothing more reaches them
      delivered.push(item.text);
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
  let raw = "";
  let shown = "";
  let step = 0;
  let ended = false;
  let failure = null;
  // Hold back the start of the reply until the step tag is resolved, then stream the rest.
  const release = (final) => {
    let body = raw;
    if (!step) {
      const tag = body.match(STEP_TAG);
      if (tag) step = Number(tag[1]) || 0;
      else if (!final && /^\s*\[?\s*(s(t(e(p\s*\d*\s*\]?)?)?)?)?$/i.test(body)) return;
    }
    body = body
      .replace(/\[\s*step\s*(\d+)\s*\]\s*/gi, (_, n) => { step = Number(n) || step; return ""; })
      .replace(/\[\s*end\s*\]/gi, () => { ended = true; return ""; })
      .replace(/\[[^\]]*\]\s*/g, "");
    if (!final) body = body.replace(/\[[^\]]*$/, ""); // an unfinished tag
    const delta = body.slice(shown.length);
    if (!delta) return;
    shown = body;
    emit({ type: "text", delta });
    for (const chunk of chunker.push(delta)) queue.add(chunk);
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
  if (!signal?.aborted) for (const chunk of chunker.flush()) queue.add(chunk);
  await queue.close();
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
  if (reply) transcript.push({ role: "tutor", text: reply, step: step || lastStep(session), at: Math.round(seconds), ...(interrupted ? { interrupted: true } : {}) });
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
    voice: session.voice,
    instructions: session.instructions || "",
    plan: { goal: session.plan?.goal || "", steps: (session.plan?.steps || []).map((step) => ({ title: step.title, check: step.check || "" })) },
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
