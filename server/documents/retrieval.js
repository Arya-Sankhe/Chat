/* Hybrid document retrieval helpers.

   Retrieval runs three searches (stemmed keywords over text chunks, semantic
   vectors over text chunks, semantic vectors over page images), fuses their
   rankings, optionally re-ranks the text with a cross-encoder, and turns the
   winners into a small evidence set: the best excerpts as text plus images
   only for the pages whose content lives in the picture. */

import { chatCompletion } from "../model-api/client.js";
import { OPENROUTER_NITRO_MODEL } from "../providers.js";

export const RRF_K = 60;

function clean(value) {
  return String(value || "").trim();
}

/** Page number a chunk belongs to: PDF pages carry `page`, PPTX slides `slide`. */
export function chunkPageNumber(chunk) {
  const metadata = chunk?.metadata || {};
  const value = Number(metadata.page || metadata.slide || 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function pageKey(documentFileId, pageNumber) {
  return `${documentFileId}:${Number(pageNumber)}`;
}

/**
 * Reciprocal rank fusion. Each list is `{ items, key, weight }`; an item's
 * score is the weighted sum of 1 / (k + rank) over the lists it appears in.
 * Only an item's best rank per list counts, so many chunks from one page
 * don't swamp the ranking.
 */
export function reciprocalRankFusion(lists = [], { k = RRF_K } = {}) {
  const scores = new Map();
  for (const list of lists) {
    const weight = Number.isFinite(list?.weight) ? list.weight : 1;
    const seen = new Set();
    let rank = 0;
    for (const item of list?.items || []) {
      const key = list.key(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = scores.get(key) || { key, score: 0, item, ranks: {} };
      entry.score += weight / (k + rank + 1);
      if (list.name) entry.ranks[list.name] = rank;
      scores.set(key, entry);
      rank += 1;
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

const VISUAL_QUERY = /\b(diagram|figure|fig\.?|chart|graph|plot|image|picture|photo|illustration|drawing|table|schedule|timetable|calendar|layout|slide|map|equation|formula|matrix|tree|automat(?:on|a)|screenshot|visual|look like|shown|draw)\b/i;

export function queryWantsVisual(query) {
  return VISUAL_QUERY.test(clean(query));
}

/** Pages whose meaning lives in the picture: little text, tables, slides, charts. */
export function pageLooksVisual(page, { documentKind = "", hasTableChunk = false } = {}) {
  if (hasTableChunk) return true;
  if (documentKind === "pptx") return true;
  const chars = Number(page?.char_count ?? clean(page?.text).length);
  return chars < 700;
}

const TRIVIAL = /^(hi|hey|hello|yo|thanks|thank you|thx|ok|okay|cool|nice|great|lol|bye|good (morning|night|evening))[\s!.?]*$/i;

export function retrievalWorthwhile(query) {
  const text = clean(query);
  if (text.length < 3) return false;
  return !TRIVIAL.test(text);
}

const REFERENTIAL = /\b(it|its|this|that|these|those|they|them|their|he|she|the (first|second|third|last|other|same|previous|above)|one|ones|above|again|more|else|also|continue|elaborate|expand|why|how so|example)\b/i;

/** Follow-ups need the conversation to become a searchable query. */
export function queryNeedsRewrite(userText, history = []) {
  const text = clean(userText);
  if (!text || !history.some((message) => message?.role === "user")) return false;
  const words = text.split(/\s+/).length;
  return words <= 6 || (words <= 25 && REFERENTIAL.test(text));
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part?.type === "text" ? part.text : "")).filter(Boolean).join("\n");
  }
  return "";
}

/**
 * Turn the latest message into a standalone search query using the recent
 * conversation. Falls back to the raw text on any failure or timeout.
 */
export async function rewriteDocumentQuery({
  userText,
  history = [],
  config,
  completeChat = chatCompletion,
  timeoutMs = 3500
} = {}) {
  const raw = clean(userText).slice(0, 1000);
  if (!queryNeedsRewrite(raw, history)) return raw;
  const provider = config?.providers?.openrouter;
  if (!provider?.apiKey) return raw;

  const recent = history
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .slice(-4)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${messageText(message.content).replace(/\s+/g, " ").slice(0, 700)}`)
    .join("\n");
  try {
    const content = await completeChat({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      providerId: "openrouter",
      signal: AbortSignal.timeout(timeoutMs),
      body: {
        model: OPENROUTER_NITRO_MODEL,
        reasoning: { enabled: false },
        max_tokens: 60,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "Rewrite the user's latest message as one standalone search query for their course documents. Resolve pronouns and references using the conversation. Keep names, terms, numbers and codes. Output only the query, at most 20 words, no quotes."
          },
          {
            role: "user",
            content: `<conversation>\n${recent}\n</conversation>\n\nLatest message: ${raw}`
          }
        ]
      }
    });
    const rewritten = clean(typeof content === "string" ? content : messageText(content))
      .split("\n")[0]
      .replace(/^["'`]+|["'`]+$/g, "")
      .slice(0, 300);
    return rewritten.length >= 3 ? rewritten : raw;
  } catch {
    return raw;
  }
}
