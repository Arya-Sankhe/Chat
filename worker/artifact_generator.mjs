import fs from "node:fs/promises";
import path from "node:path";

import { closeBrowser, renderDocument } from "./doc/render.js";
import { normalizeDoc, parseDocMarkdown } from "./doc/spec.js";
import { deckFromMarkdown, renderDeck } from "./deck/render.js";
import { alignDeck } from "./deck/spec.js";
import { THEME_NAMES } from "./deck/themes.js";

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

function safeName(value, fallback = "document") {
  const base = path.basename(String(value || fallback));
  const cleaned = base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return (cleaned || fallback).slice(0, 120);
}

function artifactContent(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  return String(input.content || input.source_text || data.content || data.text || data.body || "").trim();
}

function tableBlock(table) {
  const columns = Array.isArray(table?.headers) ? table.headers : Array.isArray(table?.columns) ? table.columns : [];
  const rows = Array.isArray(table?.rows) ? table.rows : Array.isArray(table?.data) ? table.data : [];
  return { type: "table", columns, rows, caption: table?.title || table?.caption || "" };
}

// Plain text with "Executive Summary:" style labels on their own lines gets real headings.
function promoteLabels(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.some((line) => /^#{1,4}\s+\S/.test(line.trim())) || /^---\s*$/m.test(lines.find((line) => line.trim()) || "")) return text;
  return lines.map((line, index) => {
    const label = line.trim().match(/^([A-Z][A-Za-z0-9 &/(),.'-]{2,58}):$/);
    const next = lines.slice(index + 1).find((candidate) => candidate.trim()) || "";
    return label && next.trim() && !next.trim().startsWith("|") ? `## ${label[1]}` : line;
  }).join("\n");
}

// The DocSpec a create or edit job renders: the doc writer's spec when there is one, otherwise
// the markdown content (DocMarkdown or plain markdown) parsed with the same design system.
function docInput(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  const fallback = { title: input.title, style: input.theme || data.theme || data.style, hint: `${input.title || ""} ${input.instructions || ""}` };
  if (data.doc && typeof data.doc === "object" && Array.isArray(data.doc.blocks)) {
    return normalizeDoc({ ...data.doc, title: data.doc.title ?? input.title }, fallback);
  }
  const doc = parseDocMarkdown(promoteLabels(artifactContent(input) || input.instructions || ""), fallback);
  const extra = [];
  for (const section of Array.isArray(input.sections) ? input.sections.slice(0, 50) : []) {
    const heading = section?.heading || section?.title;
    const parsed = parseDocMarkdown(`${heading ? `## ${heading}\n\n` : ""}${section?.content || section?.text || ""}`, { title: "-" });
    extra.push(...parsed.blocks);
  }
  for (const table of Array.isArray(input.tables) ? input.tables.slice(0, 20) : []) extra.push(tableBlock(table));
  if (!extra.length) return doc;
  return normalizeDoc({ ...doc, blocks: [...doc.blocks.map(({ id, ...block }) => block), ...extra] }, fallback);
}

// PDF or DOCX from the DocSpec. A DOCX also gets a PDF preview printed from the same spec.
async function createDocument(input, outputPath, format) {
  const doc = docInput(input);
  const { warnings } = await renderDocument(doc, format, outputPath);
  let previewPath = null;
  if (format === "docx" && input.preview_pdf !== false) {
    previewPath = outputPath.replace(/\.docx$/i, ".pdf");
    await renderDocument(doc, "pdf", previewPath);
  }
  return { doc, warnings, previewPath };
}

// Legacy theme names from older tool calls map onto the deck themes.
const LEGACY_DECK_THEMES = { academic: "academy", business: "boardroom", clean: "" };

function deckInput(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  // The theme the caller asked for beats the one the deck writer picked.
  const theme = String(input.theme || data.theme || "").toLowerCase();
  const known = theme in LEGACY_DECK_THEMES ? LEGACY_DECK_THEMES[theme] : theme;
  const mapped = THEME_NAMES.includes(known) ? known : "";
  if (data.deck && typeof data.deck === "object" && Array.isArray(data.deck.slides)) {
    return { ...data.deck, theme: mapped || data.deck.theme, title: data.deck.title || input.title };
  }
  if (Array.isArray(data.slides) && data.slides.length) {
    return { theme: mapped, title: input.title, subtitle: input.instructions, source: input.source || data.source, slides: data.slides };
  }
  const converted = deckFromMarkdown(input);
  return { ...converted, theme: mapped || converted.theme, source: input.source || data.source };
}

// Returns the DeckSpec that was rendered (markdown fallback included) so later edits start from
// what is on the slides. It stays in the input format the editor and renderer read, aligned to
// pages, with the resolved theme and title pinned so re-rendering it draws the same deck.
async function createPptx(input, outputPath) {
  const raw = deckInput(input);
  const fallback = { title: input.title, instructions: input.instructions };
  const { deck, warnings } = await renderDeck(raw, outputPath, fallback);
  return { warnings, deck: { ...alignDeck(raw, fallback), theme: deck.theme, title: deck.title } };
}

async function main() {
  const [inputPath, outputDir] = process.argv.slice(2);
  if (!inputPath || !outputDir) throw new Error("Usage: node artifact_generator.mjs <input.json> <output-dir>");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const format = String(input.format || "").toLowerCase();
  if (!["docx", "pdf", "pptx"].includes(format)) throw new Error(`Unsupported format: ${format}`);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeName(input.title || "Generated document")}.${format}`);
  let warnings = [];
  let deck = null;
  let doc = null;
  let previewPath = null;
  try {
    if (format === "docx" || format === "pdf") ({ warnings, doc, previewPath } = await createDocument(input, outputPath, format));
    if (format === "pptx") ({ warnings, deck } = await createPptx(input, outputPath));
  } finally {
    await closeBrowser();
  }
  process.stdout.write(JSON.stringify({
    path: outputPath,
    content_type: MIME[format],
    warnings: warnings.slice(0, 20),
    ...(deck ? { deck } : {}),
    ...(doc ? { doc } : {}),
    ...(previewPath ? { preview_path: previewPath } : {})
  }));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
