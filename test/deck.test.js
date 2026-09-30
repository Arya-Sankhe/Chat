import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "../worker/node_modules/jszip/lib/index.js";
import { fitText, parseRuns, wrapLines } from "../worker/deck/measure.js";
import { deckFromMarkdown, prepareDeck, renderDeck } from "../worker/deck/render.js";
import { alignDeck, normalizeDeck } from "../worker/deck/spec.js";
import { THEME_NAMES, chooseTheme } from "../worker/deck/themes.js";
import { buildDeckWriterUser, deckLooksUsable, parseDeckJson, writeDeck } from "../server/documents/deckWriter.js";
import { applyDeckOperations, deckForEditor, editDeck } from "../server/documents/deckEditor.js";
import { DocumentService } from "../server/documents/index.js";

const EVERY_TYPE = {
  title: "Q3 Fleet Review",
  footer: "Q3 review",
  source: "Fleet ledger",
  slides: [
    { type: "cover", title: "Q3 fleet review and **Q4 plan**", subtitle: "Volume beat target; cost missed.", kpis: [{ value: "326", unit: "×10k", label: "Orders" }, { value: "31", unit: "min", label: "Avg time" }] },
    { type: "agenda", title: "Agenda", items: [{ title: "Results" }, { title: "Causes" }, { title: "Plan" }] },
    { type: "section", section: "Results", title: "Results" },
    { type: "summary", section: "Results", title: "Volume on target, **efficiency diverged**", findings: [{ title: "Volume met", body: "3.26m vs 3.10m" }, { title: "Time missed", body: "31 vs 28 min" }, { title: "Cost missed", body: "RMB 5.1 vs 4.6" }], kpis: [{ value: "105.2", unit: "%", label: "Volume attainment" }], takeaway: "Only volume beat plan." },
    { type: "chart", section: "Results", title: "Volume rose nine months", chart: { type: "column", categories: ["Jan", "Feb", "Mar"], series: [{ name: "Orders", values: [41, 48, 55] }], highlight: 2 }, insights: [{ title: "Launch", body: "Tongzhou opened in June." }] },
    { type: "chart", title: "Cost bridge", chart: { type: "waterfall", points: [{ label: "Budget", value: 4.6, total: true }, { label: "Labor", value: 0.2 }, { label: "Actual", value: 4.8, total: true }] } },
    { type: "chart", title: "Mix and trend", chart: { type: "donut", points: [{ label: "A", value: 60 }, { label: "B", value: 40 }] }, charts: [{ type: "line", categories: ["Q1", "Q2"], series: [{ name: "Share", values: [29, 44] }], unit: "%" }] },
    { type: "chart", title: "Ranked and mixed", chart: { type: "hbar", points: [{ label: "East", value: 65 }, { label: "West", value: 34 }] }, charts: [{ type: "stacked100", points: [{ label: "Seed", value: 18 }, { label: "A", value: 26 }] }] },
    { type: "chart", title: "Progress and scatter", chart: { type: "progress", points: [{ label: "Dispatch", value: 78, status: "On track" }] }, charts: [{ type: "scatter", points: [{ label: "A", x: 18, y: 3.15 }, { label: "B", x: 15, y: 3.32 }] }] },
    { type: "table", title: "Scorecard", table: { columns: ["Metric", "Target", "Actual", "Status"], rows: [["Orders", "310", "326", "Met"], ["Time", "28", "31", "Missed"]], status_column: 3 } },
    { type: "kpis", title: "Four signals", kpis: [{ value: "84", unit: "%", label: "Compliance", delta: "+18 pts", status: "met" }, { value: "247", label: "Species" }, { value: "68", unit: "%", label: "Breeding" }] },
    { type: "comparison", title: "Three cities", columns: [{ title: "Linwan", points: ["Avg. time: 27 min", "Cost: RMB 4.5"] }, { title: "Tongzhou", highlight: true, points: ["Avg. time: 36 min", "Diagnosis: 140 km unmapped raises time and complaints"] }] },
    { type: "timeline", title: "Q4 roadmap", items: [{ date: "Oct", title: "Fix" }, { date: "Nov", title: "Expand", highlight: true }, { date: "Dec", title: "Sprint" }] },
    { type: "process", title: "Three steps", steps: [{ title: "Identify" }, { title: "Restore" }, { title: "Validate" }] },
    { type: "cards", title: "Four stressors", cards: [{ title: "Shoreline", body: "37% hard." }, { title: "Water", body: "34% below target." }, { title: "Species", metric: { value: "42", unit: "%" } }] },
    { type: "statement", statement: "The issue is **connectivity**, not area.", attribution: "Baseline study" },
    { type: "bignumber", title: "Repeat participation rose to 44%", value: "44", unit: "%", label: "Repeat participation", compare: { value: "8,740", label: "Visits" } },
    { type: "matrix", title: "Impact vs cost", x_axis: { label: "Cost" }, y_axis: { label: "Impact" }, quadrants: [{ title: "Quick wins", items: ["W04"] }, { title: "Bets" }, { title: "Maintain" }, { title: "Drop" }], highlight: 0 },
    { type: "decision", title: "Two approvals", items: [{ title: "Approve budget", owner: "Finance", due: "Oct 15", status: "For vote" }], rail: { title: "Cost of delay", items: [{ title: "18k orders/day" }] } },
    { type: "bullets", title: "Notes", points: [{ body: "One" }, { body: "Two" }, { body: "Three" }] }
  ]
};

async function slidesOf(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
  const texts = [];
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    texts.push([...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((match) => match[1]).join(" "));
  }
  return { zip, texts, charts: Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)) };
}

test("deck renderer draws every slide type in every theme without failures", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "klui-deck-"));
  for (const theme of THEME_NAMES) {
    const file = path.join(tmp, `${theme}.pptx`);
    const { warnings, deck } = await renderDeck({ ...EVERY_TYPE, theme }, file);
    assert.equal(deck.theme, theme);
    assert.deepEqual(warnings.filter((warning) => /failed/.test(warning)), [], `${theme}: ${warnings.join("; ")}`);
    const { texts, charts } = await slidesOf(file);
    assert.equal(texts.length, EVERY_TYPE.slides.length, theme);
    // Native, editable charts for the data chart types; text stays real text.
    assert.ok(charts.length >= 3, `${theme} should embed native charts`);
    assert.match(texts[0], /Q4 plan/i);
    assert.match(texts[3], /Volume on target/);
    assert.match(texts[3], /03 \/ 20|04 \/ 20/);
  }
});

test("deck spec normalisation clamps, repairs and never leaves empty slides", () => {
  const deck = normalizeDeck({
    theme: "nonsense",
    title: "Photosynthesis lecture",
    slides: [
      { type: "summary", title: "Light reactions make ATP", findings: [] , points: ["Chlorophyll absorbs red and blue light"] },
      { type: "chart", title: "No data", chart: { type: "column", categories: [], series: [] } },
      { type: "mystery", title: "Calvin cycle", points: [{ title: "Fixes CO2", body: "RuBisCO adds CO2 to RuBP." }] },
      { type: "cards", title: "", cards: [] }
    ]
  });
  assert.equal(deck.slides[0].type, "cover");
  assert.equal(deck.theme, "academy");
  const types = deck.slides.map((slide) => slide.type);
  assert.deepEqual(types, ["cover", "bullets", "bullets"]);
  assert.match(deck.slides[1].points[0].body, /Chlorophyll/);
  assert.equal(deck.slides[2].points[0].title, "Fixes CO2");
});

test("text fitting shrinks before clipping and keeps emphasis markers balanced", () => {
  const style = { face: "Arial", max: 24, min: 12, lineHeight: 1.1 };
  const loose = fitText("Short title", { ...style, w: 6, h: 1 });
  assert.equal(loose.size, 24);
  assert.equal(loose.fits, true);
  const long = "A very long action title that states the insight with **a decisive number** and keeps going ".repeat(3);
  const shrunk = fitText(long, { ...style, w: 6, h: 1.2, maxLines: 3 });
  assert.ok(shrunk.size < 24);
  const clipped = fitText(long.repeat(4), { ...style, w: 3, h: 0.5 });
  assert.equal(clipped.fits, false);
  assert.match(clipped.text, /…$/);
  assert.equal((clipped.text.match(/\*\*/g) || []).length % 2, 0);
  assert.deepEqual(parseRuns("a **b** c").map((run) => run.em), [false, true, false]);
  assert.ok(wrapLines("word ".repeat(40), 2, { face: "Calibri", size: 12 }).length > 3);
});

test("theme chooser routes topics to the matching design", () => {
  assert.equal(chooseTheme("Lecture 3: cell respiration for first-year students"), "academy");
  assert.equal(chooseTheme("Q3 AI platform product review"), "midnight");
  assert.equal(chooseTheme("Due diligence memo for the acquisition"), "ledger");
  assert.equal(chooseTheme("Spring festival marketing campaign"), "atelier");
  assert.equal(chooseTheme("Carbon reduction and ESG roadmap"), "verdant");
  assert.equal(chooseTheme("Quarterly sales pipeline"), "boardroom");
});

test("markdown content without a deck spec still becomes a designed deck", () => {
  const deck = prepareDeck(deckFromMarkdown({
    title: "Roadmap",
    content: "# Roadmap\n## Why now\n- Churn: rose to 8% in Q2\n- Onboarding takes 9 days\n## Plan\n| Step | Owner | Date |\n| --- | --- | --- |\n| Beta | Ops | Oct |\n| Launch | PM | Dec |"
  }));
  assert.deepEqual(deck.slides.map((slide) => slide.type), ["cover", "bullets", "table"]);
  assert.equal(deck.slides[1].points[0].title, "Churn");
  assert.equal(deck.slides[2].table.rows.length, 2);
});

test("deck writer JSON parsing salvages complete slides from truncated output", () => {
  const full = parseDeckJson("```json\n{\"theme\":\"ledger\",\"title\":\"T\",\"slides\":[{\"type\":\"cover\",\"title\":\"T\"}]}\n```");
  assert.equal(full.theme, "ledger");
  const truncated = parseDeckJson('{"theme":"midnight","title":"Fleet \\"Q3\\"","slides":[{"type":"cover","title":"A"},{"type":"summary","title":"B","findings":[{"title":"x"}]},{"type":"chart","title":"C","chart":{"type":"col');
  assert.equal(truncated.theme, "midnight");
  assert.equal(truncated.title, 'Fleet "Q3"');
  assert.deepEqual(truncated.slides.map((slide) => slide.type), ["cover", "summary"]);
  assert.equal(parseDeckJson("not json"), null);
});

test("deck writer brief carries the request, material and tables", () => {
  const user = buildDeckWriterUser({
    userRequest: "make a 6 slide deck for my team",
    title: "Churn",
    instructions: "Audience: execs",
    content: "Churn rose to 8%.",
    tables: [{ title: "By month", headers: ["Month", "Churn"], rows: [["Jan", "6%"]] }]
  });
  assert.match(user, /6 slide deck/);
  assert.match(user, /<material>\nChurn rose to 8%\./);
  assert.match(user, /Month \| Churn\nJan \| 6%/);
});

function sseResponse(text) {
  const chunks = [JSON.stringify({ choices: [{ delta: { content: text } }] }), JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })];
  const body = chunks.map((chunk) => `data: ${chunk}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  }), { headers: { "content-type": "text/event-stream" } });
}

const DECK_JSON = JSON.stringify({
  theme: "boardroom",
  title: "Churn review",
  slides: [
    { type: "cover", title: "Churn review" },
    { type: "summary", title: "Churn rose to **8%**", findings: [{ title: "Onboarding", body: "9 days" }] },
    { type: "bullets", title: "Next steps", points: [{ body: "Shorten onboarding" }] }
  ]
});

test("deck writer falls back to the next model when the first returns junk", async () => {
  const models = [];
  const modelClient = {
    async streamChatCompletion({ body }) {
      models.push(body.model);
      return sseResponse(models.length === 1 ? "Sorry, I cannot." : DECK_JSON);
    }
  };
  const config = { providers: { openrouter: { apiKey: "test" } }, documents: { deckModel: "first/model" } };
  const result = await writeDeck({ config, modelClient, signal: new AbortController().signal, brief: { title: "Churn" } });
  assert.equal(models.length, 2);
  assert.equal(models[0], "first/model");
  assert.equal(result.deck.slides.length, 3);
  assert.equal(await writeDeck({ config: {}, modelClient, brief: {} }), null);
});

test("DocumentService writes a deck spec before queuing a PPTX job", async () => {
  let job;
  const service = new DocumentService({
    config: { documents: { enabled: true, jobWaitMs: 10 }, providers: { openrouter: { apiKey: "test" } } },
    db: {
      async createDocumentJob(input) {
        job = input;
        return { id: "job_deck", status: "queued", job_type: input.job_type };
      },
      async getDocumentJob() {
        return { id: "job_deck", status: "succeeded", output: { ok: true } };
      }
    },
    r2: {},
    userId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    plan: { id: "pro" },
    signal: new AbortController().signal,
    modelClient: { async streamChatCompletion() { return sseResponse(DECK_JSON); } },
    userRequest: "make me a churn deck"
  });
  const result = await service.createDocument({ format: "pptx", title: "Churn review", content: "Churn rose to 8%.", theme: "midnight" });
  assert.equal(job.job_type, "document.create.pptx");
  assert.equal(job.input.data.deck.title, "Churn review");
  assert.equal(job.input.theme, "midnight");
  // The theme the caller named wins over the one the writer picked.
  assert.equal(job.input.data.deck.theme, "midnight");
  assert.deepEqual(result.output.deck_outline, ["1. Churn review", "2. Churn rose to 8%", "3. Next steps"]);
});

test("deck writer rejects a response whose slides would all be dropped as empty", () => {
  const titlesOnly = { slides: [{ type: "cover", title: "Deck" }, { type: "chart", title: "A" }, { type: "kpis", title: "B" }, { type: "table", title: "C" }] };
  assert.equal(deckLooksUsable(titlesOnly), false);
  assert.equal(deckLooksUsable({ slides: [{ type: "cover", title: "Deck" }, { type: "bullets", title: "Only", points: ["One"] }] }), false, "one content slide is not a deck");
  assert.equal(deckLooksUsable({ slides: [...JSON.parse(DECK_JSON).slides, { type: "kpis", title: "Two signals", kpis: [{ value: "8", unit: "%", label: "Churn" }] }] }), true);
});

test("text fitting reports a box too short for even one line", () => {
  assert.equal(fitText("A", { w: 2, h: 0.02, face: "Arial", max: 10, min: 10 }).fits, false);
  assert.equal(fitText("A", { w: 2, h: 1, face: "Arial", max: 10, min: 10 }).fits, true);
});

test("aligned deck specs number slides exactly like the rendered pages", () => {
  const aligned = alignDeck({ title: "Deck", slides: [{ type: "chart", title: "Empty" }, { type: "bullets", title: "Real", points: ["One"] }, { type: "kpis", title: "Rescued", findings: ["Kept as text"] }] });
  assert.deepEqual(aligned.slides.map((slide) => slide.type), ["cover", "bullets", "bullets"]);
  assert.equal(aligned.slides[2].points[0].body, "Kept as text");
  assert.equal(normalizeDeck(aligned).slides.length, aligned.slides.length);
});

test("style overrides hide furniture, recolour elements and name shapes for editing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "klui-style-"));
  const file = path.join(tmp, "styled.pptx");
  const spec = {
    ...EVERY_TYPE,
    theme: "boardroom",
    style: { hide: ["page_number"], title_color: "#1b5e20", chart_colors: ["C62828"] },
    slides: [
      EVERY_TYPE.slides[0],
      { ...EVERY_TYPE.slides[3], style: { hide: ["footer"] } },
      { ...EVERY_TYPE.slides[4], style: { show: ["page_number"] } }
    ]
  };
  const { warnings } = await renderDeck(spec, file);
  assert.deepEqual(warnings.filter((warning) => /failed/.test(warning)), []);
  const { zip, texts, charts } = await slidesOf(file);
  assert.doesNotMatch(texts[1], /\d\d \/ \d\d/, "page numbers hidden deck-wide");
  assert.doesNotMatch(texts[1], /Fleet ledger/, "footer hidden on this slide");
  assert.match(texts[2], /03 \/ 03/, "slide style re-enables page numbers");
  const summary = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(summary, /name="Title"/);
  assert.match(summary, /name="Takeaway"/);
  assert.match(summary, /1B5E20/, "title colour override");
  const chart = await zip.file(charts[0]).async("string");
  assert.match(chart, /C62828/, "chart colour override");
});

test("deck operations address pages and list items 1-based and change nothing else", () => {
  const deck = alignDeck(JSON.parse(DECK_JSON));
  const { deck: next, applied, errors } = applyDeckOperations(deck, [
    { op: "set", path: "slides.2.title", value: "Churn rose to **9%**" },
    { op: "set", path: "slides.3.points.1.body", value: "Cut onboarding to 5 days" },
    { op: "set", path: "style.hide", value: ["footer"] },
    { op: "insert", path: "slides.3", value: { type: "statement", statement: "Onboarding is the lever." } },
    { op: "move", from: "slides.4", to: "slides.2" },
    { op: "remove", path: "slides.9" },
    { op: "set", path: "slides.2.__proto__.x", value: 1 }
  ]);
  assert.equal(applied, 5);
  assert.equal(errors.length, 2);
  assert.deepEqual(next.slides.map((slide) => slide.type), ["cover", "bullets", "summary", "statement"]);
  assert.equal(next.slides[1].points[0].body, "Cut onboarding to 5 days");
  assert.equal(next.slides[2].title, "Churn rose to **9%**");
  assert.deepEqual(next.slides[2].findings, deck.slides[1].findings, "untouched fields are identical");
  assert.deepEqual(next.style, { hide: ["footer"] });
  assert.equal(deck.slides[1].title, "Churn rose to **8%**", "the stored deck is not mutated");
  assert.equal(deckForEditor(deck).slides[1].page, 2);
});

test("deck editor plans operations with the model and applies them", async () => {
  let prompt = "";
  const modelClient = {
    async streamChatCompletion({ body }) {
      prompt = body.messages[1].content;
      return sseResponse(JSON.stringify({ summary: "Retitled page 2 and removed the footer.", operations: [
        { op: "set", path: "slides.2.title", value: "Churn hit **8.4%**" },
        { op: "set", path: "style.hide", value: ["footer"] }
      ] }));
    }
  };
  const config = { providers: { openrouter: { apiKey: "test" } }, documents: {} };
  const result = await editDeck({ config, modelClient, deck: JSON.parse(DECK_JSON), instructions: "Page 2 title should say 8.4%; remove the footer." });
  assert.match(prompt, /"page":2/);
  assert.equal(result.deck.slides[1].title, "Churn hit **8.4%**");
  assert.deepEqual(result.deck.style.hide, ["footer"]);
  assert.equal(result.summary, "Retitled page 2 and removed the footer.");

  const refusing = { async streamChatCompletion() { return sseResponse(JSON.stringify({ summary: "Which chart do you mean?", operations: [] })); } };
  await assert.rejects(editDeck({ config, modelClient: refusing, deck: JSON.parse(DECK_JSON), instructions: "fix the chart" }), /Which chart/);
});

test("deck edits are all-or-nothing and never silently drop a slide", async () => {
  const config = { providers: { openrouter: { apiKey: "test" } }, documents: {} };
  const deck = JSON.parse(DECK_JSON);
  // Removing the only points leaves page 3 with nothing to draw: reject instead of deleting the slide.
  await assert.rejects(
    editDeck({ config, deck, operations: [{ op: "remove", path: "slides.3.points" }] }),
    (error) => error.status === 422 && /page 3 would be left without any content/.test(error.message)
  );
  // One valid and one failing change: nothing is applied.
  await assert.rejects(
    editDeck({ config, deck, operations: [
      { op: "set", path: "slides.2.title", value: "Churn hit **9%**" },
      { op: "set", path: "slides.7.title", value: "Missing page" }
    ] }),
    (error) => error.status === 422 && /nothing changed/.test(error.message) && /operation 2/.test(error.message)
  );
  assert.equal(deck.slides[1].title, "Churn rose to **8%**");
  // Over the operation limit: rejected whole, not truncated to the first 80.
  const many = Array.from({ length: 81 }, () => ({ op: "set", path: "slides.2.title", value: "Churn hit **9%**" }));
  await assert.rejects(editDeck({ config, deck, operations: many }), (error) => error.status === 422 && /81 operations/.test(error.message));
  // A valid deck operation next to an unsupported one: rejected whole.
  await assert.rejects(
    editDeck({ config, deck, operations: [
      { op: "set", path: "slides.2.title", value: "Churn hit **9%**" },
      { type: "replace_text", find: "8%", replace: "9%" }
    ] }),
    (error) => error.status === 422 && /not deck operations/.test(error.message)
  );
  assert.equal(deck.slides[1].title, "Churn rose to **8%**");

  // A planned edit gets one corrected attempt with the problems fed back.
  const prompts = [];
  const replies = [
    { summary: "Two changes.", operations: [
      { op: "set", path: "slides.2.title", value: "Churn hit **9%**" },
      { op: "remove", path: "slides.3.points" }
    ] },
    { summary: "Two changes.", operations: [
      { op: "set", path: "slides.2.title", value: "Churn hit **9%**" },
      { op: "set", path: "slides.3.points.1.body", value: "Cut onboarding to 5 days" }
    ] }
  ];
  const modelClient = {
    async streamChatCompletion({ body }) {
      prompts.push(body.messages[1].content);
      return sseResponse(JSON.stringify(replies[prompts.length - 1]));
    }
  };
  const result = await editDeck({ config, modelClient, deck, instructions: "Page 2 says 9%; page 3 point says 5 days." });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /REJECTED AND NOTHING WAS CHANGED/);
  assert.match(prompts[1], /page 3 would be left without any content/);
  assert.equal(result.deck.slides.length, 3);
  assert.equal(result.deck.slides[1].title, "Churn hit **9%**");
  assert.equal(result.deck.slides[2].points[0].body, "Cut onboarding to 5 days");
});

test("DocumentService edits a generated deck through its spec and re-renders it", async () => {
  let job;
  const service = new DocumentService({
    config: { documents: { enabled: true, jobWaitMs: 10 }, providers: { openrouter: { apiKey: "test" } } },
    db: {
      async getDocumentFileByAttachment() {
        return { id: "doc_1", attachment_id: "00000000-0000-4000-8000-0000000000a1", kind: "pptx", text_ready_at: "2026-09-28T00:00:00Z", conversation_id: "00000000-0000-4000-8000-000000000002", version_no: 1, file_name: "Churn.pptx" };
      },
      async getDeckSpecForDocument(userId, documentFileId) {
        assert.equal(documentFileId, "doc_1");
        return JSON.parse(DECK_JSON);
      },
      async createDocumentJob(input) {
        job = input;
        return { id: "job_edit", status: "queued" };
      },
      async getDocumentJob() {
        return { id: "job_edit", status: "succeeded", output: { attachment_id: "att_2", quality_warnings: ["slide 2: chart layout failed (bad series); shown as bullets"] } };
      }
    },
    r2: {},
    userId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    plan: { id: "pro" },
    signal: new AbortController().signal,
    modelClient: null
  });
  const result = await service.editDocument({ attachmentId: "00000000-0000-4000-8000-0000000000a1", instructions: "footer", operations: [{ op: "set", path: "footer", value: "Acme Confidential" }] });
  assert.equal(job.job_type, "document.edit.pptx");
  assert.equal(job.input.data.deck.footer, "Acme Confidential");
  assert.equal(job.input.data.deck.slides.length, 3);
  assert.equal(result.output.deck_operations_applied, 1);
  // Render warnings from the edit reach the reply just as they do on creation.
  assert.match(result.output.deck_quality_warnings[0], /slide 2: chart layout failed/);
  assert.match(result.output.deck_quality_note, /which pages were simplified/);
});

test("every catalog theme renders the sample decks without warnings and is described", async () => {
  const { THEMES, THEME_GROUPS } = await import("../worker/deck/themes.js");
  const { SAMPLES, SAMPLE_FOR_CATEGORY } = await import("../scripts/deck-presets/samples.mjs");
  const categories = new Set(THEME_GROUPS.flatMap((group) => group.categories.map((category) => category.id)));
  assert.ok(THEME_NAMES.length >= 30);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-themes-"));
  try {
    for (const name of THEME_NAMES) {
      const theme = THEMES[name];
      assert.ok(categories.has(theme.meta?.category), `${name} has a gallery category`);
      assert.ok(theme.meta.description && theme.meta.use, `${name} is described`);
      const sample = SAMPLES[SAMPLE_FOR_CATEGORY[theme.meta.category]];
      const { deck, warnings } = await renderDeck({ ...structuredClone(sample), theme: name }, path.join(dir, `${name}.pptx`));
      assert.equal(deck.theme, name);
      assert.deepEqual(warnings, [], `${name} renders cleanly`);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a preset picked in the Slides gallery overrides the theme the model names", async () => {
  const { normalizeDeckTheme } = await import("../server/documents/index.js");
  assert.equal(normalizeDeckTheme(" Atlas "), "atlas");
  assert.equal(normalizeDeckTheme("not-a-theme"), "");
  assert.equal(normalizeDeckTheme(42), "");
  let job;
  const service = new DocumentService({
    config: { documents: { enabled: true, jobWaitMs: 10 }, providers: { openrouter: { apiKey: "test" } } },
    db: {
      async createDocumentJob(input) {
        job = input;
        return { id: "job_create", status: "queued" };
      },
      async getDocumentJob() {
        return { id: "job_create", status: "succeeded", output: { attachment_id: "att_3" } };
      }
    },
    r2: {},
    userId: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    plan: { id: "pro" },
    signal: new AbortController().signal,
    modelClient: null,
    deckTheme: "chalk"
  });
  const deck = JSON.parse(DECK_JSON);
  await service.createDocument({ format: "pptx", title: "Churn", theme: "midnight", data: { deck } });
  assert.equal(job.input.theme, "chalk");
  assert.equal(job.input.data.deck.theme, "chalk");
});

test("Slides and Docs modes offer the create tool for a bare topic", async () => {
  const { selectDocumentSkills } = await import("../server/documents/skills.js");
  const topic = { text: "photosynthesis for grade 10" };
  assert.ok(!selectDocumentSkills(topic).toolNames.includes("create_document"));
  const slides = selectDocumentSkills({ ...topic, createFormat: "pptx" });
  assert.ok(slides.toolNames.includes("create_document"));
  assert.ok(slides.skills.includes("presentation-create"));
  assert.ok(selectDocumentSkills({ ...topic, createFormat: "docx" }).skills.includes("word-create"));
});

test("deck render warnings are reported to the user, layout failures first", async () => {
  const { deckQualityOutput } = await import("../server/documents/index.js");
  assert.deepEqual(deckQualityOutput([]), {});
  const minor = deckQualityOutput(["slide 3: title shortened to fit"]);
  assert.match(minor.deck_quality_note, /shortened to fit/);
  const major = deckQualityOutput(["slide 2: body shortened", "slide 5: chart layout failed (boom); shown as bullets"]);
  assert.equal(major.deck_quality_warnings[0], "slide 5: chart layout failed (boom); shown as bullets");
  assert.match(major.deck_quality_note, /which pages were simplified/);
});

test("line chart axes stay outside the data with the minimum below the maximum", async () => {
  const { lineAxisBounds } = await import("../worker/deck/charts.js");
  for (const values of [[999, 1000], [999, 999.1], [0.5, 0.52], [-5, -3], [10, 40, 25], [0, 0], [5, 5], [-2, 3], [1_200_000, 1_350_000]]) {
    const { min, max } = lineAxisBounds(values);
    assert.ok(min < max, `${values}: ${min} < ${max}`);
    assert.ok(min <= Math.min(...values) && max > Math.max(...values), `${values}: ${min}-${max}`);
  }
  // Values at the float limits still give finite axes around the data.
  for (const values of [[1e-100, 2e-100], [-1e308, 1e308], [5e-324], [Number.MAX_VALUE], [-Number.MAX_VALUE]]) {
    const { min, max } = lineAxisBounds(values);
    assert.ok(Number.isFinite(min) && Number.isFinite(max) && min < max, `${values}: ${min}-${max}`);
    assert.ok(min <= Math.min(...values) && max >= Math.max(...values), `${values}: ${min}-${max}`);
  }
});

test("deck edits cannot remove or move the cover", async () => {
  const config = { providers: { openrouter: { apiKey: "test" } }, documents: {} };
  const deck = JSON.parse(DECK_JSON);
  for (const operations of [
    [{ op: "remove", path: "slides.1" }],
    [{ op: "move", from: "slides.1", to: "slides.3" }],
    [{ op: "move", from: "slides.3", to: "slides.1" }]
  ]) {
    await assert.rejects(editDeck({ config, deck, operations }), (error) => error.status === 422 && /cover must stay on page 1/.test(error.message));
  }
});

test("an already-cancelled turn never starts a deck writer or editor request", async () => {
  let calls = 0;
  const modelClient = { async streamChatCompletion() { calls += 1; return sseResponse(DECK_JSON); } };
  const config = { providers: { openrouter: { apiKey: "test" } }, documents: {} };
  const controller = new AbortController();
  controller.abort(new Error("turn cancelled"));
  await assert.rejects(writeDeck({ config, modelClient, signal: controller.signal, brief: { title: "Churn" } }), /turn cancelled/);
  await assert.rejects(editDeck({ config, modelClient, signal: controller.signal, deck: JSON.parse(DECK_JSON), instructions: "retitle page 2" }), /turn cancelled/);
  assert.equal(calls, 0);
});

test("a deck is edited from the spec the worker rendered, not only the one it was sent", async () => {
  const { getDeckSpecForDocument } = await import("../server/db/rest/documents.js");
  let query;
  const rendered = { theme: "midnight", slides: [{ type: "cover", title: "A" }] };
  const client = { async request(_table, options) { query = options.query; return [{ id: "job", rendered, sent: { theme: "boardroom", slides: [] } }]; } };
  assert.deepEqual(await getDeckSpecForDocument(client, "user", "doc"), rendered);
  assert.match(query.select, /output->deck/);
  const legacy = { async request() { return [{ id: "job", rendered: null, sent: { theme: "boardroom", slides: [{ type: "cover" }] } }]; } };
  assert.equal((await getDeckSpecForDocument(legacy, "user", "doc")).theme, "boardroom");
});
