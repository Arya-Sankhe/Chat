import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  cleanQuestions,
  loadMaterialText,
  parseMarkdownNote,
  parseStudyJson
} from "../server/study/generate.js";
import { salvageJsonObjects } from "../server/study/jsonSalvage.js";
import { selectVisionCandidates, mergePageTexts, collectDigitalPageText } from "../server/study/vision.js";

const here = dirname(fileURLToPath(import.meta.url));

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
