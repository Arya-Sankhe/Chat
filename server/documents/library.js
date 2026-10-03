/* Documents as the model reads them.

   The worker stores every document completely as units, one document_chunks row each:
   a page or slide (PDF, Word and PowerPoint, all read through their PDF) or a block of
   whole spreadsheet rows. Pages whose meaning is in the picture are flagged `visual`, and
   every page also has a rendered image in document_pages.

   A unit list never changes after processing (a re-ingest bumps `updated_at`), so the
   assembled lists are cached in-process: chats re-read their documents every turn. */

import { HttpError } from "../http/responses.js";

const CHARS_PER_TOKEN = 4;
const CHUNK_PAGE_SIZE = 1000;
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_CHARS = 40_000_000;

export const PAGED_KINDS = new Set(["pdf", "docx", "pptx"]);
export const SHEET_KINDS = new Set(["xlsx", "csv", "tsv"]);

const unitCache = new Map();
let cachedChars = 0;

function clean(value) {
  return String(value || "").trim();
}

export function estimateTextTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

export function documentKind(doc) {
  return clean(doc?.kind).toLowerCase();
}

export function isSpreadsheet(doc) {
  return SHEET_KINDS.has(documentKind(doc));
}

export function isPaged(doc) {
  return PAGED_KINDS.has(documentKind(doc));
}

/** A document is ready once the worker has stored all of it (one job sets both stamps). */
export function documentReady(doc) {
  return Boolean(doc?.text_ready_at || doc?.visual_ready_at);
}

/** Refuse reads that crossed a re-ingest, including cached text with newer page rows. */
export function assertDocumentVersions(expected, current) {
  const byId = new Map(current.map((doc) => [doc.id, doc]));
  for (const doc of expected) {
    const fresh = byId.get(doc.id);
    if (!documentReady(fresh)
      || (fresh.text_ready_at || null) !== (doc.text_ready_at || null)
      || (fresh.visual_ready_at || null) !== (doc.visual_ready_at || null)) {
      throw new HttpError(409, "Document content changed or is being processed. Try again once processing finishes.");
    }
  }
}

export function documentName(doc) {
  const attachment = Array.isArray(doc?.attachments) ? doc.attachments[0] : doc?.attachments;
  return attachment?.file_name || doc?.file_name || doc?.metadata?.title || doc?.metadata?.file_name || "Document";
}

function cacheKey(doc) {
  return `${doc.id}:${doc.text_ready_at || ""}:${doc.updated_at || ""}`;
}

function entrySize(entry) {
  return entry.chars;
}

function cacheGet(key) {
  const entry = unitCache.get(key);
  if (!entry) return null;
  unitCache.delete(key);
  unitCache.set(key, entry);
  return entry;
}

function cacheSet(key, entry) {
  if (unitCache.has(key)) {
    cachedChars -= entrySize(unitCache.get(key));
    unitCache.delete(key);
  }
  unitCache.set(key, entry);
  cachedChars += entrySize(entry);
  while (unitCache.size > CACHE_MAX_ENTRIES || cachedChars > CACHE_MAX_CHARS) {
    const [oldest, value] = unitCache.entries().next().value;
    unitCache.delete(oldest);
    cachedChars -= entrySize(value);
  }
}

export function clearDocumentTextCache() {
  unitCache.clear();
  cachedChars = 0;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

/** One stored chunk as a unit. Older documents (before single ingestion) map onto the same shape. */
export function unitFromChunk(chunk, position) {
  const metadata = chunk?.metadata || {};
  const text = String(chunk?.text || "");
  const rowNumbers = Array.isArray(metadata.row_numbers) ? metadata.row_numbers.map(Number) : null;
  const sheetRows = chunk?.source_type === "sheet_range" && metadata.extractor === "sheets-v1" && rowNumbers;
  return {
    position,
    chunkIndex: Number(chunk?.chunk_index ?? position - 1),
    page: positiveInt(metadata.page ?? metadata.page_number ?? metadata.slide),
    slide: positiveInt(metadata.slide),
    label: clean(chunk?.source_label) || `Part ${position}`,
    sourceType: clean(chunk?.source_type),
    text,
    tokens: estimateTextTokens(text),
    visual: Boolean(metadata.visual ?? metadata.has_visual),
    hidden: metadata.hidden === true,
    ocr: metadata.ocr === true,
    ocrFailed: metadata.ocr_failed === true,
    visualReason: clean(metadata.visual_reason),
    sheet: clean(metadata.sheet) || null,
    rowNumbers: sheetRows ? rowNumbers : null,
    rowStart: positiveInt(metadata.row_start),
    rowEnd: positiveInt(metadata.row_end)
  };
}

/** Pages a unit list covers; documents without page numbers count their parts instead. */
export function unitNumber(unit) {
  return unit.page || unit.position;
}

/**
 * Every unit of each document, in order. Returns Map(docId -> { units, tokens, visualPages }).
 * Reads page by page through PostgREST's row cap, so no document is ever cut short.
 */
export async function loadDocumentUnits({ db, userId, docs, signal }) {
  const result = new Map();
  const missing = [];
  for (const doc of docs || []) {
    if (!doc?.id) continue;
    const cached = cacheGet(cacheKey(doc));
    if (cached) result.set(doc.id, cached);
    else missing.push(doc);
  }
  if (!missing.length) return result;

  const chunksByDoc = new Map(missing.map((doc) => [doc.id, []]));
  let offset = 0;
  for (;;) {
    const rows = await db.listDocumentChunksForFiles(userId, missing.map((doc) => doc.id), {
      limit: CHUNK_PAGE_SIZE,
      offset,
      signal
    }) || [];
    for (const row of rows) chunksByDoc.get(row.document_file_id)?.push(row);
    if (rows.length < CHUNK_PAGE_SIZE) break;
    offset += rows.length;
  }

  for (const doc of missing) {
    const units = chunksByDoc.get(doc.id)
      .sort((a, b) => Number(a.chunk_index || 0) - Number(b.chunk_index || 0))
      .map((chunk, index) => unitFromChunk(chunk, index + 1));
    const chars = units.reduce((sum, unit) => sum + unit.text.length, 0);
    const entry = {
      units,
      chars,
      tokens: units.reduce((sum, unit) => sum + unit.tokens, 0),
      visualPages: units.filter((unit) => unit.visual && unit.page).map((unit) => unit.page)
    };
    cacheSet(cacheKey(doc), entry);
    result.set(doc.id, entry);
  }
  return result;
}

/** Size before anything is loaded: the worker records it; older documents are estimated. */
export function documentCostEstimate(doc) {
  const metadata = doc?.metadata || {};
  const textTokens = Number(metadata.text_tokens);
  const visualPages = Array.isArray(metadata.visual_pages) ? metadata.visual_pages.map(Number).filter(Number.isInteger) : [];
  if (Number.isFinite(textTokens) && textTokens >= 0) return { textTokens, visualPages };
  const words = Number(doc?.word_count || 0);
  const pages = Number(doc?.page_count || 0);
  if (words > 0) return { textTokens: Math.ceil(words * 1.4) + pages * 8, visualPages };
  const cells = Number(doc?.used_cell_count || 0);
  if (cells > 0) return { textTokens: cells * 4, visualPages };
  if (pages > 0) return { textTokens: pages * 700, visualPages };
  return { textTokens: 4000, visualPages };
}

/* ---- Text rendering ---- */

function columnLetter(index) {
  let letters = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/** Spreadsheet rows as `row | cells`, so every value can be addressed exactly. */
export function sheetRowLines(unit) {
  const lines = unit.text.split("\n");
  if (!unit.rowNumbers || unit.rowNumbers.length !== lines.length) return null;
  return lines.map((line, index) => ({ row: unit.rowNumbers[index], line }));
}

export function renderSheetUnits(units, { sheetSummaries = [] } = {}) {
  const parts = [];
  let sheet = null;
  for (const unit of units) {
    const rows = sheetRowLines(unit);
    if (!rows) {
      parts.push(`[${unit.label}]\n${unit.text}`);
      sheet = null;
      continue;
    }
    if (unit.sheet !== sheet) {
      sheet = unit.sheet;
      const summary = sheetSummaries.find((entry) => entry?.name === sheet);
      const columns = Number(summary?.columns || 0);
      const details = summary
        ? `${summary.rows} filled rows, columns A-${columnLetter(Math.max(1, columns))}${summary.header_row ? `, header in row ${summary.header_row}` : ""}`
        : "";
      parts.push(`Sheet "${sheet}"${details ? ` (${details})` : ""}. Each line is the row number, then the cells from column A, separated by tabs. A formula shows as =FORMULA => value.`);
    }
    parts.push(rows.map(({ row, line }) => `${row} | ${line}`).join("\n"));
  }
  return parts.join("\n");
}

/** Said before text read from a scan, which can confuse look-alike characters. */
export const OCR_NOTE = "(Scanned page: this text was read by OCR and can confuse look-alike characters such as 0/O, 1/I/l and 5/S. Take exact codes and numbers from the page image when you have it.)";

/** Said for a scanned page whose OCR failed: it has no searchable text at all. */
export const OCR_FAILED_NOTE = "(Scanned page: OCR could not read it, so search cannot find its words. Its content is only in the page image.)";

export function renderPageUnit(unit, { imageFollows = false } = {}) {
  const text = unit.text.trim();
  const body = text
    ? (unit.ocr ? `${OCR_NOTE}\n${text}` : text)
    : (unit.ocrFailed ? OCR_FAILED_NOTE : unit.visual ? "(No text layer on this page; its content is in the page image.)" : "(Blank page.)");
  return `--- ${unit.label} ---${imageFollows ? " (page image follows)" : ""}\n${body}`;
}

/** First words of each page, for navigating a document too long to include. */
export function pageIndexLines(units, { maxChars = 90 } = {}) {
  return units.map((unit) => {
    const first = unit.text.replace(/\s+/g, " ").trim().slice(0, maxChars);
    const flag = unit.visual ? " [figure/visual]" : "";
    return `${unit.label}${flag}: ${first || (unit.visual ? "(visual page)" : "(blank)")}`;
  });
}
