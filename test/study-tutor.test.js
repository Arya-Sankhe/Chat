import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  TUTOR_MAX_SECONDS,
  createSpeechChunker,
  endTutorSession,
  normalizeTutorOptions,
  publicTutorSession,
  recapLine,
  summarizeTutorSession,
  runTutorTurn,
  tutorMessages,
  tutorTurnGuard
} from "../server/study/tutor.js";
import { endOfTurnSilence, looksComplete, tutorMeta, tutorOptionsMarkup, tutorViewMarkup } from "../public/js/studyTutor.js";

const clip = fs.readFileSync(new URL("../public/audio/voices/af_heart.mp3", import.meta.url));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plan = { goal: "Explain blood pressure control.", steps: [{ title: "MAP", points: ["MAP = CO x TPR"], check: "What is MAP?" }, { title: "Baroreflex", points: ["Carotid sinus"], check: "" }], notes: "Notes." };

function session(extra = {}) {
  return { id: "tut-1", project_id: "course-1", title: "Blood pressure", style: "professor", voice: "bf_emma", instructions: "", plan, source_text: "Material.", transcript: [], status: "ready", active_seconds: 0, provider_pin: null, started_at: null, ...extra };
}

function harness(rows = {}) {
  let row = session(rows);
  const db = {
    async checkApiBudget() { return { allowed: true }; },
    async recordApiUsageCost() { return {}; },
    async updateStudyTutorSession(userId, id, patch) { row = { ...row, ...patch }; return row; }
  };
  const context = { db, user: { id: "user-1" }, subscription: null, plan: { id: "pro", monthlyApiCreditLimit: 10 } };
  const config = { providers: { openrouter: { apiKey: "k", baseUrl: "https://or.test/api/v1" } }, desktop: { meteringMode: "legacy" } };
  return { context, config, get row() { return row; } };
}

// Streams the given deltas as an OpenRouter SSE response; `hang` keeps the stream open until aborted.
function stubFetch({ deltas, provider = "DeepInfra", hang = false, requests = [] }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes("/endpoints")) return new Response("{}", { status: 404 });
    if (href.includes("/generation")) return new Response("{}", { status: 404 });
    requests.push(JSON.parse(init.body));
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        for (const delta of deltas) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "gen-1", model: "deepseek/deepseek-v4-flash-0731", provider, choices: [{ delta: { content: delta } }] })}\n\n`));
        if (hang) {
          await new Promise((resolve) => init.signal.addEventListener("abort", resolve, { once: true }));
          controller.error(new DOMException("Aborted", "AbortError"));
          return;
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "gen-1", choices: [], usage: { cost: 0.0002 } })}\n\ndata: [DONE]\n\n`));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return () => { globalThis.fetch = original; };
}

test("options keep only known styles and voices and cap instructions", () => {
  assert.deepEqual(normalizeTutorOptions({ style: "nope", voice: "zz", instructions: "x".repeat(900) }).style, "teacher");
  const picked = normalizeTutorOptions({ style: "socratic", voice: "am_puck", instructions: "  Be quick.  " });
  assert.deepEqual(picked, { style: "socratic", voice: "am_puck", instructions: "Be quick." });
});

test("the speech chunker releases the first sentence early and never leaves a short tail alone", () => {
  const chunker = createSpeechChunker();
  const streamed = [];
  for (const piece of ["Right, that is the baroreceptor reflex, nice foresight! ", "But first, back to the math: if stroke volume doubles, ", "cardiac output goes up, so pressure goes up too. ", "Make sense?"]) streamed.push(...chunker.push(piece));
  const flushed = chunker.flush();
  assert.deepEqual(streamed, ["Right, that is the baroreceptor reflex, nice foresight!"]);
  assert.deepEqual(flushed, ["But first, back to the math: if stroke volume doubles, cardiac output goes up, so pressure goes up too. Make sense?"]);
  const short = createSpeechChunker();
  assert.deepEqual([...short.push("Hey there, great to see you today! Ready?"), ...short.flush()], ["Hey there, great to see you today! Ready?"]);
});

test("each turn replays earlier turns exactly so the provider cache prefix holds", () => {
  const first = tutorMessages(session(), { role: "cue", prompt: "(start)" });
  const later = tutorMessages(session({ transcript: [{ role: "cue", prompt: "(start)" }, { role: "tutor", text: "Hello. What is MAP?", step: 1 }] }), { role: "student", text: "CO times TPR.", prompt: "CO times TPR." });
  assert.deepEqual(later.slice(0, first.length), first);
  assert.deepEqual(later.at(-2), { role: "assistant", content: "[step 1] Hello. What is MAP?" });
  assert.equal(later.at(-1).content, "CO times TPR.");
  assert.match(first[0].content, /Strict professor running an oral exam/);
  assert.match(first[0].content, /Step 2: Baroreflex/);
});

test("turns are refused once the call is over its time", () => {
  assert.throws(() => tutorTurnGuard(session(), { mode: "reply", elapsed: 0 }), /Start the call first/);
  const live = session({ status: "live", started_at: new Date(Date.now() - 40 * 60_000).toISOString() });
  assert.throws(() => tutorTurnGuard(live, { mode: "reply", elapsed: TUTOR_MAX_SECONDS + 60 }), /time limit/);
  assert.equal(tutorTurnGuard(live, { mode: "closing", elapsed: TUTOR_MAX_SECONDS + 60 }) > TUTOR_MAX_SECONDS, true);
  assert.throws(() => tutorTurnGuard(session({ status: "ended" }), { mode: "reply" }), /has ended/);
});

test("a turn streams text and in-order audio, saves the transcript, and pins the host", async () => {
  const h = harness({ status: "live", started_at: new Date().toISOString() });
  const requests = [];
  const restore = stubFetch({ deltas: ["[st", "ep 2] Not quite. ", "It is cardiac output times resistance. ", "Now, where are the baroreceptors?"], requests });
  const events = [];
  const spoken = [];
  try {
    const result = await runTutorTurn({
      context: h.context,
      config: h.config,
      session: h.row,
      text: "Heart rate times resistance?",
      elapsed: 90,
      emit: (event) => events.push(event),
      tts: async ({ text }) => { spoken.push(text); return clip; }
    });
    assert.equal(result.step, 2);
  } finally {
    restore();
  }
  assert.equal(events[0].type, "heard");
  const text = events.filter((event) => event.type === "text").map((event) => event.delta).join("");
  assert.equal(text, "Not quite. It is cardiac output times resistance. Now, where are the baroreceptors?");
  const audio = events.filter((event) => event.type === "audio");
  assert.deepEqual(audio.map((event) => event.seq), audio.map((_, index) => index));
  assert.ok(audio.every((event) => event.audio && !event.text.includes("[")));
  assert.equal(events.at(-1).type, "done");
  assert.equal(requests[0].messages.at(-1).content, "Heart rate times resistance?");
  assert.equal(requests[0].reasoning.enabled, false);
  const saved = h.row.transcript;
  assert.deepEqual(saved.map((item) => item.role), ["student", "tutor"]);
  assert.equal(saved[1].step, 2);
  assert.equal(saved[1].text, text);
  assert.equal(h.row.provider_pin, "DeepInfra");
});

test("the first turn starts the clock and later turns ask for the pinned host", async () => {
  const h = harness();
  const requests = [];
  let restore = stubFetch({ deltas: ["[step 1] Hello there. What is MAP?"], requests });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, mode: "start", emit: () => {}, tts: async () => clip });
  } finally {
    restore();
  }
  assert.equal(h.row.status, "live");
  assert.ok(h.row.started_at);
  assert.deepEqual(h.row.transcript.map((item) => item.role), ["cue", "tutor"]);
  restore = stubFetch({ deltas: ["[step 1] Good."], requests, provider: "Relace" });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, text: "Cardiac output times resistance.", elapsed: 20, emit: () => {}, tts: async () => clip });
  } finally {
    restore();
  }
  assert.equal(requests[1].provider.order[0], "deepinfra/fp8");
  assert.equal(h.row.provider_pin, "DeepInfra");
});

test("an interrupted turn keeps only what reached the student as speech", async () => {
  const h = harness({ status: "live", started_at: new Date().toISOString() });
  const controller = new AbortController();
  const restore = stubFetch({ deltas: ["[step 1] That is exactly right, well done there. ", "Now tell me about the carotid sinus and"], hang: true });
  const events = [];
  try {
    const run = runTutorTurn({
      context: h.context,
      config: h.config,
      session: h.row,
      text: "It's cardiac output times resistance.",
      elapsed: 40,
      signal: controller.signal,
      emit: (event) => {
        events.push(event);
        if (event.type === "audio") controller.abort();
      },
      tts: async () => clip
    });
    await run;
  } finally {
    restore();
  }
  const tutor = h.row.transcript.find((item) => item.role === "tutor");
  assert.equal(tutor.text, "That is exactly right, well done there.");
  assert.equal(tutor.interrupted, true);
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("near the end of the call the tutor is told to wrap up, and closing ends the call", async () => {
  const h = harness({ status: "live", started_at: new Date(Date.now() - 29 * 60_000).toISOString() });
  const requests = [];
  let restore = stubFetch({ deltas: ["[step 2] Good."], requests });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, text: "The carotid sinus.", elapsed: 28 * 60, emit: () => {}, tts: async () => clip });
  } finally {
    restore();
  }
  assert.match(requests[0].messages.at(-1).content, /^The carotid sinus\.\n\n\(About 2 minutes left/);
  const events = [];
  restore = stubFetch({ deltas: ["[step 2] That's our time. Goodbye!"], requests });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, mode: "closing", elapsed: TUTOR_MAX_SECONDS + 5, emit: (event) => events.push(event), tts: async () => clip });
  } finally {
    restore();
  }
  assert.match(requests[1].messages.at(-1).content, /Time is up/);
  assert.equal(events.at(-1).ended, true);
});

test("ending a call writes the recap and caps the recorded length", async () => {
  const h = harness({ status: "live", started_at: new Date(Date.now() - 31 * 60_000).toISOString(), transcript: [{ role: "tutor", text: "Hi.", step: 1 }, { role: "student", text: "Hello.", prompt: "Hello." }] });
  let seen = null;
  const ended = await endTutorSession({
    context: h.context,
    config: h.config,
    session: h.row,
    elapsed: TUTOR_MAX_SECONDS + 40,
    summarize: async ({ session: current }) => { seen = current; return { overview: "Good call.", concepts: [], strengths: [], review: [], next: "" }; }
  });
  assert.ok(seen);
  assert.equal(ended.status, "ended");
  assert.equal(ended.active_seconds, TUTOR_MAX_SECONDS);
  assert.equal(ended.summary.overview, "Good call.");
  const shown = publicTutorSession(ended);
  assert.equal(shown.transcript.length, 2);
  assert.equal("source_text" in shown, false);
  assert.equal(shown.transcript.some((line) => "prompt" in line), false);
});

test("turn-taking waits longer for answers that sound unfinished", () => {
  assert.equal(looksComplete("It's cardiac output times resistance."), true);
  assert.equal(looksComplete("So it's the cardiac output and"), false);
  assert.equal(looksComplete("I think it's, um..."), false);
  assert.equal(looksComplete("Yes."), true);
  assert.equal(looksComplete("the"), false);
  assert.ok(endOfTurnSilence({ answering: true, complete: false, voicedMs: 3000 }) > endOfTurnSilence({ answering: true, complete: true, voicedMs: 3000 }));
  assert.ok(endOfTurnSilence({ answering: true, complete: true, voicedMs: 3000 }) > endOfTurnSilence({ answering: false, complete: true, voicedMs: 3000 }));
  assert.ok(endOfTurnSilence({ answering: false, complete: null, voicedMs: 300 }) >= 3600);
});

test("create options and views render every state", () => {
  const options = tutorOptionsMarkup({ escapeHtml });
  for (const title of ["Patient teacher", "Study buddy", "Socratic guide", "Strict professor"]) assert.ok(options.includes(title), title);
  assert.ok(options.includes('name="instructions" maxlength="1000"'));
  assert.ok(options.includes('data-voice-preview="bf_emma"'));
  const shown = publicTutorSession(session({ created_at: "2026-09-25T00:00:00Z" }));
  const ready = tutorViewMarkup({ kind: "tutor", id: "tut-1", session: shown }, null, { escapeHtml });
  assert.ok(ready.includes("data-tutor-start") && ready.includes("Baroreflex"));
  const live = tutorViewMarkup({ kind: "tutor", id: "tut-1", session: shown }, null, { escapeHtml, callActive: true });
  assert.ok(live.includes("dojo-tutor-slot"));
  const prep = tutorViewMarkup({ kind: "tutor", id: "p", preparing: true, stage: "planning" }, { title: "New", style: "buddy" }, { escapeHtml });
  assert.match(prep, /is-done[^]*Reading your sources[^]*is-now[^]*Planning the lesson/);
  const review = tutorViewMarkup({ kind: "tutor", id: "tut-1", session: { ...shown, status: "ended", activeSeconds: 600, transcript: [{ role: "student", text: "<b>hi</b>", at: 4 }], summary: { overview: "Covered MAP.", concepts: [{ term: "MAP", detail: "CO x TPR" }], strengths: ["Definitions"], review: [], next: "" } } }, null, { escapeHtml });
  assert.ok(review.includes("Covered MAP.") && review.includes("&#60;b&#62;hi"));
  assert.equal(tutorMeta({ style: "professor", status: "ended", activeSeconds: 1142 }), "19m 2s · Strict professor");
});

test("recap list items that come back as objects are flattened, not [object Object]", async () => {
  assert.equal(recapLine({ topic: "BNF notation.", correction: "Rules define how statements are built." }), "BNF notation: Rules define how statements are built.");
  assert.equal(recapLine({ item: "Syntax vs semantics" }), "Syntax vs semantics");
  assert.equal(recapLine(null), "");
  const summary = await summarizeTutorSession({
    session: { plan: { steps: [{ title: "Intro" }] }, transcript: [{ role: "tutor", text: "Hi" }, { role: "student", text: "Hello" }] },
    complete: async () => ({ content: JSON.stringify({ overview: "o", concepts: [], strengths: ["good"], review: [{ topic: "BNF", detail: "Practise writing rules." }], next: "n" }) })
  });
  assert.deepEqual(summary.review, ["BNF: Practise writing rules."]);
  assert.equal(JSON.stringify(summary).includes("[object Object]"), false);
});

test("no speech is synthesized when the turn's speech reservation is refused", async () => {
  const h = harness({ status: "live", started_at: new Date().toISOString() });
  let checks = 0;
  h.context.db.checkApiBudget = async () => ({ allowed: (checks += 1) > 1 }); // the speech check runs first
  const restore = stubFetch({ deltas: ["[step 1] Blood pressure depends on output and resistance. ", "What sets the resistance?"] });
  const events = [];
  let synthesized = 0;
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, text: "What is MAP?", elapsed: 10, emit: (event) => events.push(event), tts: async () => { synthesized += 1; return clip; } });
  } finally {
    restore();
  }
  assert.equal(synthesized, 0);
  assert.ok(events.filter((event) => event.type === "audio").every((event) => event.audio === null));
  assert.equal(events.at(-1).type, "done");
});

test("an opening cut off before any speech still starts the call", async () => {
  const h = harness();
  const controller = new AbortController();
  const restore = stubFetch({ deltas: [], hang: true });
  try {
    const run = runTutorTurn({ context: h.context, config: h.config, session: h.row, mode: "start", signal: controller.signal, emit: () => {}, tts: async () => clip });
    setTimeout(() => controller.abort(), 20);
    assert.equal(await run, null);
  } finally {
    restore();
  }
  assert.equal(h.row.status, "live");
  assert.ok(h.row.started_at);
  assert.doesNotThrow(() => tutorTurnGuard(h.row, { mode: "reply", elapsed: 5 }));
});
