import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOARD_LIMITS,
  blockNames,
  boardNames,
  cleanLessonBlock,
  cleanLessonBoard,
  compileExpression,
  curveSegments,
  describeBlock,
  layoutLesson,
  markSkeleton,
  parseBoardCue,
  wrapText
} from "../public/js/whiteboard/lesson.js";
import {
  chunkSpan,
  normalizeTutorBoard,
  normalizeTutorOptions,
  prepareTutorSession,
  publicTutorSession,
  runTutorTurn,
  tutorMessages,
  tutorSystemPrompt,
  withCues
} from "../server/study/tutor.js";
import { tutorOptionsMarkup, tutorViewMarkup } from "../public/js/studyTutor.js";

const clip = fs.readFileSync(new URL("../public/audio/voices/af_heart.mp3", import.meta.url));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PART_NAME = /^[\w-]{1,40}$/;

const board = cleanLessonBoard({
  steps: [
    { blocks: [
      { type: "formula", key: "map-formula", text: "MAP = CO × TPR", caption: "mean arterial pressure" },
      { type: "flow", key: "baro-loop", direction: "right", nodes: [{ key: "baro-stretch", text: "Stretch receptors fire" }, { key: "baro-brain", text: "Brainstem" }, { key: "baro-heart", text: "Heart slows" }] }
    ] },
    { blocks: [{ type: "table", key: "vessels", columns: ["Vessel", "Pressure"], rows: [["Artery", "High"], ["Vein", "Low"]] }] }
  ]
}, 2);
const plan = { goal: "Explain blood pressure control.", steps: [{ title: "MAP", points: ["MAP = CO x TPR"], check: "What is MAP?" }, { title: "Vessels", points: ["Arteries are high pressure"], check: "" }], notes: "Notes.", board };

function session(extra = {}) {
  return { id: "tut-b", project_id: "course-1", title: "Blood pressure", style: "teacher", voice: "bf_emma", instructions: "", plan, source_text: "Material.", transcript: [], status: "live", started_at: new Date().toISOString(), active_seconds: 0, provider_pin: null, ...extra };
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

function stubFetch({ deltas, requests = [] }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (href.includes("/endpoints") || href.includes("/generation")) return new Response("{}", { status: 404 });
    requests.push(JSON.parse(init.body));
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const delta of deltas) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "gen-1", model: "m", provider: "DeepInfra", choices: [{ delta: { content: delta } }] })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "gen-1", choices: [], usage: { cost: 0.0002 } })}\n\ndata: [DONE]\n\n`));
        controller.close();
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return () => { globalThis.fetch = original; };
}

/* ---------- Cleaning ---------- */

test("the planned board keeps usable blocks, drops broken ones, and gives every name once", () => {
  const cleaned = cleanLessonBoard({
    steps: [
      { blocks: [
        { type: "note", key: "Key Idea!", text: "Pressure  falls [quietly] along the tree." },
        { type: "note", key: "key-idea", text: "Same key, renamed." },
        { type: "flow", key: "lonely", nodes: [{ text: "Only one" }] },
        { type: "video", key: "nope" },
        { type: "plot", key: "curve", x: { min: 5, max: 1 }, y: { label: "y" }, curves: [{ key: "bad", fn: "alert(1)" }, { key: "good", fn: "x^2" }] }
      ] },
      { blocks: [] },
      { blocks: [{ type: "note", key: "extra-step", text: "There is no third step." }] }
    ]
  }, 2);
  assert.equal(cleaned.steps.length, 2);
  const [note, renamed, plot] = cleaned.steps[0].blocks;
  assert.deepEqual([note.key, note.text], ["key-idea", "Pressure falls quietly along the tree."]);
  assert.equal(renamed.key, "key-idea-2");
  assert.equal(plot.type, "plot");
  assert.deepEqual(plot.x, { label: "x", min: 0, max: 10 }, "a backwards range falls back to a sensible one");
  assert.deepEqual(plot.curves.map((curve) => curve.key), ["good"], "an expression that doesn't parse is dropped");
  assert.equal(cleaned.steps[1].blocks.length, 0);
  assert.equal(cleanLessonBoard({ steps: [{ blocks: [{ type: "note" }] }] }, 1), null, "nothing usable means no board");
  const names = [...boardNames(cleaned)];
  assert.equal(names.length, new Set(names).size);
  assert.ok(names.every((name) => PART_NAME.test(name)));
});

test("a dropped block frees its names, and step names are reserved", () => {
  const used = new Set(["step-1"]);
  assert.equal(cleanLessonBlock({ type: "flow", key: "taken", nodes: [{ key: "a", text: "x" }] }, used), null);
  assert.deepEqual([...used], ["step-1"]);
  const block = cleanLessonBlock({ type: "tree", key: "step-1", root: { text: "Root" }, children: [{ text: "Left", children: [{ text: "Leaf" }] }] }, used);
  assert.notEqual(block.key, "step-1");
  assert.ok(blockNames(block).every((name) => used.has(name)));
});

test("sketches are checked like Klui's diagrams and their arrows follow renamed parts", () => {
  const used = new Set(["cell"]);
  const sketch = cleanLessonBlock({ type: "sketch", key: "drawing", ops: [
    { op: "shape", key: "cell", shape: "ellipse", x: 0, y: 0, width: 300, height: 200, text: "Cell" },
    { op: "shape", key: "nucleus", shape: "ellipse", x: 400, y: 50, width: 120, height: 80, text: "Nucleus" },
    { op: "connect", from: "cell", to: "nucleus", label: "holds" }
  ] }, used);
  assert.deepEqual(sketch.ops.map((op) => op.key || `${op.from}->${op.to}`), ["cell-2", "nucleus", "cell-2->nucleus"]);
  assert.equal(cleanLessonBlock({ type: "sketch", key: "bad", ops: [{ op: "shape", key: "x", shape: "star", x: 0, y: 0, width: 10, height: 10 }] }, new Set()), null);
});

test("plot expressions are arithmetic only, never code", () => {
  assert.equal(compileExpression("2x^2 - 3")(2), 5);
  assert.equal(compileExpression("-x^2")(3), -9);
  assert.ok(Math.abs(compileExpression("sin(pi x / 2)")(1) - 1) < 1e-9);
  assert.equal(compileExpression("2(x+1)")(1), 4);
  assert.equal(compileExpression("e^0 + ln(e)")(0), 2);
  for (const bad of ["alert(1)", "x;1", "constructor", "x[0]", "(x", "process.exit()", "x x x x".repeat(40)]) assert.equal(compileExpression(bad), null, bad);
  const segments = curveSegments({ fn: "1/x" }, { min: -2, max: 2 }, { min: -5, max: 5 });
  assert.equal(segments.length, 2, "a curve leaving the range splits rather than jumping across");
});

test("cues are read from the tutor's tags", () => {
  assert.deepEqual(parseBoardCue("show baro-loop"), { op: "show", key: "baro-loop" });
  assert.deepEqual(parseBoardCue(" Point  MAP-Formula "), { op: "point", key: "map-formula" });
  assert.deepEqual(parseBoardCue("circle vessels-r1"), { op: "mark", key: "vessels-r1" });
  assert.deepEqual(parseBoardCue("write: CO = HR × SV"), { op: "write", text: "CO = HR × SV" });
  assert.deepEqual(parseBoardCue("draw: a heart with four chambers"), { op: "draw", text: "a heart with four chambers" });
  assert.deepEqual(parseBoardCue("ask to draw"), { op: "ask" });
  for (const other of ["step 2", "end", "show", "show two words", "write:", "laugh"]) assert.equal(parseBoardCue(other), null, other);
});

/* ---------- Layout ---------- */

test("the laid-out board names every element, keeps ids unique, and runs steps left to right", () => {
  const laid = layoutLesson(board, plan.steps);
  assert.equal(laid.length, 2);
  assert.ok(laid[1].x > laid[0].x + 1500);
  const ids = new Set();
  for (const step of laid) {
    for (const part of [step.heading, step.space, ...step.blocks]) {
      const parts = new Set(part.pieces.map((piece) => piece.part));
      for (const piece of part.pieces) {
        for (const needed of piece.needs || []) assert.ok(parts.has(needed), `${part.key} connector needs ${needed}`);
        for (const skeleton of piece.skeletons) {
          assert.ok(skeleton.id && skeleton.id.length <= 64 && !ids.has(skeleton.id), skeleton.id);
          ids.add(skeleton.id);
          assert.equal(skeleton.customData?.klui, true);
          assert.match(skeleton.customData.name, PART_NAME);
          assert.ok(Number.isFinite(skeleton.x) && Number.isFinite(skeleton.y));
        }
      }
    }
    // Blocks stack down the column without overlapping.
    step.blocks.reduce((bottom, block) => { assert.ok(block.y >= bottom); return block.y + block.height; }, 0);
  }
  const flow = laid[0].blocks[1];
  assert.equal(flow.pieces.filter((piece) => piece.needs).length, 2, "a three-step flow has two arrows, each waiting for both ends");
});

test("every block type lays out within the tutor's column", () => {
  const all = cleanLessonBoard({ steps: [{ blocks: [
    { type: "timeline", key: "t", events: [{ label: "1628", text: "Harvey" }, { label: "1733", text: "Hales measures pressure" }] },
    { type: "compare", key: "c", left: { title: "Arteries", points: ["Thick walls"] }, right: { title: "Veins", points: ["Valves"] } },
    { type: "flow", key: "cyc", cycle: true, nodes: ["Fill", "Contract", "Eject", "Relax"] },
    { type: "plot", key: "p", x: { label: "time", min: 0, max: 10 }, y: { label: "BP", min: 0, max: 150 }, curves: [{ key: "bp", points: [[0, 80], [5, 120], [10, 80]] }], marks: [{ key: "peak", x: 5, y: 120, label: "systole" }, { x: 50, y: 1 }] }
  ] }] }, 1);
  const [step] = layoutLesson(all, [{ title: "All" }]);
  for (const block of step.blocks) {
    for (const skeleton of block.pieces.flatMap((piece) => piece.skeletons)) {
      assert.ok(skeleton.x >= -1 && skeleton.x <= 960 + 200, `${block.key} ${skeleton.type} at ${skeleton.x}`);
    }
  }
  const plot = step.blocks.find((block) => block.key === "p");
  assert.equal(plot.pieces.filter((piece) => piece.part === "peak").length, 1);
  assert.equal(plot.pieces.some((piece) => piece.part === "p-pt2"), false, "a marked point outside the ranges isn't drawn");
  assert.match(describeBlock(all.steps[0].blocks[2]), /^cyc \(cycle\)/);
});

test("a teacher's circle is one stroke that slightly overshoots its start", () => {
  const mark = markSkeleton({ x: 0, y: 0, width: 200, height: 100 }, "baro-brain", "m-1");
  assert.equal(mark.type, "line");
  assert.equal(mark.customData.name, "mark-baro-brain");
  assert.ok(mark.points.length > 20);
  assert.equal(wrapText("one two three four", 9), "one two\nthree\nfour");
});

/* ---------- Server: prompt and options ---------- */

test("the whiteboard is on unless turned off, and only boards get board cues in the prompt", () => {
  assert.equal(normalizeTutorOptions({}).board, true);
  assert.equal(normalizeTutorOptions({ board: false }).board, false);
  const prompt = tutorSystemPrompt(session());
  assert.match(prompt, /Whiteboard:/);
  assert.match(prompt, /map-formula \(formula\): "MAP = CO × TPR"/);
  assert.match(prompt, /baro-stretch "Stretch receptors fire"/);
  assert.match(prompt, /\[show KEY\]/);
  assert.match(prompt, /brackets other than the step tag and board cues/);
  const plain = tutorSystemPrompt(session({ plan: { ...plan, board: null } }));
  assert.doesNotMatch(plain, /Whiteboard:|\[show KEY\]/);
});

test("the board's names travel with the session; the board itself is opened by id", () => {
  const shown = publicTutorSession(session({ plan: { ...plan, boardId: "b-1" } }));
  assert.equal(shown.boardId, "b-1");
  assert.equal(shown.plan.board.steps.length, 2);
  assert.equal(publicTutorSession(session({ plan: { ...plan, board: undefined } })).plan.board, null);
});

test("planning sketches the board after the lesson, and a failed sketch leaves a voice-only lesson", async () => {
  const stages = [];
  const warnings = [];
  const created = [];
  const lessonJson = JSON.stringify({ title: "BP", goal: "Goal", steps: [{ title: "MAP", points: ["a"], check: "?" }], notes: "n" });
  const context = { db: { async createStudyTutorSession(userId, row) { created.push(row); return { id: "s", ...row }; } }, user: { id: "u" } };
  const source = { note: { title: "Notes", content: "Blood pressure is cardiac output times resistance." } };
  const answers = [lessonJson, JSON.stringify({ steps: [{ blocks: [{ type: "note", key: "rule", text: "MAP is CO times TPR." }] }] })];
  const complete = async () => ({ content: answers.shift() });
  const prepare = (opts) => prepareTutorSession({ context, config: {}, course: { id: "c" }, source, options: opts, complete, onStage: (s) => stages.push(s), onWarning: (w) => warnings.push(w) });
  await prepare({ board: true });
  assert.deepEqual(stages.filter((s) => s !== "reading"), ["planning", "drawing", "saving"]);
  assert.equal(created[0].plan.board.steps[0].blocks[0].key, "rule");
  answers.push(lessonJson, "not json at all");
  await prepare({ board: true });
  assert.equal(created[1].plan.board, null);
  assert.match(warnings.at(-1), /voice only/);
  stages.length = 0;
  answers.push(lessonJson);
  await prepare({ board: false });
  assert.equal(created[2].plan.board, null);
  assert.equal(stages.includes("drawing"), false);
});

test("student board context keeps only valid names and small real images", () => {
  assert.equal(normalizeTutorBoard(null), null);
  assert.equal(normalizeTutorBoard({ pointing: ["", "x y", "<b>"] }), null);
  const png = fs.readFileSync(new URL("./fixtures/tiny.png", import.meta.url), { encoding: null });
  const ctx = normalizeTutorBoard({ pointing: ["baro-brain", "baro-brain", "a".repeat(41)], writing: " CO = HR × SV ", image: { data: png.toString("base64") } });
  assert.deepEqual(ctx.pointing, ["baro-brain"]);
  assert.equal(ctx.writing, "CO = HR × SV");
  assert.equal(ctx.image.mime, "image/png");
  assert.throws(() => normalizeTutorBoard({ image: { data: "not base64!" } }), /too large/);
  assert.throws(() => normalizeTutorBoard({ image: { data: Buffer.from("GIF89a-not-allowed-here-padding").toString("base64") } }));
});

/* ---------- Server: live turns ---------- */

test("cue offsets and chunk spans line up with the spoken text", () => {
  const text = "First idea here. Then the second idea.";
  const span = chunkSpan(text, "Then the second idea.", 10);
  assert.equal(text.slice(span.start, span.end), "Then the second idea.");
  const cued = withCues(text, [{ at: 0, cue: { op: "step", n: 1 } }, { at: 17, cue: { op: "show", key: "a" } }, { at: 38, cue: { op: "add", text: "a cell", block: {} } }]);
  assert.equal(cued, "First idea here. [show a] Then the second idea.[draw: a cell]");
  assert.equal(withCues(text, [{ at: 30, cue: { op: "point", key: "b" } }], 16), "First idea here.");
});

test("a board turn sends cues placed in the speech, drops unknown keys, and remembers them", async () => {
  const h = harness();
  const events = [];
  const requests = [];
  const restore = stubFetch({ requests, deltas: ["[step 1] Pressure has a formula. [show map-formula]It is cardiac output times resistance. [point made-up-key]", " Then the reflex [sh", "ow baro-stretch] starts with stretch receptors. [mark map-formula] Does that make sense?"] });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, text: "Tell me about pressure.", elapsed: 30, emit: (event) => events.push(event), tts: async () => clip });
  } finally {
    restore();
  }
  const text = events.filter((event) => event.type === "text").map((event) => event.delta).join("");
  assert.ok(!text.includes("["), text);
  const cues = events.filter((event) => event.type === "board");
  assert.deepEqual(cues.map((event) => event.cue.op), ["step", "show", "show", "mark"]);
  assert.equal(text.slice(cues[1].at).startsWith("It is cardiac output"), true);
  assert.equal(text.slice(cues[2].at).startsWith("starts with stretch"), true);
  const audio = events.filter((event) => event.type === "audio");
  for (const item of audio) assert.equal(text.slice(item.start, item.end), item.text);
  // Every cue was sent before the audio it belongs to finished arriving, and before done.
  assert.ok(events.findIndex((event) => event.type === "board" && event.cue.op === "mark") < events.findIndex((event) => event.type === "done"));
  const tutor = h.row.transcript.at(-1);
  assert.match(tutor.cued, /\[show map-formula\] It is cardiac output/);
  assert.doesNotMatch(tutor.cued, /made-up-key|\[step/);
  assert.equal(tutor.text, text.replace(/\s+/g, " ").trim());
  const replay = tutorMessages(h.row, null).at(-1);
  assert.match(replay.content, /^\[step 1\] Pressure has a formula\. \[show map-formula\]/);
});

test("a [draw] cue sketches alongside the reply, and the next turn learns the sketch's key", async () => {
  const h = harness();
  const events = [];
  const asked = [];
  let restore = stubFetch({ deltas: ["[step 1] Let me sketch it. [draw: a heart with four chambers] The top two are the atria. [draw: a second one] What do you notice?"] });
  try {
    await runTutorTurn({
      context: h.context, config: h.config, session: h.row, text: "What does the heart look like?", elapsed: 30, emit: (event) => events.push(event), tts: async () => clip,
      improvise: async ({ description, used }) => {
        asked.push(description);
        return cleanLessonBlock({ type: "flow", key: "heart-sketch", nodes: [{ key: "atria", text: "Atria" }, { key: "map-formula", text: "Ventricles" }] }, used);
      }
    });
  } finally {
    restore();
  }
  assert.deepEqual(asked, ["a heart with four chambers"], "one sketch per reply");
  const add = events.find((event) => event.type === "board" && event.cue.op === "add");
  assert.equal(add.cue.block.key, "heart-sketch");
  assert.notEqual(add.cue.block.nodes[1].key, "map-formula", "a sketch can't take a name already on the board");
  assert.ok(events.indexOf(add) < events.findIndex((event) => event.type === "done"));
  assert.deepEqual(h.row.transcript.at(-1).drawn, [{ key: "heart-sketch", text: "a heart with four chambers", parts: ["atria", add.cue.block.nodes[1].key] }]);
  const requests = [];
  restore = stubFetch({ requests, deltas: ["[step 1] [point atria] Right, those are the atria. Next?"] });
  try {
    const later = [];
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, text: "The top ones are smaller.", elapsed: 60, emit: (event) => later.push(event), tts: async () => clip });
    assert.deepEqual(later.filter((event) => event.type === "board").map((event) => event.cue), [{ op: "step", n: 1 }, { op: "point", key: "atria" }]);
  } finally {
    restore();
  }
  assert.match(requests[0].messages.at(-1).content, /^\(Your sketch "a heart with four chambers" is now on the board as heart-sketch, with parts atria, map-formula-2\.\)\n\nThe top ones are smaller\./);
});

test("what the student drew and selected reaches the tutor as notes before their words", async () => {
  const h = harness();
  const requests = [];
  const seen = [];
  const restore = stubFetch({ requests, deltas: ["[step 1] Nice diagram. [mark baro-brain] Which way does the signal go?"] });
  try {
    await runTutorTurn({
      context: h.context, config: h.config, session: h.row, text: "Is this right?", elapsed: 30, emit: () => {}, tts: async () => clip,
      board: { pointing: ["baro-brain"], writing: "", image: { mime: "image/png", data: "AAAA" } },
      describe: async ({ image }) => { seen.push(image.mime); return "Two boxes, Receptors and Brain, joined by an arrow."; }
    });
  } finally {
    restore();
  }
  assert.deepEqual(seen, ["image/png"]);
  const content = requests[0].messages.at(-1).content;
  assert.equal(content, "(On the board, the student has selected: baro-brain.)\n(The student just drew on the whiteboard: Two boxes, Receptors and Brain, joined by an arrow.)\n\nIs this right?");
  assert.equal(h.row.transcript.at(-2).prompt, content, "the note is saved with the turn so the cached prefix replays it exactly");
});

test("calls without a board ignore cue tags and send no board events", async () => {
  const h = harness({ plan: { ...plan, board: null } });
  const events = [];
  const restore = stubFetch({ deltas: ["[step 1] Hello. [show map-formula] Ready?"] });
  try {
    await runTutorTurn({ context: h.context, config: h.config, session: h.row, mode: "start", emit: (event) => events.push(event), tts: async () => clip, board: { pointing: ["x"] } });
  } finally {
    restore();
  }
  assert.equal(events.some((event) => event.type === "board"), false);
  assert.equal(h.row.transcript.at(-1).cued, undefined);
  assert.equal(h.row.transcript.at(-1).text, "Hello. Ready?");
});

/* ---------- Views ---------- */

test("the create dialog offers the whiteboard and the recap opens the lesson board", () => {
  assert.match(tutorOptionsMarkup({ escapeHtml }), /name="board" value="on" checked/);
  assert.doesNotMatch(tutorOptionsMarkup({ escapeHtml, board: false }), /name="board" value="on" checked/);
  const shown = publicTutorSession(session({ plan: { ...plan, boardId: "b-9" }, status: "ended", summary: null, transcript: [] }));
  const review = tutorViewMarkup({ kind: "tutor", id: "tut-b", session: shown }, null, { escapeHtml });
  assert.match(review, /data-tutor-board-open="b-9"/);
  const prep = tutorViewMarkup({ kind: "tutor", id: "p", preparing: true, stage: "drawing", board: true }, { title: "New", style: "buddy" }, { escapeHtml });
  assert.match(prep, /is-now[^>]*><span><\/span>Sketching the whiteboard/);
  const voiceOnly = tutorViewMarkup({ kind: "tutor", id: "p", preparing: true, stage: "planning", board: false }, { title: "New", style: "buddy" }, { escapeHtml });
  assert.doesNotMatch(voiceOnly, /Sketching the whiteboard/);
  assert.ok(BOARD_LIMITS.extras > 0);
});
