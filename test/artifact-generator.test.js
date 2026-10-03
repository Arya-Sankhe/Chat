import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import JSZip from "../worker/node_modules/jszip/lib/index.js";
import { editDeck } from "../server/documents/deckEditor.js";
import { prepareDeck } from "../worker/deck/render.js";

const execFileAsync = promisify(execFile);

function slideTexts(xml) {
  return [...String(xml || "").matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function docxTexts(xml) {
  return [...String(xml || "").matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)]
    .map((match) => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function runArtifact(input, tmpPrefix) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), tmpPrefix));
  const inputPath = path.join(tmp, "input.json");
  await fs.writeFile(inputPath, JSON.stringify(input));
  const { stdout } = await execFileAsync("node", ["worker/artifact_generator.mjs", inputPath, tmp], {
    cwd: path.resolve(".")
  });
  return { tmp, result: JSON.parse(stdout) };
}

test("DOCX generator promotes plain section labels into real document structure", async () => {
  const { result } = await runArtifact({
    format: "docx",
    preview_pdf: false,
    title: "Pricing Comparison",
    content: [
      "Executive Summary:",
      "MiMo is cheaper for the tested 60/40 token mix.",
      "",
      "Recommendation:",
      "Use MiMo for cost-sensitive workloads and reserve Qwen for quality-sensitive cases."
    ].join("\n")
  }, "klui-docx-quality-");
  const zip = await JSZip.loadAsync(await fs.readFile(result.path));
  const xml = await zip.file("word/document.xml").async("string");
  const text = docxTexts(xml);

  assert.match(xml, /Heading1/);
  assert.match(text, /Executive Summary/);
  assert.match(text, /Recommendation/);
  assert.match(text, /MiMo is cheaper/);
});

async function pptxSlides(file) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const entries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1] || 0) - Number(b.match(/slide(\d+)/)?.[1] || 0));
  const texts = await Promise.all(entries.map(async (entry) => slideTexts(await zip.file(entry).async("string"))));
  const charts = Object.keys(zip.files).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
  return { texts, charts };
}

test("PPTX generator renders a deck-writer spec with native charts", async () => {
  const { result } = await runArtifact({
    format: "pptx",
    title: "Model Price Comparison",
    data: {
      deck: {
        theme: "boardroom",
        title: "Model Price Comparison",
        slides: [
          { type: "cover", title: "MiMo costs **78% less** per blended token" },
          { type: "chart", title: "Output pricing drives the gap", chart: { type: "column", unit: "$ / 1M", categories: ["MiMo", "Qwen"], series: [{ name: "Blended", values: [0.196, 0.88] }], highlight: 0 }, takeaway: "Use MiMo when cost decides." },
          { type: "table", title: "Pricing inputs", table: { columns: ["Model", "Input $/1M", "Output $/1M"], rows: [["MiMo", "0.14", "0.28"], ["Qwen", "0.40", "1.60"]] } }
        ]
      }
    }
  }, "klui-pptx-deck-");
  const { texts, charts } = await pptxSlides(result.path);
  assert.equal(texts.length, 3);
  assert.equal(charts.length, 1);
  assert.match(texts[0], /78% less/);
  assert.match(texts[1], /Use MiMo when cost decides/);
  assert.match(texts[2], /Output \$\/1M/);
});

test("PPTX generator turns legacy slide plans and plain markdown into designed slides", async () => {
  const legacy = await runArtifact({
    format: "pptx",
    title: "Executive Review",
    theme: "academic",
    data: {
      slides: [
        { title: "Executive Review", subtitle: "Quarterly update" },
        { title: "The Question" },
        { title: "Recommendation", bullets: ["Focus on retention", "Reduce onboarding friction"] }
      ]
    }
  }, "klui-pptx-legacy-");
  const legacySlides = await pptxSlides(legacy.result.path);
  assert.equal(legacySlides.texts.length, 2, "title-only slides are dropped instead of rendered empty");
  assert.match(legacySlides.texts[1], /Reduce onboarding friction/);

  const markdown = await runArtifact({
    format: "pptx",
    title: "Roadmap",
    content: "# Roadmap\n## Why now\n- Churn: rose to 8% in Q2\n- Onboarding takes 9 days\n## Plan\n| Step | Owner |\n| --- | --- |\n| Beta | Ops |\n| Launch | PM |"
  }, "klui-pptx-markdown-");
  const markdownSlides = await pptxSlides(markdown.result.path);
  assert.equal(markdownSlides.texts.length, 3);
  assert.match(markdownSlides.texts[1], /rose to 8% in Q2/);
  assert.match(markdownSlides.texts[2], /Launch/);
});

test("PPTX generator reports the deck exactly as rendered so later edits keep its theme", async () => {
  // The caller's theme beats the stored spec's; the reported deck must say what was drawn.
  const { result: themed } = await runArtifact({
    format: "pptx",
    title: "Churn",
    theme: "midnight",
    data: { deck: { theme: "boardroom", slides: [{ type: "cover", title: "Churn" }, { type: "bullets", title: "Steps", points: [{ body: "Shorten onboarding" }] }] } }
  }, "klui-pptx-theme-");
  assert.equal(themed.deck.theme, "midnight");
  // Legacy aliases resolve to the real theme name.
  const { result: legacy } = await runArtifact({
    format: "pptx", title: "Churn", theme: "business",
    data: { deck: { theme: "midnight", slides: [{ type: "cover", title: "Churn" }] } }
  }, "klui-pptx-legacy-");
  assert.equal(legacy.deck.theme, "boardroom");
  // Without a written spec the markdown fallback still yields an editable deck.
  const { result: fallback } = await runArtifact({
    format: "pptx", title: "Churn review",
    content: "# Churn review\n\n## Causes\n- Onboarding takes 9 days\n- Pricing confusion\n\n## Plan\n- Shorten onboarding"
  }, "klui-pptx-fallback-");
  assert.ok(Array.isArray(fallback.deck.slides) && fallback.deck.slides.length >= 2);
  assert.equal(fallback.deck.slides[0].type, "cover");
});

test("a stored deck survives edit and re-render with everything else intact", async () => {
  const raw = {
    title: "Review", theme: "midnight",
    style: { title_color: "FF0000", body_font: "Georgia", chart_colors: ["123456"] },
    slides: [
      { type: "cover", title: "Review" },
      { type: "chart", title: "Revenue", chart: { type: "line", categories: ["Q1", "Q2"], series: [{ name: "Revenue", values: [999, 1000] }], x_label: "Quarter", target: 999.5, target_label: "Budget" } },
      { type: "matrix", title: "Priorities", x_axis: { label: "Cost" }, y_axis: { label: "Impact" }, quadrants: [{ title: "Quick wins" }, { title: "Bets" }, { title: "Maintain" }, { title: "Drop" }] },
      { type: "table", title: "Results", table: { columns: ["Team", "Outcome"], rows: [["A", "Met"], ["B", "Missed"]], highlight_row: 1, status_column: 1 } }
    ]
  };
  const { result: first } = await runArtifact({ format: "pptx", title: "Review", data: { deck: raw } }, "klui-pptx-roundtrip-");
  const edit = await editDeck({ deck: first.deck, operations: [{ op: "set", path: "slides.1.title", value: "Revised" }] });
  const { result: second } = await runArtifact({ format: "pptx", title: "Review", data: { deck: edit.deck } }, "klui-pptx-roundtrip-");

  // Only the cover title moved, in the stored spec and in what the renderer draws.
  const expected = structuredClone(first.deck);
  expected.slides[0].title = "Revised";
  assert.deepEqual(second.deck, expected);
  const drawn = prepareDeck(raw);
  drawn.slides[0].title = "Revised";
  assert.deepEqual(prepareDeck(second.deck), drawn);
  assert.equal(prepareDeck(second.deck).style.bodyFont, "Georgia");
  assert.equal(prepareDeck(second.deck).slides[2].xAxis.label, "Cost");
});

test("chart edits address the stored chart and no-op edits are rejected", async () => {
  const { result } = await runArtifact({
    format: "pptx", title: "Charts",
    data: { deck: { slides: [
      { type: "cover", title: "Charts" },
      { type: "chart", title: "Revenue", charts: [{ type: "line", categories: ["Q1", "Q2"], series: [{ name: "Revenue", values: [1, 2] }] }] },
      { type: "chart", title: "Mix", chart: { type: "column", categories: ["A"], series: [{ values: [1] }] }, charts: [{ type: "pie", points: [{ label: "A", value: 1 }] }] }
    ] } }
  }, "klui-pptx-charts-");
  // One chart is stored under "chart", two under "charts", whatever the writer used.
  assert.equal(result.deck.slides[1].chart.type, "line");
  assert.equal(result.deck.slides[1].charts, undefined);
  assert.deepEqual(result.deck.slides[2].charts.map((entry) => entry.type), ["column", "pie"]);
  assert.equal(result.deck.slides[2].chart, undefined);

  const edit = await editDeck({ deck: result.deck, operations: [{ op: "set", path: "slides.2.chart.type", value: "area" }] });
  assert.equal(prepareDeck(edit.deck).slides[1].charts[0].type, "area");
  const second = await editDeck({ deck: result.deck, operations: [{ op: "set", path: "slides.3.charts.2.type", value: "donut" }] });
  assert.equal(prepareDeck(second.deck).slides[2].charts[1].type, "donut");

  await assert.rejects(editDeck({ deck: result.deck, operations: [{ op: "set", path: "slides.3.chart.type", value: "area" }] }), /charts\.1/);
  await assert.rejects(editDeck({ deck: result.deck, operations: [{ op: "set", path: "slides.2.chart.shape", value: "round" }] }), /change nothing/);
});

test("placeholder cells and word-only KPIs never reach the slides", () => {
  const deck = prepareDeck({ slides: [
    { type: "cover", title: "Pricing", kpis: [{ value: "Quarterly", label: "cadence" }, { value: "12", unit: "%", label: "uplift" }, { value: "5", label: "versions compared" }] },
    { type: "table", title: "Versions", table: {
      columns: ["Dimension", "Sol 5.5", "Sol 6", "Sol 6.1"],
      rows: [["Release status", "Legacy", "Current", "Preview"], ["List price", "$10", "$15", "TBD"], ["Discount", "From CRM", "From CRM", "From CRM"], ["Upgrade path", "To 6", "Latest", "Latest"], ["Region", "From Europe", "Global", "Global"]],
      highlight_row: 3
    } },
    // Mostly placeholders: no data behind "Price snapshot", so no table and no bullet rescue.
    { type: "table", title: "Price snapshot", takeaway: "Prices to be confirmed with finance.", table: {
      columns: ["Product", "List price", "Discount", "Notes"],
      rows: [["Sol 5.5", "To populate", "To populate", "Legacy"], ["Sol 6", "To confirm", "To confirm", "Current"]]
    } },
    { type: "cards", title: "Plans", cards: [{ title: "A", body: "x", metric: { value: "Quarterly" } }, { title: "B", body: "y", metric: { value: "3", unit: "x" } }] }
  ] });
  assert.deepEqual(deck.slides[0].kpis.map((entry) => entry.value), ["12"]);
  const versions = deck.slides[1].table;
  assert.deepEqual(versions.rows, [["Release status", "Legacy", "Current", "Preview"], ["List price", "$10", "$15", "—"], ["Upgrade path", "To 6", "Latest", "Latest"], ["Region", "From Europe", "Global", "Global"]]);
  assert.equal(versions.highlightRow, 2);
  assert.deepEqual(deck.slides.map((entry) => entry.title), ["Pricing", "Versions", "Plans"]);
  assert.deepEqual(deck.slides[2].cards.map((card) => card.metric?.value ?? null), [null, "3"]);
});
