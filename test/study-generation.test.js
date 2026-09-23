import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanQuestions,
  loadGenerationSourceText,
  loadMaterialText,
  parseMarkdownNote,
  parseStudyJson
} from "../server/study/generate.js";
import { salvageJsonObjects } from "../server/study/jsonSalvage.js";
import { selectVisionCandidates, mergePageTexts, collectDigitalPageText } from "../server/study/vision.js";

const here = dirname(fileURLToPath(import.meta.url));

test("exact-page study generation reads only the requested page", async () => {
  const context = { user: { id: "user-1" }, db: {
    async listDocumentChunksForFiles() {
      return [
        { text: "Wrong page details", metadata: { page: 4 } },
        { text: "Page five clinical finding", metadata: { page: 5 } },
        { text: "Later page details", metadata: { page: 6 } }
      ];
    }
  } };
  const source = { documentFile: { id: "doc-1", kind: "txt", page_count: 6, file_name: "Respiratory.txt" } };
  const documents = { async ensureDocumentPages() { return [{ page_number: 5, text: "Page five table" }]; } };
  const text = await loadGenerationSourceText({ context, config: {}, source, pageNumber: 5, documents });
  assert.match(text, /Page five clinical finding/);
  assert.match(text, /Page five table/);
  assert.doesNotMatch(text, /Wrong page|Later page/);
  await assert.rejects(() => loadGenerationSourceText({ context, config: {}, source, pageNumber: 7, documents }), /outside this document/);
});

test("SOURCE_CHAR_LIMIT is removed; loadMaterialText uses full chunks", async () => {
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.doesNotMatch(generate, /SOURCE_CHAR_LIMIT/);
  const long = "x".repeat(50_000);
  const text = await loadMaterialText({
    async listDocumentChunksForFiles() {
      return [{ text: long, metadata: { page: 1 } }, { text: "tail", metadata: { page: 2 } }];
    }
  }, "user-1", { documentFile: { id: "doc-1" } });
  assert.equal(text.length, 50_005);
  assert.match(text, /tail$/);
});

test("parseMarkdownNote takes first H1 and keeps partial markdown", () => {
  const parsed = parseMarkdownNote("# Photosynthesis\n\n- Light reactions\n- Calvin cycle", {
    fallbackTitle: "Doc.pdf"
  });
  assert.equal(parsed.title, "Photosynthesis");
  assert.match(parsed.content, /^# Photosynthesis/);
  assert.match(parsed.content, /Calvin cycle/);

  const untitled = parseMarkdownNote("Just a paragraph of notes.", { fallbackTitle: "Lecture.pdf" });
  assert.equal(untitled.title, "Lecture.pdf");
  assert.match(untitled.content, /Just a paragraph/);
});

test("quiz questions keep topic and fill explanation from whys", () => {
  const questions = cleanQuestions({
    questions: [{
      q: "What is osmosis?",
      topic: "Cell transport",
      choices: ["A", "B", "C", "D"],
      answer: 1,
      whys: ["diffusion of solute", "water across a membrane", "active pump", "endocytosis"]
    }]
  }, 10);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].topic, "Cell transport");
  assert.equal(questions[0].explanation, "water across a membrane");
  assert.equal(questions[0].whys[1], "water across a membrane");
});

test("brace-aware salvage recovers complete objects from truncated JSON", () => {
  const truncated = '{"cards":[{"front":"A","back":"1"},{"front":"B","back":"2"}';
  const salvagedCards = salvageJsonObjects(truncated);
  assert.equal(salvagedCards.length, 2);
  assert.deepEqual(parseStudyJson(truncated).value.cards, [
    { front: "A", back: "1" },
    { front: "B", back: "2" }
  ]);

  const truncatedQuiz = '{"title":"Quiz","questions":[{"q":"Q1","choices":["a","b","c","d"],"answer":0},{"q":"Q2","choices":["a","b","c","d"],"answer":1}';
  assert.equal(parseStudyJson(truncatedQuiz).value.questions.length, 2);
  const shortQuiz = '{"questions":[{"type":"short","q":"Define osmosis","modelAnswer":"Water crossing a membrane"},';
  assert.equal(cleanQuestions(parseStudyJson(shortQuiz).value, 5)[0].type, "short");

  const withNoise = 'intro {"cards":[{"front":"A {nested}","back":"1"}]} trailing {';
  const objects = salvageJsonObjects(withNoise);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].cards[0].front, "A {nested}");

  const parsed = parseStudyJson('prefix {"questions":[{"q":"Q","choices":["a","b","c","d"],"answer":0,"explanation":"e"}]}');
  assert.equal(parsed.partial, true);
  assert.equal(parsed.value.questions.length, 1);
});

test("finish_reason length is treated as partial for structured parse", () => {
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  assert.match(generate, /finishReason === "length"/);
  assert.match(generate, /partial: accumulated\.finishReason === "length"/);
  assert.match(generate, /maxTokens: detailed \? 16000 : 4000/);
});

test("selective vision picks tiny/figure pages and respects cache + cap", () => {
  const pages = [];
  const chunks = [];
  for (let i = 1; i <= 30; i += 1) {
    pages.push({
      page_number: i,
      image_key: `page-${i}.jpg`,
      text: i === 2 ? "cached vision text" : "",
      metadata: i === 3 ? { figure_count: 2 } : {}
    });
    chunks.push({
      text: i === 1 ? "Plenty of digital text on this normal page that should not need vision." : "",
      metadata: { page: i }
    });
  }
  const selected = selectVisionCandidates({ kind: "pdf", chunks, pages, max: 24 });
  assert.equal(selected.truncated, true);
  assert.ok(selected.skipped > 0);
  assert.ok(selected.candidates.some((row) => row.pageNumber === 2 && row.cachedText));
  assert.ok(selected.candidates.some((row) => row.pageNumber === 3));
  assert.equal(selected.candidates.some((row) => row.pageNumber === 1), false);

  const digital = collectDigitalPageText(chunks);
  const merged = mergePageTexts({
    digitalByPage: digital,
    visionByPage: new Map([[2, "cached vision text"], [3, "chart of growth"]])
  });
  assert.match(merged, /Plenty of digital text/);
  assert.match(merged, /cached vision text/);
  assert.match(merged, /chart of growth/);
});

test("durable study jobs are gone from schema, worker, package, and compose", () => {
  const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8");
  const pkg = readFileSync(resolve(here, "../package.json"), "utf8");
  const compose = readFileSync(resolve(here, "../docker-compose.yml"), "utf8");
  const rest = readFileSync(resolve(here, "../server/db/rest/study.js"), "utf8");
  const generate = readFileSync(resolve(here, "../server/study/generate.js"), "utf8");
  const routes = readFileSync(resolve(here, "../server/routes/study.js"), "utf8");
  assert.doesNotMatch(schema, /study_generation_jobs/);
  assert.doesNotMatch(schema, /generation_job_id/);
  assert.doesNotMatch(schema, /klui_claim_study_generation_job/);
  assert.doesNotMatch(pkg, /study:worker/);
  assert.doesNotMatch(compose, /study-worker/);
  assert.doesNotMatch(rest, /study_generation_jobs|generation_job_id/);
  assert.doesNotMatch(generate, /generationJobId|persistSignal|beforePersist|publicStudyJob/);
  assert.doesNotMatch(routes, /\/generations|handleStudyCourseGenerations|createStudyGenerationJob/);
  assert.match(routes, /text\/event-stream|startSse/);
  assert.match(routes, /activeStudyGenerations/);
  assert.match(routes, /ponytail:.*multi-replica|ponytail:.*Durable\/DB lock/i);
});

test("Dojo mind maps do not consume the summary or detailed note slots", async () => {
  const { normalizeNoteMode, noteModesFromNotes, noteModeAllowed, noteBody } = await import("../server/study/generate.js");
  const note = { document_file_id: "doc-1", kind: "summary", content: "<!--klui:mindmap-->\n# Memory\n## Encoding\n- Attention" };
  const modes = noteModesFromNotes([note], "doc-1");
  assert.equal(normalizeNoteMode("Mindmap"), "mindmap");
  assert.deepEqual(modes, { summary: false, detailed: false, mindmap: true });
  assert.equal(noteModeAllowed(modes, "mindmap"), false);
  assert.equal(noteModeAllowed(modes, "summary"), true);
  assert.equal(noteBody(note), "# Memory\n## Encoding\n- Attention");
});

test("mind maps ask for source-grounded relationships instead of course logistics", async () => {
  const { MIND_MAP_SYSTEM_PROMPT } = await import("../server/study/generate.js");
  assert.match(MIND_MAP_SYSTEM_PROMPT, /concept → relationship → concept or outcome/);
  assert.match(MIND_MAP_SYSTEM_PROMPT, /connection between two branches/);
  assert.match(MIND_MAP_SYSTEM_PROMPT, /Omit course logistics/);
  assert.match(MIND_MAP_SYSTEM_PROMPT, /Never invent details/);
});

test("mind maps render branches, sub-branches, and nested ideas vertically", async () => {
  const { renderMindMap } = await import("../public/js/mindMap.js");
  const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const html = renderMindMap("Course", "# Course\n## Syntax\n### Grammar\n- BNF\n  - Rules <tokens>\n## Semantics\n- Meaning", escape);
  assert.match(html, /<summary>Syntax<\/summary>.*<summary>Grammar<\/summary>.*BNF.*Rules &lt;tokens>/s);
  assert.match(html, /<summary>Semantics<\/summary>.*Meaning/s);
  assert.equal((html.match(/class="dojo-map-branches"/g) || []).length, 5);
});

test("Dojo preserves mixed questions and bounds generation preferences", async () => {
  const { studyGenerationGuidance, clampQuizCount } = await import("../server/study/generate.js");
  const questions = cleanQuestions({ questions: [
    { type: "short", q: "Explain encoding.", modelAnswer: "Converting input into a memory representation." },
    { q: "Which helps recall?", choices: ["Spacing", "Cramming", "Guessing", "Skipping"], answer: 0 },
    { type: "short", q: "Invalid without an answer" }
  ] }, 5);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].type, "short");
  assert.equal(questions[0].choices[questions[0].answer], "Converting input into a memory representation.");
  assert.equal(questions[1].choices.length, 4);
  assert.equal(clampQuizCount(5), 5);
  assert.equal(clampQuizCount(20), 20);
  assert.equal(clampQuizCount(999), 10);
  const guidance = studyGenerationGuidance({ difficulty: "hard", cardType: "cloze", focus: "x".repeat(2000), style: "exam" }, "flashcards");
  assert.match(guidance, /difficulty hard/);
  assert.match(guidance, /fill-in-the-blank cards only/);
  assert.match(guidance, /exam-style/);
  assert.ok(!guidance.includes("x".repeat(1001)));
  assert.match(studyGenerationGuidance({ difficulty: "anything" }), /difficulty medium/);
});

test("Studio card formats retain usable answers and reject malformed model output", async () => {
  const { cleanCards } = await import("../server/study/generate.js");
  const basic = { front: "What helps recall?", back: "Spaced practice" };
  assert.deepEqual(cleanCards({ cards: [basic] }, 50, "basic"), [basic]);
  const cloze = { front: "___ practice helps recall.", back: "Spaced" };
  assert.deepEqual(cleanCards({ cards: [basic, cloze] }, 50, "basic"), [basic]);
  assert.deepEqual(cleanCards({ cards: [basic, cloze] }, 50, "cloze"), [cloze]);
  const mcq = { ...basic, choices: ["Spacing", "Cramming", "Guessing", "Skipping"], answer: 0 };
  assert.deepEqual(cleanCards({ cards: [basic, mcq] }, 50, "basic"), [basic]);
  const cards = cleanCards({ cards: [mcq, { ...mcq, answer: 4 }, { ...mcq, choices: ["Same", "Same", "Same", "Same"] }] }, 50, "mcq");
  assert.equal(cards.length, 1);
  assert.match(cards[0].front, /A\. Spacing\nB\. Cramming\nC\. Guessing\nD\. Skipping/);
  assert.match(cards[0].back, /^A\. Spacing\n\nSpaced practice$/);
});

test("selected styles and test formats produce distinct generation instructions", async () => {
  const { studyGenerationGuidance, studyQuizSystemPrompt } = await import("../server/study/generate.js");
  assert.match(studyGenerationGuidance({ style: "concise" }, "flashcards"), /questions and explanations concise/);
  assert.match(studyGenerationGuidance({ style: "exam" }, "notes"), /exam-style, testable ideas/);
  assert.match(studyGenerationGuidance({ style: "conceptual" }, "mindmap"), /conceptual connections/);
  const short = studyQuizSystemPrompt(10, "short", { style: "exam" });
  assert.match(short, /Every question must be short answer/);
  assert.match(short, /exam-style application scenarios/);
  assert.doesNotMatch(short, /four distinct choices/);
  const mcq = studyQuizSystemPrompt(10, "mcq");
  assert.match(mcq, /Every question must be multiple choice/);
  assert.doesNotMatch(mcq, /modelAnswer/);
  const mixed = studyQuizSystemPrompt(10, "mixed");
  assert.match(mixed, /exactly 5 short-answer questions/);
  assert.match(mixed, /5 multiple-choice questions/);
});

test("Studio test formats filter incompatible questions and difficulty provides concrete guidance", async () => {
  const { studyGenerationGuidance } = await import("../server/study/generate.js");
  const short = { type: "short", q: "Define recall", modelAnswer: "Retrieving information from memory." };
  const mcq = { q: "Which helps recall?", choices: ["Spacing", "Cramming", "Guessing", "Skipping"], answer: 0 };
  const mixed = { questions: [short, mcq] };
  assert.equal(cleanQuestions(mixed, 5, "mixed").length, 2);
  assert.equal(cleanQuestions(mixed, 5, "short")[0].type, "short");
  assert.equal(cleanQuestions(mixed, 5, "short").length, 1);
  assert.equal(cleanQuestions(mixed, 5, "mcq")[0].type, undefined);
  assert.equal(cleanQuestions(mixed, 5, "mcq").length, 1);
  assert.throws(() => cleanQuestions({ questions: [short] }, 5, "mcq"));
  assert.match(studyGenerationGuidance({ difficulty: "easy" }), /direct recall/);
  assert.match(studyGenerationGuidance({ difficulty: "medium" }), /apply concepts/);
  assert.match(studyGenerationGuidance({ difficulty: "hard" }), /multi-step reasoning/);
});
