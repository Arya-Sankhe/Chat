// Short glimpses of the model's reasoning for the live status feed under the Klui bar. Full
// reasoning stays admin-only; everyone gets at most one cleaned-up sentence every few seconds.
import { extractReasoningDelta } from "../saas/reasoning.js";

const GAP_MS = 2500;
const MAX_CHARS = 110;
const SKIP = /system prompt|developer|guideline|policy|instruction|tool call|json|```/i;
// Doubts, limits and self-corrections read as Klui being unsure, so they never reach the feed.
const NEGATIVE = /\b(?:tools?|toolset|web search|search tool|brows\w*|internet|live data|real-time|can't|cannot|can not|couldn't|don't|do not|doesn't|does not|didn't|won't|isn't|aren't|not|no|never|neither|nor|unable|unavailable|lack\w*|without|honest\w*|careful|guess\w*|hallucinat\w*|mistake\w*|wrong|confus\w*|limit\w*|unsure|uncertain|maybe|probably|recall|actually|hmm|wait|oops|sorry|apolog\w*)\b|\?/i;

function clean(sentence) {
  return sentence
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text) {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60))}…`;
}

// The newest finished sentence in the buffer; the one still being written is skipped.
export function latestThought(buffer) {
  const parts = String(buffer || "").split(/(?<=[.!?])\s+|\n+/);
  parts.pop();
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const text = clean(parts[i]);
    if (text.length >= 24 && /[a-z]/i.test(text) && !SKIP.test(text) && !NEGATIVE.test(text)) return clip(text);
  }
  return "";
}

export function createThoughtTicker(send, { now = Date.now } = {}) {
  let buffer = "";
  let sentAt = -Infinity;
  let last = "";
  return (event) => {
    const text = extractReasoningDelta(event?.choices?.[0]?.delta || {});
    if (!text) return;
    buffer = (buffer + text).slice(-1500);
    if (now() - sentAt < GAP_MS) return;
    const thought = latestThought(buffer);
    if (!thought || thought === last) return;
    sentAt = now();
    last = thought;
    send({ type: "status:thought", text: thought });
  };
}
