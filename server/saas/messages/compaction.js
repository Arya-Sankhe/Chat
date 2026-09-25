/* Conversation compaction.

   When a conversation's history nears the compaction threshold, the older
   turns are replaced by one structured summary and the recent turns stay
   verbatim. The summary is stored with the id of the last message it covers,
   so later turns reuse it (no re-summarizing every turn, and a stable prompt
   prefix that providers can cache). When the history grows past the
   threshold again, the stored summary is extended with only the new segment. */

import { createHash } from "node:crypto";

export const COMPACTION_VERSION = 1;
export const CONTEXT_CHARS_PER_TOKEN = 4;
const CONTEXT_MESSAGE_OVERHEAD_TOKENS = 8;
const CONTEXT_IMAGE_TOKENS = 1200;

export const SUMMARY_HEADING = "Conversation summary of earlier turns";

export const COMPACTION_SYSTEM_PROMPT = [
  "You are compacting a long conversation so it can continue in a fresh context window. The older messages will be replaced by your summary, so the assistant must be able to continue seamlessly from it alone.",
  "If a <previous_summary> is given, merge it with the new messages into one updated summary. Keep everything from it that still matters; drop what was superseded.",
  "Use these sections, omitting any that would be empty:",
  "1. User goals and requests: every distinct request, with the exact wording of important asks.",
  "2. Key facts and decisions: names, numbers, dates, definitions, conclusions and agreements reached.",
  "3. Documents, files and images: what the user shared and what was learned from each (with page or section references).",
  "4. What the assistant produced: answers, explanations, code, plans and files, with their essential content and identifiers.",
  "5. User preferences and constraints: tone, format, language, level of detail, things to avoid.",
  "6. Open threads: unanswered questions, pending tasks and promised follow-ups.",
  "7. Current focus: what the most recent exchanges were about.",
  "Preserve exact identifiers (file names, code symbols, URLs, numbers, formulas). Do not invent facts, do not answer any request, and write in the language of the conversation. Return only the summary."
].join("\n");

function estimateContentTokens(content) {
  if (typeof content === "string") {
    return Math.ceil(content.length / CONTEXT_CHARS_PER_TOKEN);
  }
  if (!Array.isArray(content)) return 0;

  let total = 0;
  for (const part of content) {
    if (typeof part === "string") {
      total += Math.ceil(part.length / CONTEXT_CHARS_PER_TOKEN);
    } else if (part?.type === "text") {
      total += Math.ceil(String(part.text || "").length / CONTEXT_CHARS_PER_TOKEN);
    } else if (part?.type === "image_url") {
      total += CONTEXT_IMAGE_TOKENS;
    } else if (part?.type === "file") {
      total += 64;
    }
  }
  return total;
}

export { estimateContentTokens };

export function estimateContextTokens(messages = []) {
  return (messages || []).reduce((total, message) => {
    const toolCalls = Array.isArray(message?.tool_calls)
      ? Math.ceil(JSON.stringify(message.tool_calls).length / CONTEXT_CHARS_PER_TOKEN)
      : 0;
    return total + CONTEXT_MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(message?.content) + toolCalls;
  }, 0);
}

export function groupConversationTurns(messages = []) {
  const turns = [];
  let current = [];
  for (const message of messages) {
    if (message?.role === "user" && current.length) {
      turns.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) turns.push(current);
  return turns;
}

/** Split into older turns and the newest turns that fit `tokenBudget` (always at least one turn). */
export function partitionRecentTurns(messages, tokenBudget) {
  const turns = groupConversationTurns(messages);
  const recent = [];
  let tokens = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnTokens = estimateContextTokens(turn);
    if (recent.length && tokens + turnTokens > tokenBudget) break;
    recent.unshift(...turn);
    tokens += turnTokens;
  }

  return {
    older: messages.slice(0, Math.max(0, messages.length - recent.length)),
    recent
  };
}

function summaryTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return String(part.text || "");
    if (part?.type === "image_url") {
      const image = part.image_url || {};
      const name = image.file_name || "image";
      const description = String(image.description || image.alt_text || "").trim();
      return description ? `[Image (${name}): ${description}]` : `[Image (${name}) omitted]`;
    }
    if (part?.type === "file") return `[Document (${part.file?.file_name || "file"})]`;
    return "";
  }).filter(Boolean).join("\n");
}

/**
 * Transcript handed to the summarizer. Keeps the newest text when the
 * segment is larger than `maxTokens`, and prefixes the previous summary so
 * the model extends it instead of starting over.
 */
export function buildSummaryTranscript(messages, maxTokens, { previousSummary = "" } = {}) {
  const maxChars = Math.max(1000, maxTokens * CONTEXT_CHARS_PER_TOKEN);
  const rows = messages.map((message) => {
    const text = summaryTextFromContent(message?.content).trim();
    return text ? `${String(message.role || "message").toUpperCase()}:\n${text}` : "";
  }).filter(Boolean);

  const selected = [];
  let used = 0;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    selected.unshift(row.length <= remaining ? row : row.slice(row.length - remaining));
    used += Math.min(row.length, remaining);
  }
  const transcript = selected.join("\n\n");
  const previous = String(previousSummary || "").trim();
  if (!previous) return transcript;
  return `<previous_summary>\n${previous}\n</previous_summary>\n\n<new_messages>\n${transcript}\n</new_messages>`;
}

/** Identity of the history a summary covers: message ids and roles, in order. */
export function conversationFingerprint(messages = []) {
  const hash = createHash("sha256");
  for (const message of messages) {
    hash.update(`${message?.id || "-"}:${message?.role || ""}\n`);
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * Apply a stored summary when it still describes this history: its last
 * covered message is present and every message up to it is unchanged.
 * Edits, deletions and regenerated branches invalidate it automatically.
 */
export function applyStoredCompaction(messages = [], stored = null) {
  const summary = String(stored?.summary || "").trim();
  const throughId = stored?.through_message_id;
  if (!summary || !throughId || Number(stored?.version || COMPACTION_VERSION) !== COMPACTION_VERSION) return null;
  const index = messages.findIndex((message) => message?.id === throughId);
  if (index < 0 || index >= messages.length - 1) return null;
  if (conversationFingerprint(messages.slice(0, index + 1)) !== stored.fingerprint) return null;
  return { summary, messages: messages.slice(index + 1) };
}

/**
 * Decide the history for this turn: stored summary + messages after it, and
 * compact further when that still reaches `compactAtTokens`.
 * Returns `{ summary, messages, compacted }`.
 */
export async function compactConversationHistory({
  messages,
  systemPrompt = "",
  contextConfig,
  summarizeHistory = null,
  store = null
}) {
  let stored = null;
  if (store?.load) {
    try {
      stored = await store.load();
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }
  }
  const applied = applyStoredCompaction(messages, stored);
  let summary = applied?.summary || "";
  let remaining = applied?.messages || messages;

  const systemTokens = systemPrompt ? estimateContextTokens([{ role: "system", content: systemPrompt }]) : 0;
  const summaryTokens = () => (summary ? estimateContextTokens([{ role: "system", content: summary }]) : 0);
  const total = systemTokens + summaryTokens() + estimateContextTokens(remaining);
  if (!contextConfig || total < contextConfig.compactAtTokens || !summarizeHistory) {
    return { summary, messages: remaining, compacted: false };
  }

  const partition = partitionRecentTurns(remaining, contextConfig.keepRecentTokens);
  if (!partition.older.length) return { summary, messages: remaining, compacted: false };

  const transcript = buildSummaryTranscript(partition.older, contextConfig.compactAtTokens, { previousSummary: summary });
  if (!transcript) return { summary, messages: remaining, compacted: false };

  let next = "";
  try {
    next = String(await summarizeHistory(transcript) || "").trim();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
  }
  if (!next) return { summary, messages: remaining, compacted: false };

  summary = next;
  remaining = partition.recent;
  const coveredCount = messages.length - remaining.length;
  const boundary = messages[coveredCount - 1];
  if (store?.save && boundary?.id) {
    try {
      await store.save({
        version: COMPACTION_VERSION,
        summary,
        through_message_id: boundary.id,
        fingerprint: conversationFingerprint(messages.slice(0, coveredCount)),
        summarized_tokens: estimateContextTokens(partition.older),
        summary_model: contextConfig.summaryModel || null
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
    }
  }
  return { summary, messages: remaining, compacted: true };
}

/** Persists the rolling summary per conversation; missing storage just disables reuse. */
export function createCompactionStore({ db, userId, conversationId, signal }) {
  if (!db || !conversationId || typeof db.getConversationContext !== "function") return null;
  let loaded = null;
  const quiet = (label) => (error) => {
    if (error?.name === "AbortError") throw error;
    console.warn(`Conversation summary ${label} failed: ${error?.message || error}`);
    return null;
  };
  return {
    load() {
      loaded ||= db.getConversationContext(userId, conversationId, { signal }).catch(quiet("load"));
      return loaded;
    },
    async save(record) {
      if (typeof db.saveConversationContext !== "function") return;
      await db.saveConversationContext(userId, conversationId, record, { signal }).catch(quiet("save"));
      loaded = Promise.resolve(record);
    }
  };
}
