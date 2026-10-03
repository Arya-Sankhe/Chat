import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "../worker/node_modules/jszip/lib/index.js";
import { blockText, docToMarkdown, normalizeDoc, parseDocMarkdown } from "../worker/doc/spec.js";
import { parseInline, textBlocks } from "../worker/doc/inline.js";
import { renderHtml, columnWeights } from "../worker/doc/html.js";
import { chartSvg, formatValue } from "../worker/doc/charts.js";
import { renderDocx } from "../worker/doc/docx.js";
import { STYLE_NAMES, chooseStyle, resolveStyle, styleName } from "../worker/doc/themes.js";
import { applyDocOperations, editDoc, selectionBlocks } from "../server/documents/docEditor.js";
import { reviewDoc } from "../server/documents/docReview.js";
import { inferCreateFormat } from "../server/documents/inferFormat.js";
import { buildDocWriterUser, parseWriterDoc, writeDoc } from "../server/documents/docWriter.js";
import { editUploadedFile, resolveSelection, scopeFileOperations, validFileOperations } from "../server/documents/fileEditor.js";
import { selectionPlainText } from "../public/js/documentSelection.js";

const SAMPLE = `---
style: briefing
title: The Dot-Com Bubble
subtitle: A short case study
kicker: Economics · Case study
author: Jordan Lee
meta:
  - Course: ECON 214
overrides:
  colors: {accent: 1B5E20}
footer: {center: "{title} | Page {page}"}
---
## Summary || Overview
The **bubble** grew fast, and $x^2$ is math but $5 and $10 are prices.

:::stats
- 5,048 | NASDAQ peak | Mar 2000
- −78% | Peak to trough
:::

:::callout warning "Why it failed"
Losses had nothing to fund them.
- point one
:::

- one
  - nested
- two

1. first
2. second

Table: Selected collapses

| Company | Peak value | Outcome |
|---|--:|---|
| Pets.com | $300M | Liquidated |
| Webvan | $1.2B | Bankrupt |
Note: Approximate.

\`\`\`chart
{"chart":"line","title":"NASDAQ","categories":["1998","1999","2000"],"series":[{"name":"Index","values":[1800,2500,5048]}],"highlight":2}
\`\`\`

$$
\\int_0^1 x^2\\,dx = \\tfrac13
$$

:::problem "Problem 1" "Limits"
Evaluate the limit.
:::

:::answer "Answer"
$L = 2$
:::

:::entry
title: Analyst Intern
org: Acme
location: Remote
dates: Jun 2025 – Aug 2025
- Built models
:::

:::fields 1 boxed
- Project aim: Reduce waste
- Name:
:::

:::references
- Shiller, R. J. (2000). *Irrational Exuberance*. Princeton University Press.
:::
`;

test("DocMarkdown parses front matter, every block type and stable ids", () => {
  const doc = parseDocMarkdown(SAMPLE);
  assert.equal(doc.style, "briefing");
  assert.equal(doc.title, "The Dot-Com Bubble");
  assert.deepEqual(doc.meta, [{ label: "Course", value: "ECON 214" }]);
  assert.deepEqual(doc.overrides, { colors: { accent: "1B5E20" } });
  assert.deepEqual(doc.footer, { center: "{title} | Page {page}" });
  const types = doc.blocks.map((block) => block.type);
  assert.deepEqual(types, ["heading", "paragraph", "stats", "callout", "list", "list", "table", "chart", "equation", "problem", "answer", "entry", "fields", "references"]);
  assert.deepEqual(doc.blocks.map((block) => block.id), doc.blocks.map((_, i) => `b${i + 1}`));
  const heading = doc.blocks[0];
  assert.equal(heading.tag, "Overview");
  const table = doc.blocks.find((block) => block.type === "table");
  assert.equal(table.caption, "Selected collapses");
  assert.equal(table.note, "Approximate.");
  assert.deepEqual(table.rows[0], ["Pets.com", "$300M", "Liquidated"]);
  assert.equal(doc.blocks[4].items[0].items[0], "nested");
  assert.equal(doc.blocks[5].style, "number");
  assert.equal(doc.blocks.find((block) => block.type === "fields").boxed, true);
  assert.match(docToMarkdown(doc), /\| Pets\.com \| \$300M \| Liquidated \|/);
});

test("ids survive re-normalisation and new blocks get fresh ids", () => {
  const doc = parseDocMarkdown(SAMPLE);
  const again = normalizeDoc({ ...doc, blocks: [{ type: "paragraph", text: "new" }, ...doc.blocks] });
  assert.equal(again.blocks[1].id, "b1");
  assert.equal(again.blocks[0].id, `b${doc.blocks.length + 1}`);
});

test("essay header lines repeated in the body move into the title block", () => {
  const doc = parseDocMarkdown(`---\nstyle: mla\ntitle: Isolation in Frankenstein\nauthor: Daniel Ortiz\n---\n\nDaniel Ortiz  \nProfessor Hughes  \nENG 102  \n14 October 2026\n\nIsolation in Frankenstein\n\nThe essay begins here.`);
  assert.deepEqual(doc.meta.map((item) => item.value), ["Daniel Ortiz", "Professor Hughes", "ENG 102", "14 October 2026"]);
  assert.equal(doc.blocks.length, 1);
  assert.equal(doc.blocks[0].text, "The essay begins here.");
});

test("inline markup keeps prices as text and LaTeX as math in every delimiter", () => {
  const runs = parseInline(String.raw`Costs $5 and $10, **bold *both***, $x^2$, \(a+b\), $38\,\mathrm{J/K}$, $$\boxed{x}$$, H~2~O, ____ blank`);
  const math = runs.filter((run) => run.math).map((run) => run.text);
  assert.deepEqual(math, ["x^2", "a+b", String.raw`38\,\mathrm{J/K}`, String.raw`\boxed{x}`]);
  assert.ok(runs.some((run) => run.text.includes("Costs $5 and $10")));
  assert.ok(runs.some((run) => run.bold && run.italic && run.text === "both"));
  assert.ok(runs.some((run) => run.sub && run.text === "2"));
  assert.ok(runs.some((run) => run.text.includes("____")));
  assert.deepEqual(textBlocks("Intro\n- a\n- b\n\n$$x$$").map((block) => block.type), ["paragraph", "list", "equation"]);
});

test("every style resolves and overrides change only what they name", () => {
  for (const name of STYLE_NAMES) {
    const theme = resolveStyle({ style: name });
    assert.ok(theme.fonts.pdf.body && theme.fonts.docx.body, name);
  }
  const theme = resolveStyle({ style: "report", overrides: { colors: { accent: "1B5E20" }, fonts: { heading: "Gelasio" }, title_align: "center" } });
  assert.equal(theme.colors.accent, "1B5E20");
  assert.equal(theme.fonts.docx.heading, "Georgia");
  assert.equal(theme.layout.titleBlock, "center");
  assert.equal(styleName("resume"), "cv");
  assert.equal(chooseStyle("make me a resume for a software internship"), "cv_modern");
  assert.equal(chooseStyle("MLA essay on Hamlet"), "mla");
});

test("HTML marks every block, numbers headings and keeps the custom footer", () => {
  const doc = parseDocMarkdown(SAMPLE);
  const html = renderHtml(doc);
  for (const block of doc.blocks) assert.match(html, new RegExp(`data-block="${block.id}"`));
  assert.match(html, /<span class="num">1\.<\/span>/);
  assert.match(html, /@bottom-center\{content:"The Dot-Com Bubble" " \| Page " counter\(page\);\}/);
  assert.doesNotMatch(html, /Page " counter\(page\) " of/);
  assert.match(html, /class="katex/);
  assert.match(html, /Costs|prices/);
});

test("table columns size from body cells, not long headers", () => {
  const weights = columnWeights({ columns: ["Trial", "Aluminium initial temperature (°C)"], rows: [["1", "98.0"], ["2", "98.0"]] });
  assert.ok(weights[0] >= 8);
  assert.ok(weights[1] < 30);
});

test("charts format units and draw every type", () => {
  assert.equal(formatValue(6.76, "€bn"), "€6.76bn");
  assert.equal(formatValue(42, "%"), "42%");
  assert.equal(formatValue(12500, "$", [12500], true), "$13k");
  const theme = resolveStyle({ style: "report" });
  for (const chart of ["bar", "column", "line", "area", "pie", "donut", "stacked", "stacked_bar", "combo"]) {
    const svg = chartSvg({ chart, title: "T", categories: ["A", "B", "C"], series: [{ name: "S", values: [1, 2, 3] }, { name: "L", values: [2, 3, 1], type: "line" }] }, theme, theme.fonts.pdf);
    assert.match(svg, /^<svg/, chart);
  }
  assert.match(chartSvg({ chart: "scatter", points: [{ label: "a", x: 1, y: 2 }, { label: "b", x: 2, y: 4 }, { label: "c", x: 3, y: 6.1 }, { label: "d", x: 4, y: 8 }] }, theme, theme.fonts.pdf), /stroke-dasharray="5 4"/);
});

test("DOCX renders native styles, lists, tables and equations", async () => {
  const doc = parseDocMarkdown(SAMPLE);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "klui-doc-"));
  const file = path.join(dir, "out.docx");
  await renderDocx(doc, file, { charts: [] });
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:pStyle w:val="Heading1"/);
  assert.match(xml, /<m:oMath/);
  assert.match(xml, /Pets\.com/);
  assert.match(xml, /w:numPr/);
  const footer = Object.keys(zip.files).find((name) => /word\/footer\d+\.xml/.test(name));
  assert.match(await zip.file(footer).async("string"), /PAGE/);
});

test("doc operations change only the addressed blocks and respect a selection", () => {
  const doc = parseDocMarkdown(SAMPLE);
  const { doc: next, applied, skipped } = applyDocOperations(doc, [
    { op: "replace", block: "b2", find: "grew fast", replace: "grew very fast" },
    { op: "set", block: "b7", path: "rows.1.1", value: "$1.3B" },
    { op: "insert_after", block: "b1", markdown: "A new paragraph." },
    { op: "set_doc", path: "overrides.colors.accent", value: "C62828" },
    { op: "remove", block: "b5", path: "items.1" }
  ]);
  assert.equal(applied.length, 5, JSON.stringify(skipped));
  assert.match(next.blocks.find((block) => block.id === "b2").text, /grew very fast/);
  assert.equal(next.blocks.find((block) => block.id === "b7").rows[1][1], "$1.3B");
  assert.equal(next.blocks[1].text, "A new paragraph.");
  assert.equal(next.overrides.colors.accent, "C62828");
  assert.equal(next.blocks.find((block) => block.id === "b5").items.length, 1);
  for (const block of doc.blocks.filter((entry) => !["b2", "b5", "b7"].includes(entry.id))) {
    assert.equal(blockText(next.blocks.find((entry) => entry.id === block.id)), blockText(block));
  }
  const scoped = applyDocOperations(doc, [{ op: "replace", block: "b2", find: "bubble", replace: "mania" }, { op: "replace", block: "b4", find: "Losses", replace: "Debts" }, { op: "set_doc", path: "title", value: "X" }], { scope: new Set(["b2"]) });
  assert.equal(scoped.applied.length, 1);
  assert.equal(scoped.skipped.length, 2);
});

test("remove paths never reach the object prototype", () => {
  const doc = parseDocMarkdown(SAMPLE);
  const before = Object.prototype.constructor;
  const result = applyDocOperations(doc, [
    { op: "remove", block: "b2", path: "__proto__.constructor" },
    { op: "remove", block: "b2", path: "constructor" },
    { op: "remove", block: "b2", path: "toString" },
    { op: "set", block: "b2", path: "__proto__.polluted", value: "x" }
  ]);
  assert.equal(Object.prototype.constructor, before);
  assert.equal({}.polluted, undefined);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 4);
});

test("a rejected operation leaves the document untouched", () => {
  const doc = parseDocMarkdown(SAMPLE);
  const b2 = blockText(doc.blocks.find((block) => block.id === "b2"));
  const result = applyDocOperations(doc, [
    { op: "set", block: "b2", path: "text", value: "" },
    { op: "replace", block: "b4", find: "Losses", replace: "Debts" }
  ]);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(blockText(result.doc.blocks.find((block) => block.id === "b2")), b2);
});

test("an unmatched selection fails instead of editing the whole document", async () => {
  const doc = parseDocMarkdown(SAMPLE);
  let called = false;
  const modelClient = { async streamChatCompletion() { called = true; throw new Error("not reached"); } };
  await assert.rejects(
    editDoc({ config: {}, modelClient, doc, instructions: "shorter", selection: { text: "words that appear nowhere in this file" } }),
    (error) => error.status === 409
  );
  assert.equal(called, false);
  // A selection in the title block may change only that field.
  const titled = applyDocOperations(doc, [{ op: "set_doc", path: "title", value: "The Bubble" }, { op: "set_doc", path: "subtitle", value: "x" }, { op: "replace", block: "b2", find: "bubble", replace: "mania" }], { scope: new Set(), docFields: new Set(["title"]) });
  assert.equal(titled.doc.title, "The Bubble");
  assert.equal(titled.applied.length, 1);
});

test("uploaded-file edits stay inside the selection", () => {
  const outline = { kind: "docx", paragraphs: [{ id: "p1", text: "Alpha line" }, { id: "p2", text: "The fee is 10 dollars." }, { id: "p3", text: "The fee is 10 dollars again." }] };
  const { operations } = scopeFileOperations("docx", outline, { text: "The fee is 10 dollars.", before: "Alpha line", after: "The fee is" }, [
    { type: "replace_text", find: "10 dollars", replace: "12 dollars" },
    { type: "set_text", id: "p1", text: "changed" },
    { type: "delete_row", table: 1, row: 1 }
  ]);
  assert.deepEqual(operations, [{ type: "replace_text", find: "10 dollars", replace: "12 dollars", id: "p2" }]);
  const pdf = { kind: "pdf", pages: [{ page: 1, lines: [{ id: "p1.l1", text: "Name: Jane" }, { id: "p1.l2", text: "Grade: 7" }] }] };
  const scoped = scopeFileOperations("pdf", pdf, { text: "Grade: 7", page: 1 }, [
    { type: "replace_text", find: "7", replace: "8" },
    { type: "replace_text", line: "p1.l1", find: "Jane", replace: "Joe" }
  ]);
  assert.deepEqual(scoped.operations, [{ type: "replace_text", find: "7", replace: "8", line: "p1.l2", page: 1 }]);
});

test("repeated text resolves to one place by its surroundings, or is refused", () => {
  const outline = { kind: "docx", paragraphs: [
    { id: "p1", text: "Invoice A" }, { id: "p2", text: "Total: 10 dollars" },
    { id: "p3", text: "Invoice B" }, { id: "p4", text: "Total: 10 dollars" }
  ] };
  const second = { text: "Total: 10 dollars", before: "Invoice A Total: 10 dollars Invoice B", after: "" };
  assert.deepEqual([...resolveSelection(outline, second).ids], ["p4"]);
  const { operations } = scopeFileOperations("docx", outline, second, [
    { type: "set_text", id: "p2", text: "Total: 12 dollars" },
    { type: "replace_text", find: "10", replace: "12" }
  ]);
  assert.deepEqual(operations, [{ type: "replace_text", find: "10", replace: "12", id: "p4" }]);
  assert.equal(resolveSelection(outline, { text: "Total: 10 dollars" }).reason, "ambiguous");
  assert.equal(resolveSelection(outline, { text: "Not in the file" }).reason, "not_found");
  assert.equal(scopeFileOperations("docx", outline, { text: "Total: 10 dollars" }, [{ type: "set_text", id: "p2", text: "x" }]).operations.length, 0);
});

test("a selection with partial first and last paragraphs covers all of them", () => {
  const outline = { kind: "docx", paragraphs: [
    { id: "p1", text: "Opening words. The tail of one" }, { id: "p2", text: "A whole middle paragraph." },
    { id: "p3", text: "Head of three and the rest." }, { id: "p4", text: "Unrelated." }
  ] };
  const selection = { text: "The tail of one\nA whole middle paragraph.\nHead of three", before: "Opening words.", after: "and the rest." };
  assert.deepEqual([...resolveSelection(outline, selection).ids], ["p1", "p2", "p3"]);
  const ops = [
    { type: "set_text", id: "p1", text: "a" }, { type: "set_text", id: "p2", text: "b" },
    { type: "set_text", id: "p3", text: "c" }, { type: "set_text", id: "p4", text: "d" }
  ];
  assert.deepEqual(scopeFileOperations("docx", outline, selection, ops).operations.map((op) => op.id), ["p1", "p2", "p3"]);
});

test("PDF fields and positioned text must sit in the selection", () => {
  const pdf = {
    kind: "pdf",
    fields: [
      { name: "form[0].Grade[0]", type: "text", widgets: [{ page: 1, x: 110, y: 398, w: 120, h: 16 }] },
      { name: "AccountNumber", type: "text", widgets: [{ page: 1, x: 110, y: 98, w: 120, h: 16 }] }
    ],
    pages: [{ page: 1, lines: [{ id: "p1.l1", text: "Name: Jane", x: 50, y: 100, w: 60, size: 12 }, { id: "p1.l2", text: "Grade: 7", x: 50, y: 400, w: 48, size: 12 }] }]
  };
  const selection = { text: "Grade: 7", page: 1 };
  const { operations } = scopeFileOperations("pdf", pdf, selection, [
    { type: "fill_field", name: "form[0].Grade[0]", value: "8" },
    { type: "fill_field", name: "AccountNumber", value: "123" },
    { type: "insert_text", page: 1, x: 120, y: 402, text: "B+" },
    { type: "insert_text", page: 1, x: 120, y: 100, text: "elsewhere" },
    { type: "insert_text", page: 1, anchor: "Name:", text: "no" },
    { type: "insert_text", page: 3, anchor: "Grade:", text: "ok" }
  ]);
  assert.deepEqual(operations.map((op) => op.name || op.text), ["form[0].Grade[0]", "B+", "ok"]);
  assert.equal(operations[2].page, 1);
  assert.equal(scopeFileOperations("pdf", pdf, { text: "Grade: 9", page: 1 }, [{ type: "fill_field", name: "AccountNumber", value: "1" }]).operations.length, 0);
});

test("PDF selection limits hold for repeated labels, field values and other columns", () => {
  const pdf = {
    kind: "pdf",
    fields: [
      { name: "BillingName", type: "text", value: "Jane", widgets: [{ page: 1, x: 140, y: 98, w: 120, h: 16 }] },
      { name: "Name", type: "text", value: "Jane", widgets: [{ page: 1, x: 140, y: 198, w: 120, h: 16 }] }
    ],
    pages: [{ page: 1, lines: [
      { id: "p1.l1", text: "Name: First", x: 50, y: 100, w: 70, size: 12 },
      { id: "p1.l2", text: "Name: Second", x: 50, y: 200, w: 80, size: 12 },
      { id: "p1.l3", text: "Right column", x: 350, y: 200, w: 80, size: 12 }
    ] }]
  };
  const selection = { text: "Name: Second", page: 1 };
  const { operations } = scopeFileOperations("pdf", pdf, selection, [
    { type: "insert_text", page: 1, anchor: "Name:", text: "anchored" },
    { type: "insert_text", page: 1, anchor: "Name:", line: "p1.l1", text: "wrong line" },
    { type: "insert_text", page: 1, x: 360, y: 200, text: "right column" },
    { type: "insert_text", page: 1, x: 140, y: 200, text: "after label" },
    { type: "insert_text", page: 1, x: 36, y: 200, text: "tick" },
    { type: "fill_field", name: "BillingName", value: "Joe" },
    { type: "fill_field", name: "Name", value: "Joe" }
  ]);
  assert.deepEqual(operations.map((op) => op.text || op.name), ["anchored", "after label", "tick", "Name"]);
  assert.equal(operations[0].line, "p1.l2");
  const flat = { kind: "pdf", pages: [{ page: 1, lines: [{ id: "p1.l1", text: "Name: Second", x: 50, y: 200, size: 12 }] }] };
  assert.equal(scopeFileOperations("pdf", flat, selection, [{ type: "insert_text", page: 1, x: 60, y: 200, text: "no width" }]).operations.length, 0);
});

test("a field with the same short name on another page is not in the selection", () => {
  const pdf = {
    kind: "pdf",
    fields: [
      { name: "student.Name", type: "text", widgets: [{ page: 1, x: 100, y: 98, w: 150, h: 16 }] },
      { name: "guardian.Name", type: "text", widgets: [{ page: 2, x: 100, y: 98, w: 150, h: 16 }] },
      { name: "Unplaced", type: "text" }
    ],
    pages: [
      { page: 1, lines: [{ id: "p1.l1", text: "Name: First", x: 50, y: 100, w: 45, size: 12 }] },
      { page: 2, lines: [{ id: "p2.l1", text: "Name: Guardian", x: 50, y: 100, w: 60, size: 12 }] }
    ]
  };
  const { operations } = scopeFileOperations("pdf", pdf, { text: "Name: First", page: 1 }, [
    { type: "fill_field", name: "student.Name", value: "A" },
    { type: "fill_field", name: "guardian.Name", value: "B" },
    { type: "fill_field", name: "Unplaced", value: "C" },
    { type: "fill_field", name: "Name", value: "D" }
  ]);
  assert.deepEqual(operations.map((op) => op.name), ["student.Name"]);
});

test("a selection of a whole numbered Word list matches without Word's list numbers", () => {
  const outline = { kind: "docx", paragraphs: [
    { id: "p1", text: "Intro." },
    { id: "p2", text: "First point about the budget.", list: true },
    { id: "p3", text: "Second point about hiring.", list: true },
    { id: "p4", text: "2. Pay within 30 days." }
  ] };
  const placed = resolveSelection(outline, { text: "1. First point about the budget.\n2. Second point about hiring.", before: "Intro.", after: "2. Pay" });
  assert.deepEqual([...placed.ids], ["p2", "p3"]);
  // A number typed into the text is content, not a list marker.
  assert.deepEqual([...resolveSelection(outline, { text: "2. Pay within 30 days." }).ids], ["p4"]);
  assert.equal(resolveSelection({ kind: "docx", paragraphs: [{ id: "p1", text: "Pay within 30 days." }] }, { text: "2. Pay within 30 days." }).reason, "not_found");
});

test("the viewer's collapsed selection of a numbered Word list still matches", () => {
  const outline = { kind: "docx", paragraphs: [
    { id: "p1", text: "Tasks:" },
    { id: "p2", text: "Call Alice.", list: true },
    { id: "p3", text: "Email Bob.", list: true },
    { id: "p4", text: "Ask about item 2. Email Bob is done." }
  ] };
  // Exactly what the viewer sends: line breaks (if the text layer reported any) become spaces.
  const sent = (text) => selectionPlainText(text).trim();
  const selection = { text: sent("1. Call Alice.\n2. Email Bob."), before: sent("Tasks:\n"), after: sent("\nAsk about") };
  assert.equal(selection.text, "1. Call Alice. 2. Email Bob.");
  assert.deepEqual([...resolveSelection(outline, selection).ids], ["p2", "p3"]);
  assert.deepEqual([...resolveSelection(outline, { text: sent("Ask about item 2. Email Bob") }).ids], ["p4"]);
  assert.deepEqual([...resolveSelection(outline, { text: sent("Tasks: 1. Call Al") }).ids], ["p1", "p2"]);
});

test("on a rotated PDF the field beside the selected line is the one allowed", () => {
  // Coordinates from a real PDF rotated 90° (worker test_widgets_and_lines_share_coordinates_on_a_rotated_page).
  const pdf = {
    kind: "pdf",
    fields: [
      { name: "student.Name", type: "text", widgets: [{ page: 1, x: 200, y: -119, w: 200, h: 18 }] },
      { name: "guardian.Name", type: "text", widgets: [{ page: 1, x: 200, y: 81, w: 200, h: 18 }] }
    ],
    pages: [{ page: 1, lines: [
      { id: "p1.l1", text: "Student name: First", x: 50, y: -113.8, w: 110, size: 12 },
      { id: "p1.l2", text: "Guardian name: Second", x: 50, y: 86.2, w: 130, size: 12 }
    ] }]
  };
  const { operations } = scopeFileOperations("pdf", pdf, { text: "Guardian name: Second", page: 1 }, [
    { type: "fill_field", name: "student.Name", value: "x" },
    { type: "fill_field", name: "guardian.Name", value: "y" }
  ]);
  assert.deepEqual(operations.map((op) => op.name), ["guardian.Name"]);
});

test("a long selection's end is placed by the text after it, and a tie is refused", () => {
  const closing = "Thank you for reading this section carefully today";
  const outline = { kind: "docx", paragraphs: [
    { id: "p1", text: "First point about the budget for next year and its limits." },
    { id: "p2", text: closing },
    { id: "p3", text: "Second point about hiring plans for the coming quarter." },
    { id: "p4", text: closing },
    { id: "p5", text: "Appendix starts here." }
  ] };
  // The viewer drew list numbers, so the whole text is not found and the ends are placed separately.
  const text = ["1. First point about the budget for next year and its limits.", closing, "2. Second point about hiring plans for the coming quarter.", closing].join("\n");
  const placed = resolveSelection(outline, { text: text.slice(3), before: "", after: "Appendix starts here." });
  assert.deepEqual([...placed.ids], ["p1", "p2", "p3", "p4"]);
  const doubled = { kind: "docx", paragraphs: [...outline.paragraphs.slice(0, 4), ...outline.paragraphs.slice(0, 4)] };
  assert.equal(resolveSelection(doubled, { text: text.slice(3) }).reason, "ambiguous");
});

test("a source file mentioned in the request is not the output format", () => {
  assert.equal(inferCreateFormat("pptx", { userRequest: "Turn a PDF into slides" }), "pptx");
  assert.equal(inferCreateFormat("pptx", { userRequest: "Create slides summarizing a PDF" }), "pptx");
  assert.equal(inferCreateFormat("docx", { userRequest: "Create a report from spreadsheet data" }), "docx");
  assert.equal(inferCreateFormat("docx", { userRequest: "put this in a PDF" }), "pdf");
  assert.equal(inferCreateFormat("pdf", { userRequest: "Make a deck to pitch investors" }), "pptx");
  assert.equal(inferCreateFormat("pptx", { userRequest: "Create slides summarizing the attached PDF" }), "pptx");
  assert.equal(inferCreateFormat("docx", { userRequest: "write a word document report from my spreadsheet" }), "docx");
  assert.equal(inferCreateFormat("docx", { userRequest: "summarize it", hints: ["Report", "Summarize the spreadsheet into a report"] }), "docx");
  assert.equal(inferCreateFormat("pdf", { userRequest: "convert this word file to pdf" }), "pdf");
  assert.equal(inferCreateFormat("pdf", { userRequest: "make this a pdf" }), "pdf");
});

test("a viewer selection maps to the block that holds it", () => {
  const doc = parseDocMarkdown(SAMPLE);
  assert.deepEqual(selectionBlocks(doc, { text: "Losses had nothing" }), ["b4"]);
  assert.deepEqual(selectionBlocks(doc, { text: "Pets.com $300M" }), ["b7"]);
  assert.deepEqual(selectionBlocks(doc, { blocks: ["b3"] }), ["b3"]);
});

test("editDoc applies model operations within the selection", async () => {
  const doc = parseDocMarkdown(SAMPLE);
  let seen = "";
  const modelClient = {
    async streamChatCompletion({ body }) {
      seen = body.messages[1].content;
      const reply = JSON.stringify({ summary: "Shortened it.", operations: [{ op: "replace", block: "b4", find: "Losses had nothing to fund them.", replace: "Nothing funded the losses." }] });
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
  };
  const config = { providers: { openrouter: { apiKey: "test" } } };
  const result = await editDoc({ config, modelClient, doc, instructions: "shorter", selection: { text: "Losses had nothing to fund them." } });
  assert.match(seen, /SELECTION: the user selected this text:[\s\S]*It is in blocks b4/);
  assert.equal(result.applied.length, 1);
  assert.match(result.doc.blocks.find((block) => block.id === "b4").text, /Nothing funded the losses/);
});

test("doc review flags placeholders, empty sections and format violations", () => {
  const cv = parseDocMarkdown("---\nstyle: cv\ntitle: Jane\n---\n## Experience\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Skills\n## Education\n[Your Name] studied.");
  const { notes } = reviewDoc(cv, { userRequest: "resume" });
  assert.ok(notes.some((note) => /Placeholder/.test(note)));
  assert.ok(notes.some((note) => /ATS-safe/.test(note)));
  assert.ok(notes.some((note) => /has no content/.test(note)));
  const essay = parseDocMarkdown("---\nstyle: mla\ntitle: T\n---\n:::callout tip\nx\n:::\n\nSome prose.");
  assert.ok(reviewDoc(essay, { userRequest: "write a 1000 word essay" }).notes.some((note) => /plain prose|words/.test(note)));
  const clean = parseDocMarkdown(SAMPLE);
  assert.equal(reviewDoc(clean).notes.filter((note) => /Placeholder|garbled/.test(note)).length, 0);
});

test("doc writer builds its brief and parses fenced replies", async () => {
  const user = buildDocWriterUser({ userRequest: "lab report", title: "Heat", style: "lab", content: "data", format: "pdf" });
  assert.match(user, /STYLE HINT: lab/);
  assert.match(user, /OUTPUT FILE: PDF/);
  const doc = parseWriterDoc("```markdown\n---\ntitle: T\nstyle: notes\n---\n## A\nText here.\n```");
  assert.equal(doc.style, "notes");
  assert.equal(await writeDoc({ config: {}, modelClient: null, brief: {} }), null);
});

test("file operations are filtered to what the worker understands", () => {
  assert.deepEqual(validFileOperations("pdf", [{ type: "fill_field", name: "a" }, { type: "set_cell" }, null]).map((op) => op.type), ["fill_field"]);
  assert.deepEqual(validFileOperations("docx", [{ type: "fill_blank" }, { type: "rewrite_lines" }]).map((op) => op.type), ["fill_blank"]);
});

test("the user's named format wins over source words in the model's instructions", () => {
  const hints = ["Pricing", "Turn the slides and deck above into a report"];
  assert.equal(inferCreateFormat("pdf", { userRequest: "create a pdf out of the above info", hints }), "pdf");
  assert.equal(inferCreateFormat("pptx", { userRequest: "create a pdf out of the above info", hints }), "pdf");
  assert.equal(inferCreateFormat("pdf", { userRequest: "summarise this", hints }), "pdf");
  assert.equal(inferCreateFormat("", { userRequest: "summarise this", hints }), "pptx");
  assert.equal(inferCreateFormat("pdf", { userRequest: "make a word version of my presentation" }), "docx");
  assert.equal(inferCreateFormat("docx", { userRequest: "a pdf or word doc of the deck" }), "docx");
  assert.equal(inferCreateFormat("", { userRequest: "make me slides on photosynthesis" }), "pptx");
});

test("PDF HTML avoids glyph-swapping features that print digits without Unicode", () => {
  for (const style of STYLE_NAMES) {
    const html = renderHtml(normalizeDoc({ title: "Prices", style, blocks: [
      { type: "list", style: "number", items: ["One"] },
      { type: "table", columns: ["Model", "Input"], rows: [["GPT-6.1", "$2.00"]] }
    ] }));
    assert.doesNotMatch(html, /tabular-nums/, style);
    assert.match(html, /font-feature-settings:"calt" 0/, style);
    assert.match(html, /li::marker\{font-variant-numeric:normal;\}/, style);
  }
});

test("a selection of only symbols is refused, not treated as no selection", async () => {
  const docx = { kind: "docx", has_text: true, paragraphs: [{ id: "p1", text: "☐ Yes ☐ No" }, { id: "p2", text: "Unrelated paragraph." }] };
  const symbols = { text: selectionPlainText("☐ ☐").trim() };
  assert.equal(resolveSelection(docx, symbols).reason, "no_words");
  assert.equal(resolveSelection(docx, { text: "  " }), null);
  const { operations } = scopeFileOperations("docx", docx, symbols, [{ type: "replace_text", id: "p2", find: "Unrelated", replace: "Changed" }]);
  assert.deepEqual(operations, []);
  const pdf = { kind: "pdf", has_text: true, fields: [{ name: "Name", type: "text", widgets: [{ page: 1, x: 140, y: 98, w: 120, h: 16 }] }], pages: [{ page: 1, lines: [{ id: "p1.l1", text: "Name:", x: 50, y: 100, w: 40, size: 12 }] }] };
  assert.deepEqual(scopeFileOperations("pdf", pdf, symbols, [{ type: "fill_field", name: "Name", value: "x" }]).operations, []);
  let called = false;
  const modelClient = { async streamChatCompletion() { called = true; throw new Error("not reached"); } };
  for (const [kind, outline] of [["docx", docx], ["pdf", pdf]]) {
    await assert.rejects(editUploadedFile({ config: {}, modelClient, kind, outline, instructions: "change it", selection: symbols }), (error) => error.status === 409);
  }
  assert.equal(called, false);
});

test("a field drawn in more than one place is filled only when every place is selected", () => {
  const lines = [
    { id: "p1.l1", text: "Name:", x: 50, y: 100, w: 40, size: 12 },
    { id: "p1.l2", text: "Signed by:", x: 50, y: 300, w: 60, size: 12 }
  ];
  const pdf = (widgets, extra = {}) => ({
    kind: "pdf",
    fields: [{ name: "Name", type: "text", widgets, ...extra }],
    pages: [{ page: 1, lines }, { page: 2, lines: [{ id: "p2.l1", text: "Name again:", x: 50, y: 100, w: 70, size: 12 }] }]
  });
  const fill = [{ type: "fill_field", name: "Name", value: "CHANGED" }];
  const scoped = (outline, selection) => scopeFileOperations("pdf", outline, selection, fill).operations.length;
  const twoPages = pdf([{ page: 1, x: 100, y: 98, w: 200, h: 16 }, { page: 2, x: 130, y: 98, w: 200, h: 16 }]);
  assert.equal(scoped(twoPages, { text: "Name:", page: 1 }), 0);
  const twoRows = pdf([{ page: 1, x: 100, y: 98, w: 200, h: 16 }, { page: 1, x: 120, y: 298, w: 200, h: 16 }]);
  assert.equal(scoped(twoRows, { text: "Name:", page: 1 }), 0);
  assert.equal(scoped(twoRows, { text: "Name: Signed by:", page: 1 }), 1);
  // Some widgets could not be placed (or there were too many to list): never in a selection.
  const partial = pdf([{ page: 1, x: 100, y: 98, w: 200, h: 16 }], { widgets_partial: true });
  assert.equal(scoped(partial, { text: "Name:", page: 1 }), 0);
});
