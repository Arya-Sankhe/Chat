import fs from "node:fs/promises";
import path from "node:path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import { deckFromMarkdown, renderDeck } from "./deck/render.js";
import { alignDeck } from "./deck/spec.js";
import { THEME_NAMES } from "./deck/themes.js";

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

const THEMES = {
  clean: {
    name: "clean",
    font: "Aptos",
    headingFont: "Aptos Display",
    accent: "111111",
    accent2: "4B5563",
    bg: "FFFFFF",
    panel: "F7F7F8",
    tableHeader: "F2F4F7",
    tableStripe: "FAFAFA",
    border: "D9DDE3",
    body: "252525",
    muted: "777777"
  },
  business: {
    name: "business",
    font: "Aptos",
    headingFont: "Aptos Display",
    accent: "0F766E",
    accent2: "155E75",
    bg: "FFFFFF",
    panel: "ECFDF5",
    tableHeader: "CCFBF1",
    tableStripe: "F0FDFA",
    border: "99F6E4",
    body: "172B2A",
    muted: "64748B"
  },
  academic: {
    name: "academic",
    font: "Georgia",
    headingFont: "Georgia",
    accent: "1D4ED8",
    accent2: "334155",
    bg: "FFFFFF",
    panel: "EFF6FF",
    tableHeader: "DBEAFE",
    tableStripe: "F8FAFC",
    border: "BFDBFE",
    body: "1E293B",
    muted: "64748B"
  }
};

function argb(color) {
  return `FF${String(color || "000000").replace(/^#/, "").toUpperCase()}`;
}

function safeName(value, fallback = "document") {
  const base = path.basename(String(value || fallback));
  const cleaned = base.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return (cleaned || fallback).slice(0, 120);
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s-{2,}\s/g, " - ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

function artifactContent(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  return String(input.content || input.source_text || data.content || data.text || data.body || "").trim();
}

function resolveTheme(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  const explicit = String(input.theme || data.theme || "").toLowerCase();
  if (THEMES[explicit]) return THEMES[explicit];
  const text = [
    input.title,
    input.instructions,
    artifactContent(input),
    ...(Array.isArray(input.sections) ? input.sections.map((section) => `${section.title || section.heading || ""} ${section.content || section.text || ""}`) : [])
  ].join(" ").toLowerCase();
  if (/\b(homework|assignment|lecture|class|course|student|teacher|professor|university|school|research|paper|study|citation|chapter|exam)\b/.test(text)) {
    return THEMES.academic;
  }
  if (/\b(business|strategy|proposal|client|executive|sales|market|marketing|finance|budget|roadmap|kpi|dashboard|operations|plan|report)\b/.test(text)) {
    return THEMES.business;
  }
  return THEMES.clean;
}

function comparableHeading(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function headingTokens(text) {
  const stop = new Set(["api", "price", "pricing", "comparison", "analysis", "report", "document", "vs", "v", "plus"]);
  return new Set(cleanText(text).toLowerCase().split(/[^a-z0-9.]+/).filter((token) => token.length > 1 && !stop.has(token)));
}

function headingsLookDuplicate(a, b) {
  const left = comparableHeading(a);
  const right = comparableHeading(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = headingTokens(a);
  const rightTokens = headingTokens(b);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared >= 2 && shared >= Math.min(leftTokens.size, rightTokens.size) * 0.6;
}

function stripDuplicateTitleHeading(text, title) {
  const lines = String(text || "").split(/\r?\n/);
  const titleKey = comparableHeading(title);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading && (comparableHeading(cleanText(heading[1])) === titleKey || headingsLookDuplicate(heading[1], title))) {
      return [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n").trim();
    }
    return String(text || "");
  }
  return String(text || "");
}

function stripDuplicateLeadingMetadata(text, title, subtitle = "") {
  let lines = String(text || "").split(/\r?\n/);
  while (lines.length) {
    const firstIndex = lines.findIndex((line) => line.trim());
    if (firstIndex < 0) return "";
    if (firstIndex > 0) lines = lines.slice(firstIndex);
    const raw = lines[0].trim();
    const heading = raw.match(/^#{1,3}\s+(.+)$/);
    const visible = heading ? heading[1] : raw;
    if (heading && headingsLookDuplicate(visible, title)) {
      lines = lines.slice(1);
      continue;
    }
    if (subtitle && headingsLookDuplicate(visible, subtitle)) {
      lines = lines.slice(1);
      continue;
    }
    break;
  }
  return lines.join("\n").trim();
}

function splitMarkdownTableRow(line) {
  let row = String(line || "").trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  const cells = [];
  let current = "";
  let escaped = false;
  for (const char of row) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function normalizeRowWidth(row, width) {
  const values = Array.isArray(row) ? row.map((value) => String(value ?? "").trim()) : [String(row ?? "").trim()];
  if (values.length === width) return values;
  if (values.length < width) return [...values, ...Array(width - values.length).fill("")];
  if (width === 1) return [values.join("|")];
  if (width === 2) return [values[0], values.slice(1).join("|")];
  return [...values.slice(0, width - 2), values.slice(width - 2, -1).join("|"), values.at(-1)];
}

function collectMarkdownTable(lines, start) {
  if (start + 1 >= lines.length) return null;
  if (!lines[start].includes("|") || !isMarkdownTableSeparator(lines[start + 1])) return null;
  const headers = splitMarkdownTableRow(lines[start]);
  const rows = [];
  let index = start + 2;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line || !line.includes("|")) break;
    rows.push(normalizeRowWidth(splitMarkdownTableRow(line), headers.length));
    index += 1;
  }
  return { table: { headers, rows }, nextIndex: index };
}

function markdownBlocks(text) {
  const blocks = [];
  const lines = String(text || "").split(/\r?\n/);
  let index = 0;
  let code = null;
  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        code = [];
      }
      index += 1;
      continue;
    }
    if (code) {
      code.push(raw.replace(/\s+$/g, ""));
      index += 1;
      continue;
    }
    if (!line) {
      index += 1;
      continue;
    }
    if (/^[-*_]{3,}$/.test(line)) {
      index += 1;
      continue;
    }
    const table = collectMarkdownTable(lines, index);
    if (table) {
      blocks.push({ type: "table", table: table.table });
      index = table.nextIndex;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: Math.min(heading[1].length, 3), text: cleanText(heading[2]) });
      index += 1;
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push({ type: "bullet", text: cleanText(bullet[1]) });
      index += 1;
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      blocks.push({ type: "number", text: cleanText(numbered[1]) });
      index += 1;
      continue;
    }
    blocks.push({ type: "paragraph", text: cleanText(line) });
    index += 1;
  }
  if (code && code.length) blocks.push({ type: "code", text: code.join("\n") });
  return blocks;
}

function qualityDocumentMarkdown(text, title = "") {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let previous = "";
  const hasHeading = lines.some((line) => /^#{1,3}\s+\S/.test(line.trim()));
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/\s+$/g, "");
    const line = raw.trim();
    if (line && line === previous) continue;
    previous = line;
    const next = lines.slice(index + 1).find((candidate) => candidate.trim()) || "";
    const label = line.match(/^([A-Z][A-Za-z0-9 &/(),.-]{2,58}):$/);
    if (!hasHeading && label && next.trim() && !/^\|/.test(next.trim())) {
      out.push(`## ${cleanText(label[1])}`);
      continue;
    }
    out.push(raw);
  }
  const body = out.join("\n").trim();
  if (!body) return "";
  if (!hasHeading && body.split(/\n\s*\n/).filter((block) => block.trim()).length >= 3) {
    return `## Overview\n\n${body}`;
  }
  return stripDuplicateTitleHeading(body, title);
}

function qualityDocumentBlocks(text, title = "") {
  const blocks = markdownBlocks(qualityDocumentMarkdown(text, title));
  return blocks.filter((block, index) => {
    if (block.type !== "heading") return true;
    const next = blocks[index + 1];
    if (!next || next.type === "heading") return false;
    return true;
  });
}

function tableRows(tableData, limit = 200) {
  const headers = Array.isArray(tableData?.headers) ? tableData.headers : [];
  const rows = Array.isArray(tableData?.rows) ? tableData.rows : Array.isArray(tableData?.data) ? tableData.data : [];
  const all = headers.length ? [headers, ...rows] : rows;
  const width = Math.max(1, ...all.map((row) => (Array.isArray(row) ? row.length : 1)));
  return all.slice(0, limit).map((row) => normalizeRowWidth(row, width));
}

function docxParagraph(block, theme) {
  if (block.type === "heading") {
    const heading = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
    return new Paragraph({ text: block.text, heading, spacing: { before: 220, after: 100 } });
  }
  if (block.type === "bullet") {
    return new Paragraph({ text: block.text, style: "Normal", bullet: { level: 0 }, spacing: { after: 80 } });
  }
  if (block.type === "number") {
    return new Paragraph({ text: block.text, style: "Normal", numbering: { reference: "default-numbering", level: 0 }, spacing: { after: 80 } });
  }
  if (block.type === "code") {
    return new Paragraph({
      children: [new TextRun({ text: block.text.slice(0, 4000), font: "Courier New", size: 19, color: theme.body })],
      spacing: { before: 120, after: 120 },
      shading: { fill: theme.panel },
      border: { left: { style: BorderStyle.SINGLE, size: 8, color: theme.accent } }
    });
  }
  return new Paragraph({
    children: [new TextRun({ text: block.text, size: 22, color: theme.body })],
    style: "Normal",
    spacing: { after: 120 },
    alignment: AlignmentType.LEFT
  });
}

function docxTable(tableData, theme) {
  const rows = tableRows(tableData);
  if (!rows.length) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cleanText(cell), bold: rowIndex === 0, size: 19, color: rowIndex === 0 ? "FFFFFF" : theme.body })],
          spacing: { before: 20, after: 20 }
        })],
        shading: rowIndex === 0 ? { fill: theme.accent } : rowIndex % 2 === 0 ? { fill: theme.tableStripe } : undefined,
        margins: { top: 105, bottom: 105, left: 120, right: 120 }
      }))
    }))
  });
}

function docxCallout(text, theme) {
  const cleaned = cleanText(text).slice(0, 650);
  if (!cleaned) return null;
  return new Paragraph({
    children: [new TextRun({ text: cleaned, size: 22, color: theme.body })],
    style: "Normal",
    shading: { fill: theme.panel },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: theme.accent } },
    spacing: { before: 80, after: 220 },
    indent: { left: 180 }
  });
}

async function createDocx(input, outputPath) {
  const title = input.title || "Generated document";
  const theme = resolveTheme(input);
  const children = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      spacing: { after: input.instructions ? 80 : 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: theme.accent } }
    })
  ];
  if (input.instructions) {
    children.push(new Paragraph({
      children: [new TextRun({ text: cleanText(input.instructions).slice(0, 240), color: theme.muted, size: 21 })],
      style: "Subtitle",
      spacing: { after: 240 }
    }));
  }
  const body = stripDuplicateLeadingMetadata(stripDuplicateTitleHeading(artifactContent(input), title), title, input.instructions || "");
  const summary = input.data?.summary || input.data?.recommendation || input.recommendation;
  const callout = docxCallout(summary, theme);
  if (callout) children.push(callout);
  for (const block of qualityDocumentBlocks(body || input.instructions || "", title)) {
    if (block.type === "table") {
      const table = docxTable(block.table, theme);
      if (table) children.push(table);
      children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
    } else {
      children.push(docxParagraph(block, theme));
    }
  }
  for (const section of Array.isArray(input.sections) ? input.sections.slice(0, 40) : []) {
    const heading = section.heading || section.title;
    if (heading) children.push(new Paragraph({ text: cleanText(heading), heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } }));
    for (const block of qualityDocumentBlocks(section.content || section.text || "", heading || title)) {
      if (block.type === "table") {
        const table = docxTable(block.table, theme);
        if (table) children.push(table);
        children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
      } else {
        children.push(docxParagraph(block, theme));
      }
    }
  }
  for (const tableData of Array.isArray(input.tables) ? input.tables.slice(0, 20) : []) {
    if (tableData.title || tableData.caption) {
      children.push(new Paragraph({ text: cleanText(tableData.title || tableData.caption), heading: HeadingLevel.HEADING_2 }));
    }
    const table = docxTable(tableData, theme);
    if (table) children.push(table);
    children.push(new Paragraph({ text: "", spacing: { after: 160 } }));
  }
  const doc = new Document({
    creator: "Klui",
    description: input.instructions || "",
    title,
    numbering: {
      config: [{
        reference: "default-numbering",
        levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }]
      }]
    },
    styles: {
      paragraphStyles: [
        { id: "Normal", name: "Normal", run: { font: theme.font, size: 22, color: theme.body }, paragraph: { spacing: { line: 276 } } },
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: theme.headingFont, bold: true, size: 42, color: theme.accent } },
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: theme.font, size: 22, color: theme.muted }, paragraph: { spacing: { after: 240 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: theme.headingFont, bold: true, size: 30, color: theme.accent } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: theme.headingFont, bold: true, size: 25, color: theme.accent2 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: theme.headingFont, bold: true, size: 23, color: theme.body } }
      ]
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1008, right: 1008, bottom: 1008, left: 1008 }
        }
      },
      children
    }]
  });
  await fs.writeFile(outputPath, await Packer.toBuffer(doc));
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
  if (!["docx", "pptx"].includes(format)) throw new Error(`Unsupported format: ${format}`);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeName(input.title || "Generated document")}.${format}`);
  let warnings = [];
  let deck = null;
  if (format === "docx") await createDocx(input, outputPath);
  if (format === "pptx") ({ warnings, deck } = await createPptx(input, outputPath));
  process.stdout.write(JSON.stringify({ path: outputPath, content_type: MIME[format], warnings: warnings.slice(0, 20), ...(deck ? { deck } : {}) }));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
