/* Full-text document library.

   Documents go into the model's context in full while they fit the turn's
   token budget (what the context window has left after the conversation).
   Only what doesn't fit falls back to retrieval. The assembled text of each
   document is cached in-process, since a document's text never changes
   after processing and chats re-read it every turn. */

import { chunkPageNumber, pageLooksVisual } from "./retrieval.js";

const CHARS_PER_TOKEN = 4;
const CHUNK_PAGE_SIZE = 1000;
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_CHARS = 40_000_000;

const textCache = new Map();
let cachedChars = 0;

function cacheKey(doc) {
  return `${doc.id}:${doc.text_ready_at || ""}:${doc.updated_at || ""}`;
}

function cacheGet(key) {
  const entry = textCache.get(key);
  if (!entry) return null;
  textCache.delete(key);
  textCache.set(key, entry);
  return entry;
}

function cacheSet(key, entry) {
  if (textCache.has(key)) {
    cachedChars -= textCache.get(key).text.length;
    textCache.delete(key);
  }
  textCache.set(key, entry);
  cachedChars += entry.text.length;
  while (textCache.size > CACHE_MAX_ENTRIES || cachedChars > CACHE_MAX_CHARS) {
    const [oldest, value] = textCache.entries().next().value;
    textCache.delete(oldest);
    cachedChars -= value.text.length;
  }
}

export function clearDocumentTextCache() {
  textCache.clear();
  cachedChars = 0;
}

export function estimateTextTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

/** Size guess from processing stats, used before any text is loaded. */
export function estimateDocumentTokens(doc) {
  const words = Number(doc?.word_count || 0);
  const pages = Number(doc?.page_count || 0);
  if (words > 0) return Math.ceil(words * 1.4) + pages * 8;
  const cells = Number(doc?.used_cell_count || 0);
  if (cells > 0) return cells * 4;
  if (pages > 0) return pages * 700;
  return 4000;
}

/** Pages worth showing as images: flagged visual at ingest, text-poor, tables, slides. */
function visualPageNumbers(doc, chunks) {
  const pages = new Map();
  for (const chunk of chunks) {
    const number = chunkPageNumber(chunk);
    if (!number) continue;
    const entry = pages.get(number) || { chars: 0, table: false, flagged: false };
    entry.chars += String(chunk.text || "").length;
    entry.table ||= chunk.source_type === "table" || chunk.source_type === "chart";
    entry.flagged ||= Boolean(chunk.metadata?.has_visual || chunk.metadata?.visual_only);
    pages.set(number, entry);
  }
  const numbers = [];
  for (const [number, entry] of pages) {
    if (entry.flagged || pageLooksVisual({ char_count: entry.chars }, { documentKind: doc?.kind, hasTableChunk: entry.table })) {
      numbers.push(number);
    }
  }
  return numbers.sort((a, b) => a - b);
}

function assembleText(chunks) {
  return chunks
    .map((chunk) => {
      const text = String(chunk.text || "").trim();
      if (!text) return "";
      const label = String(chunk.source_label || "").trim();
      return label ? `[${label}]\n${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Full text of each document, in chunk order, plus which pages are visual.
 * Returns Map(docId -> { text, tokens, visualPages }).
 */
export async function loadDocumentTexts({ db, userId, docs, signal }) {
  const result = new Map();
  const missing = [];
  for (const doc of docs) {
    const cached = cacheGet(cacheKey(doc));
    if (cached) result.set(doc.id, cached);
    else missing.push(doc);
  }
  if (!missing.length) return result;

  const chunksByDoc = new Map(missing.map((doc) => [doc.id, []]));
  let offset = 0;
  // PostgREST caps rows per request, so page through the chunk list.
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
    const chunks = chunksByDoc.get(doc.id).sort((a, b) => Number(a.chunk_index || 0) - Number(b.chunk_index || 0));
    const text = assembleText(chunks);
    const entry = { text, tokens: estimateTextTokens(text), visualPages: visualPageNumbers(doc, chunks) };
    cacheSet(cacheKey(doc), entry);
    result.set(doc.id, entry);
  }
  return result;
}
