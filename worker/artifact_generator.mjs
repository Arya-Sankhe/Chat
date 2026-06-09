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
import ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  for (const block of markdownBlocks(body || input.instructions || "")) {
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
    for (const block of markdownBlocks(section.content || section.text || "")) {
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

function rowsFromInput(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(input.rows)) return input.rows;
  if (Array.isArray(input.tables) && input.tables.length) return tableRows(input.tables[0], 1000);
  return [["Title", input.title || "Generated workbook"], ["Instructions", input.instructions || ""]];
}

function excelColumn(index) {
  let value = index;
  let out = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - mod) / 26);
  }
  return out;
}

function cleanCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return cleanText(value);
  return value;
}

function normalizeXlsxRows(rows) {
  return rows
    .map((row) => (Array.isArray(row) ? row : [row]).map(cleanCellValue))
    .filter((row) => row.some((cell) => cell !== ""));
}

function splitSparseNotes(rows) {
  const mainRows = [];
  const notes = [];
  let inNotes = false;
  for (const row of rows) {
    const first = cleanText(row[0] || "");
    const filled = row.filter((cell) => cell !== "").length;
    if (/^notes?$/i.test(first)) {
      inNotes = true;
      continue;
    }
    if (inNotes || (filled === 1 && mainRows.length > 3 && first.length > 35)) {
      if (first) notes.push([first]);
      continue;
    }
    mainRows.push(row);
  }
  return { mainRows, notes };
}

function parseTokenSplit(rows) {
  const row = rows.find((values) => /token split|ratio/i.test(String(values[0] || "")));
  const text = row ? row.join(" ") : "";
  const match = text.match(/(\d+(?:\.\d+)?)\s*%\s*input.*?(\d+(?:\.\d+)?)\s*%\s*output/i);
  if (match) return { input: Number(match[1]) / 100, output: Number(match[2]) / 100 };
  return { input: 0.6, output: 0.4 };
}

function rowIndexByLabel(rows, pattern) {
  return rows.findIndex((row) => pattern.test(String(row[0] || "")));
}

function enrichMetricComparisonRows(rows, tableStartRow) {
  if (!rows.length || !/^metric$/i.test(String(rows[0][0] || ""))) return rows;
  const split = parseTokenSplit(rows);
  const notesCol = rows[0].findIndex((cell) => /^notes?$/i.test(String(cell || "")));
  const lastMetricCol = notesCol > 0 ? notesCol - 1 : rows[0].length - 1;
  const inputPrice = rowIndexByLabel(rows, /input price/i);
  const outputPrice = rowIndexByLabel(rows, /output price/i);
  const inputCost = rowIndexByLabel(rows, /input cost/i);
  const outputCost = rowIndexByLabel(rows, /output cost/i);
  const totalCost = rowIndexByLabel(rows, /total cost/i);
  const savings = rowIndexByLabel(rows, /savings with/i);
  const savingsPct = rowIndexByLabel(rows, /savings\s*%/i);
  const enriched = rows.map((row) => [...row]);
  for (let col = 2; col <= lastMetricCol + 1; col += 1) {
    const letter = excelColumn(col);
    if (inputPrice >= 0 && inputCost >= 0 && enriched[inputCost][col - 1] === "") {
      enriched[inputCost][col - 1] = { formula: `${letter}${tableStartRow + inputPrice}*${split.input}` };
    }
    if (outputPrice >= 0 && outputCost >= 0 && enriched[outputCost][col - 1] === "") {
      enriched[outputCost][col - 1] = { formula: `${letter}${tableStartRow + outputPrice}*${split.output}` };
    }
    if (inputCost >= 0 && outputCost >= 0 && totalCost >= 0 && enriched[totalCost][col - 1] === "") {
      enriched[totalCost][col - 1] = { formula: `${letter}${tableStartRow + inputCost}+${letter}${tableStartRow + outputCost}` };
    }
  }
  if (lastMetricCol >= 2 && totalCost >= 0 && savings >= 0 && enriched[savings][1] !== "" && enriched[savings][2] === "") {
    enriched[savings][2] = { formula: `${excelColumn(3)}${tableStartRow + totalCost}-${excelColumn(2)}${tableStartRow + totalCost}` };
  }
  if (lastMetricCol >= 2 && totalCost >= 0 && savingsPct >= 0 && enriched[savingsPct][1] !== "" && enriched[savingsPct][2] === "") {
    enriched[savingsPct][2] = { formula: `${excelColumn(3)}${tableStartRow + totalCost}/${excelColumn(2)}${tableStartRow + totalCost}-1` };
  }
  return enriched;
}

function setCellValue(cell, value) {
  if (value && typeof value === "object" && value.formula) {
    cell.value = { formula: value.formula };
    return;
  }
  if (typeof value === "string" && /^=/.test(value)) {
    cell.value = { formula: value.slice(1) };
    return;
  }
  cell.value = value;
}

async function createXlsx(input, outputPath) {
  const theme = resolveTheme(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Klui";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Summary", {
    views: [{ state: "frozen", ySplit: 4 }]
  });
  const { mainRows, notes } = splitSparseNotes(normalizeXlsxRows(rowsFromInput(input).slice(0, 5000)));
  const tableStartRow = input.title || input.instructions ? 4 : 1;
  if (input.title) {
    sheet.mergeCells(1, 1, 1, Math.max(4, mainRows[0]?.length || 4));
    const titleCell = sheet.getCell(1, 1);
    titleCell.value = cleanText(input.title);
    titleCell.font = { bold: true, size: 16, color: { argb: argb(theme.accent) }, name: theme.headingFont };
  }
  if (input.instructions) {
    sheet.mergeCells(2, 1, 2, Math.max(4, mainRows[0]?.length || 4));
    const subtitleCell = sheet.getCell(2, 1);
    subtitleCell.value = cleanText(input.instructions);
    subtitleCell.font = { italic: true, size: 10.5, color: { argb: argb(theme.muted) }, name: theme.font };
  }
  const rows = enrichMetricComparisonRows(mainRows, tableStartRow);
  rows.forEach((row, rowOffset) => {
    row.forEach((value, colOffset) => setCellValue(sheet.getCell(tableStartRow + rowOffset, colOffset + 1), value));
  });
  if (rows.length > 0) {
    const header = sheet.getRow(tableStartRow);
    header.font = { bold: true, color: { argb: argb(theme.body) }, name: theme.font };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.tableHeader) } };
    header.alignment = { vertical: "middle", wrapText: true };
    header.border = { bottom: { style: "thin", color: { argb: argb(theme.accent) } } };
  }
  sheet.eachRow((row) => {
    if (row.number > tableStartRow && row.number % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.tableStripe) } };
    }
    const rowLabel = String(row.getCell(1).value || "");
    row.eachCell((cell) => {
      cell.font = { ...(cell.font || {}), name: theme.font, color: { argb: argb(theme.body) } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: argb(theme.border) } } };
      if (cell.col > 1 && /%|ratio/i.test(rowLabel)) cell.numFmt = "0.0%";
      else if (cell.col > 1 && /price|cost|savings/i.test(rowLabel)) cell.numFmt = "$0.000";
      else if (typeof cell.value === "number" && !Number.isInteger(cell.value)) cell.numFmt = "0.00";
    });
  });
  for (let index = 1; index <= sheet.columnCount; index += 1) {
    const column = sheet.getColumn(index);
    let width = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const value = typeof cell.value === "object" && cell.value?.formula ? cell.value.formula : cell.value;
      width = Math.max(width, Math.min(48, String(value ?? "").length + 2));
    });
    column.width = width;
  }
  if (sheet.rowCount > 1 && sheet.columnCount > 1) {
    sheet.autoFilter = {
      from: { row: tableStartRow, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount }
    };
  }
  if (notes.length) {
    const notesSheet = workbook.addWorksheet("Notes");
    notesSheet.addRow(["Notes"]);
    notes.forEach((row) => notesSheet.addRow(row));
    notesSheet.getRow(1).font = { bold: true, name: theme.font, color: { argb: argb(theme.body) } };
    notesSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.tableHeader) } };
    notesSheet.getColumn(1).width = 84;
    notesSheet.eachRow((row) => row.eachCell((cell) => {
      cell.font = { name: theme.font, color: { argb: argb(theme.body) } };
      cell.alignment = { vertical: "top", wrapText: true };
    }));
  }
  for (const [index, tableData] of (Array.isArray(input.tables) ? input.tables.slice(1, 8) : []).entries()) {
    const ws = workbook.addWorksheet(safeName(tableData.title || tableData.caption || `Table ${index + 2}`).slice(0, 31));
    tableRows(tableData, 5000).forEach((row) => ws.addRow(row));
    ws.getRow(1).font = { bold: true, name: theme.font, color: { argb: argb(theme.body) } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(theme.tableHeader) } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  await workbook.xlsx.writeFile(outputPath);
}

function textToBullets(text) {
  const bullets = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const cleaned = cleanText(line.replace(/^[-*\d.)\s]+/, ""));
    if (cleaned) bullets.push(cleaned);
  }
  if (!bullets.length && String(text || "").trim()) {
    bullets.push(...cleanText(text).split(/(?<=[.!?])\s+/).filter(Boolean));
  }
  return bullets.slice(0, 7);
}

function stripPlannerPrefix(value) {
  return cleanText(value)
    .replace(/^slide\s+\d+\s*:\s*/i, "")
    .replace(/^layout\s*:\s*/i, "")
    .replace(/^subtitle\s*:\s*/i, "")
    .replace(/^speaker\s+notes?\s*:\s*/i, "")
    .trim();
}

function isPlannerLine(value) {
  return /^(layout|speaker\s+notes?|visual|design|format)\s*:/i.test(cleanText(value));
}

function firstUsefulSentence(value, maxLength = 150) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return "";
  const first = text.split(/(?<=[.!?])\s+/).find(Boolean) || text;
  return first.length > maxLength ? `${first.slice(0, maxLength - 1).trim()}…` : first;
}

function extractKpis(input, slides) {
  const explicit = Array.isArray(input.kpis) ? input.kpis : Array.isArray(input.data?.kpis) ? input.data.kpis : [];
  const kpis = explicit
    .map((item) => ({
      value: cleanText(item.value || item.metric || item.number || ""),
      label: cleanText(item.label || item.title || item.description || "")
    }))
    .filter((item) => item.value && item.label);
  const text = [
    input.title,
    input.instructions,
    artifactContent(input),
    ...slides.flatMap((slide) => [slide.title, slide.subtitle, ...(slide.bullets || [])])
  ].join(" ");
  const patterns = [
    /\$[\d,.]+(?:\s*[kmb])?(?:\s*\/\s*[a-z0-9 ]+)?/gi,
    /\b\d+(?:\.\d+)?\s*[x×]\b/gi,
    /\b\d+(?:\.\d+)?\s*%/gi,
    /\b\d+(?:\.\d+)?\s*(?:AED|USD|tokens?|credits?)\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.match(pattern) || []) {
      if (kpis.length >= 3) break;
      const value = cleanText(match);
      if (!kpis.some((item) => item.value === value)) {
        kpis.push({ value, label: value.includes("$") ? "highlighted cost metric" : "key comparison metric" });
      }
    }
  }
  return kpis.slice(0, 3);
}

function slidesFromInput(input) {
  const data = input && typeof input.data === "object" && input.data ? input.data : {};
  if (Array.isArray(data.slides) && data.slides.length) return data.slides;
  const title = input.title || "Presentation";
  const content = stripDuplicateTitleHeading(artifactContent(input), title);
  const slides = [{ title, subtitle: input.instructions || "", bullets: [] }];
  let current = null;
  for (const block of markdownBlocks(content || "")) {
    if (block.type === "heading") {
      current = { title: block.text, bullets: [] };
      slides.push(current);
    } else if (block.type === "table") {
      current = current || { title: "Key Table", bullets: [] };
      if (!slides.includes(current)) slides.push(current);
      current.table = block.table;
    } else if (["bullet", "number", "paragraph"].includes(block.type)) {
      current = current || { title: "Key Points", bullets: [] };
      if (!slides.includes(current)) slides.push(current);
      current.bullets.push(block.text);
    }
  }
  if (slides.length === 1) {
    for (const section of Array.isArray(input.sections) ? input.sections.slice(0, 20) : []) {
      slides.push({
        title: cleanText(section.heading || section.title || "Section"),
        subtitle: cleanText(section.message || section.takeaway || ""),
        bullets: textToBullets(section.content || section.text || "")
      });
    }
  }
  if (slides.length === 1) slides.push({ title: "Overview", bullets: textToBullets(input.instructions || "Generated presentation") });
  return slides.slice(0, 40);
}

function normalizeSlide(slide, fallbackTitle) {
  if (!slide || typeof slide !== "object") return { title: cleanText(slide || fallbackTitle || "Slide"), bullets: [] };
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : Array.isArray(slide.points) ? slide.points : Array.isArray(slide.items) ? slide.items : textToBullets(slide.bullets || slide.points || slide.items || "");
  return {
    title: stripPlannerPrefix(slide.title || slide.heading || fallbackTitle || "Slide"),
    subtitle: stripPlannerPrefix(slide.subtitle || slide.message || slide.takeaway || ""),
    bullets: bullets.map(stripPlannerPrefix).filter((item) => item && !isPlannerLine(item)).slice(0, 7),
    notes: String(slide.notes || slide.speaker_notes || "").trim().slice(0, 2000),
    table: slide.table && typeof slide.table === "object" ? slide.table : null
  };
}

function slideText(slide) {
  return [
    slide?.title,
    slide?.subtitle,
    ...(Array.isArray(slide?.bullets) ? slide.bullets : [])
  ].map(cleanText).filter(Boolean).join(" ");
}

function slideHasTable(slide) {
  if (!slide?.table || typeof slide.table !== "object") return false;
  return tableRows(slide.table, 4).length >= 2;
}

function isWeakContentSlide(slide, index) {
  if (index === 0 || slideHasTable(slide)) return false;
  const bullets = Array.isArray(slide?.bullets) ? slide.bullets.filter((item) => cleanText(item)) : [];
  const substance = [slide?.subtitle, ...bullets].map(cleanText).filter(Boolean).join(" ");
  if (bullets.length >= 2 && substance.length >= 60) return false;
  return substance.length < 90;
}

function titleLooksLikeDivider(title) {
  return /^(agenda|overview|introduction|context|question|section|part|next|summary)$/i.test(cleanText(title));
}

function fallbackBulletsFromInput(input) {
  const bullets = [
    ...textToBullets(artifactContent(input)),
    ...textToBullets(input.instructions || "")
  ].filter((item) => cleanText(item).length > 12);
  const unique = [];
  const seen = new Set();
  for (const bullet of bullets) {
    const key = comparableHeading(bullet);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(bullet);
    if (unique.length >= 5) break;
  }
  return unique.length ? unique : ["Clarify the core point.", "Show the supporting evidence.", "End with the practical takeaway."];
}

function mergeWeakSlides(slides, input) {
  const repaired = [];
  const fallback = fallbackBulletsFromInput(input);

  for (const [index, original] of slides.entries()) {
    const slide = {
      ...original,
      title: cleanText(original.title) || (index === 0 ? cleanText(input.title) || "Presentation" : "Key Takeaway"),
      subtitle: cleanText(original.subtitle || ""),
      bullets: Array.isArray(original.bullets) ? original.bullets.map(cleanText).filter(Boolean) : []
    };

    if (index === 0) {
      if (!slide.subtitle) slide.subtitle = firstUsefulSentence(input.instructions || artifactContent(input), 155);
      repaired.push(slide);
      continue;
    }

    if (!isWeakContentSlide(slide, index) && !titleLooksLikeDivider(slide.title)) {
      repaired.push(slide);
      continue;
    }

    const payload = [
      slide.subtitle,
      ...slide.bullets,
      titleLooksLikeDivider(slide.title) ? "" : slide.title
    ].map(cleanText).filter(Boolean);

    const previous = repaired.at(-1);
    if (previous && repaired.length > 1 && !slideHasTable(previous)) {
      const label = titleLooksLikeDivider(slide.title) ? "" : `${slide.title}: `;
      for (const item of payload.length ? payload : fallback.slice(0, 2)) {
        previous.bullets = previous.bullets || [];
        if (previous.bullets.length < 6) previous.bullets.push(cleanText(`${label}${item}`));
      }
      continue;
    }

    slide.title = titleLooksLikeDivider(slide.title) ? "Key Takeaways" : slide.title;
    slide.bullets = [...payload, ...fallback].map(cleanText).filter(Boolean).slice(0, 4);
    if (!slide.subtitle && slide.bullets.length) slide.subtitle = firstUsefulSentence(slide.bullets[0], 120);
    repaired.push(slide);
  }

  if (repaired.length === 1) {
    repaired.push({
      title: "Key Takeaways",
      subtitle: "The essential points are grouped into a concise working summary.",
      bullets: fallback.slice(0, 4)
    });
  }

  return repaired.map((slide, index) => {
    if (index === 0 || slideHasTable(slide) || !isWeakContentSlide(slide, index)) return slide;
    return {
      ...slide,
      bullets: [...(slide.bullets || []), ...fallback].map(cleanText).filter(Boolean).slice(0, 4)
    };
  });
}

function compactDefaultPresentation(slides, input) {
  const text = `${input.title || ""} ${input.instructions || ""}`.toLowerCase();
  const explicitCount = /\b\d+\s*(slides?|pages?)\b/.test(text);
  const asksLong = /\b(detailed|comprehensive|full|complete|many|more slides|long deck|appendix)\b/.test(text);
  if (explicitCount || asksLong || slides.length <= 7) return slides;

  const title = slides[0];
  const body = slides.slice(1);
  const keep = body.filter((slide) => slideHasTable(slide) || (slide.bullets || []).length >= 3).slice(0, 4);
  const rest = body.filter((slide) => !keep.includes(slide));
  if (rest.length) {
    keep.push({
      title: "Bottom Line",
      subtitle: "The main conclusion is condensed from the remaining supporting points.",
      bullets: rest.flatMap((slide) => [slide.subtitle, ...(slide.bullets || [])]).map(cleanText).filter(Boolean).slice(0, 4)
    });
  }
  return [title, ...keep].slice(0, 6);
}

function qualitySlides(input) {
  const normalized = slidesFromInput(input).map((slide, index) => normalizeSlide(slide, index === 0 ? input.title : ""));
  const repaired = mergeWeakSlides(normalized, input);
  return compactDefaultPresentation(repaired, input);
}

function objectBounds(obj) {
  const data = obj?.data || obj?.options || {};
  const x = Number(data.x);
  const y = Number(data.y);
  const w = Number(data.w);
  const h = Number(data.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function inspectPptxLayout(pptx) {
  const issues = [];
  const width = 13.333;
  const height = 7.5;
  for (const [slideIndex, slide] of (pptx?._slides || []).entries()) {
    for (const [objectIndex, obj] of (slide?._slideObjects || []).entries()) {
      const box = objectBounds(obj);
      if (!box) continue;
      if (box.w <= 0 || box.h <= 0) {
        issues.push(`Slide ${slideIndex + 1} object ${objectIndex + 1} has invalid size.`);
      }
      if (box.x < -0.05 || box.y < -0.05 || box.x + box.w > width + 0.08 || box.y + box.h > height + 0.08) {
        issues.push(`Slide ${slideIndex + 1} object ${objectIndex + 1} is outside the slide bounds.`);
      }
    }
  }
  return issues;
}

function addTextBox(slide, text, options) {
  slide.addText(text, {
    margin: 0,
    breakLine: false,
    fit: "shrink",
    ...options
  });
}

function addFooter(slide, theme, input) {
  const source = cleanText(input.source || input.sources || input.data?.source || input.data?.sources || "");
  if (source) {
    slide.addText(`Sources: ${source}`.slice(0, 180), { x: 0.58, y: 6.78, w: 8.8, h: 0.16, fontSize: 6.5, color: theme.muted, margin: 0 });
  }
}

function addKpiCard(pptx, slide, theme, x, y, w, value, label, accent = theme.accent) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: 0.95,
    rectRadius: 0.08,
    fill: { color: "FFFFFF", transparency: 6 },
    line: { color: theme.border, width: 0.8 }
  });
  addTextBox(slide, value, { x: x + 0.18, y: y + 0.16, w: w - 0.36, h: 0.32, fontSize: 20, bold: true, color: accent, fontFace: theme.headingFont });
  addTextBox(slide, label, { x: x + 0.18, y: y + 0.55, w: w - 0.36, h: 0.22, fontSize: 8.5, color: theme.body });
}

function addBulletCards(pptx, slide, theme, items, yStart = 1.45) {
  const visible = items.slice(0, 4);
  const cols = visible.length <= 2 ? visible.length : 2;
  const cardW = cols === 1 ? 11.6 : 5.65;
  visible.forEach((item, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = 0.72 + col * 5.95;
    const y = yStart + row * 1.55;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: 1.25,
      rectRadius: 0.08,
      fill: { color: theme.panel, transparency: 8 },
      line: { color: theme.border, width: 0.7 }
    });
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.08, h: 1.25, fill: { color: theme.accent }, line: { color: theme.accent } });
    addTextBox(slide, item, { x: x + 0.25, y: y + 0.24, w: cardW - 0.45, h: 0.7, fontSize: 13.5, color: theme.body });
  });
}

function addTwoColumnBullets(slide, theme, items, yStart = 1.45) {
  const left = items.slice(0, Math.ceil(items.length / 2));
  const right = items.slice(Math.ceil(items.length / 2));
  [left, right].forEach((group, index) => {
    if (!group.length) return;
    slide.addText(group.map((text) => ({ text, options: { bullet: { type: "ul" } } })), {
      x: index === 0 ? 0.92 : 6.85,
      y: yStart,
      w: 5.15,
      h: 4.55,
      fontSize: group.length > 4 ? 12.5 : 14,
      color: theme.body,
      breakLine: false,
      fit: "shrink",
      margin: 0.02,
      paraSpaceAfterPt: 8
    });
  });
}

function createPptx(input, outputPath) {
  const theme = resolveTheme(input);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Klui";
  pptx.subject = input.instructions || "";
  pptx.title = input.title || "Presentation";
  pptx.theme = {
    headFontFace: theme.headingFont,
    bodyFontFace: theme.font
  };
  pptx.defineSlideMaster({
    title: "KLUI",
    background: { color: theme.bg },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.08, fill: { color: theme.accent }, line: { color: theme.accent } } },
      { line: { x: 0.55, y: 6.95, w: 12.2, h: 0, line: { color: theme.border, width: 0.7 } } },
      { text: { text: "Klui", options: { x: 0.62, y: 7.03, w: 1.2, h: 0.22, fontSize: 7.5, color: theme.muted, margin: 0 } } }
    ],
    slideNumber: { x: 12.2, y: 7.03, color: theme.muted, fontSize: 7.5 }
  });
  const slides = qualitySlides(input);
  const kpis = extractKpis(input, slides);
  slides.forEach((slideData, index) => {
    const slide = pptx.addSlide("KLUI");
    if (index === 0) {
      const kicker = input.kicker || input.data?.kicker || (theme.name === "academic" ? "Study summary" : theme.name === "business" ? "Executive summary" : "Overview");
      addTextBox(slide, kicker, { x: 0.75, y: 0.82, w: 4.7, h: 0.24, fontSize: 11, bold: true, color: theme.accent });
      addTextBox(slide, slideData.title || input.title || "Presentation", {
        x: 0.75, y: 1.42, w: kpis.length ? 7.2 : 11.3, h: 1.25, fontFace: theme.headingFont, fontSize: 34, bold: true, color: theme.body
      });
      const subtitle = slideData.subtitle || firstUsefulSentence(input.instructions || artifactContent(input), 155);
      if (subtitle) addTextBox(slide, subtitle, { x: 0.78, y: 2.88, w: kpis.length ? 6.8 : 10.4, h: 0.55, fontSize: 14.5, color: theme.muted });
      const chips = [input.data?.chip, input.data?.metric_label, input.data?.unit].filter(Boolean).map(cleanText);
      if (!chips.length && /price|cost|comparison|pricing/i.test(`${input.title} ${input.instructions}`)) chips.push("comparison", "cost view");
      chips.slice(0, 2).forEach((chip, chipIndex) => {
        slide.addShape(pptx.ShapeType.roundRect, {
          x: 0.78 + chipIndex * 1.9, y: 3.92, w: 1.65, h: 0.34, rectRadius: 0.06,
          fill: { color: chipIndex ? theme.accent : theme.body },
          line: { color: chipIndex ? theme.accent : theme.body }
        });
        addTextBox(slide, chip, { x: 0.9 + chipIndex * 1.9, y: 4.02, w: 1.4, h: 0.11, fontSize: 6.6, bold: true, color: "FFFFFF", align: "center" });
      });
      if (kpis.length) {
        kpis.forEach((item, kpiIndex) => addKpiCard(pptx, slide, theme, 9.15, 1.25 + kpiIndex * 1.28, 2.35, item.value, item.label, kpiIndex === 1 ? "C2410C" : theme.accent));
      }
      const recommendation = slideData.bullets.find((item) => /recommend|bottom line|winner|use /i.test(item)) || input.data?.recommendation;
      if (recommendation) addTextBox(slide, recommendation, { x: 0.78, y: 5.24, w: 7.5, h: 0.48, fontSize: 14, bold: true, color: theme.body });
      addFooter(slide, theme, input);
    } else {
      addTextBox(slide, slideData.title || "Slide", {
        x: 0.65, y: 0.45, w: 11.9, h: 0.45, fontFace: theme.headingFont, fontSize: 23, bold: true, color: theme.body
      });
      if (slideData.subtitle) {
        addTextBox(slide, slideData.subtitle, { x: 0.68, y: 1.04, w: 11.5, h: 0.38, fontSize: 11.8, color: theme.muted });
      }
      if (slideData.table) {
        const rows = tableRows(slideData.table, 12);
        if (rows.length) {
          slide.addTable(rows, {
            x: 0.72, y: slideData.subtitle ? 1.65 : 1.35, w: 11.8, h: 4.8,
            border: { type: "solid", color: theme.border, pt: 0.6 },
            fill: theme.bg,
            color: theme.body,
            fontSize: rows[0].length > 5 ? 8.5 : 10,
            valign: "mid",
            margin: 0.08,
            autoFit: true,
            autoPage: false
          });
        }
      } else {
        const items = slideData.bullets.length ? slideData.bullets : ["Key point"];
        if (items.length <= 4) addBulletCards(pptx, slide, theme, items, slideData.subtitle ? 1.7 : 1.35);
        else addTwoColumnBullets(slide, theme, items, slideData.subtitle ? 1.7 : 1.35);
      }
      addFooter(slide, theme, input);
    }
    if (slideData.notes) slide.addNotes(slideData.notes);
  });
  const layoutIssues = inspectPptxLayout(pptx);
  if (layoutIssues.length) {
    process.stderr.write(`pptx_quality_warnings: ${layoutIssues.slice(0, 8).join(" ")}\n`);
  }
  return pptx.writeFile({ fileName: outputPath });
}

async function main() {
  const [inputPath, outputDir] = process.argv.slice(2);
  if (!inputPath || !outputDir) throw new Error("Usage: node artifact_generator.mjs <input.json> <output-dir>");
  const input = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const format = String(input.format || "").toLowerCase();
  if (!["docx", "xlsx", "pptx"].includes(format)) throw new Error(`Unsupported format: ${format}`);
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${safeName(input.title || "Generated document")}.${format}`);
  if (format === "docx") await createDocx(input, outputPath);
  if (format === "xlsx") await createXlsx(input, outputPath);
  if (format === "pptx") await createPptx(input, outputPath);
  process.stdout.write(JSON.stringify({ path: outputPath, content_type: MIME[format] }));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
