// Short glimpses of the model's reasoning for the live status feed under the Klui bar. Full
// reasoning stays admin-only; everyone gets at most one cleaned-up sentence every few seconds.
import { extractReasoningDelta } from "../saas/reasoning.js";

const GAP_MS = 2500;
const MAX_CHARS = 110;
const SKIP = /system prompt|developer|guideline|policy|instruction|tool call|json|```/i;

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
    if (text.length >= 24 && /[a-z]/i.test(text) && !SKIP.test(text)) return clip(text);
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
