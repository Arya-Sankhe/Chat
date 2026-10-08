import { contentText, filterCouncilHistory } from "../saas/messages.js";

const DEFAULT_MAX_CHARS = 24_000;
const DEFAULT_MAX_MESSAGE_CHARS = 6_000;
const DEFAULT_MAX_MESSAGES = 16;

const CLIP_MARKER = "\n[…]\n";
// Below this, a clipped turn is just noise; older turns are dropped instead.
const MIN_TURN_CHARS = 200;

function clip(text, maxChars) {
  if (text.length <= maxChars) return text;
  const room = Math.max(0, maxChars - CLIP_MARKER.length);
  const head = Math.ceil(room * 0.7);
  const tail = room - head;
  return `${text.slice(0, head)}${CLIP_MARKER}${tail ? text.slice(-tail) : ""}`;
}

function messageText(message) {
  const research = message?.role === "assistant" ? message?.metadata?.research : null;
  const text = contentText(message?.content).trim();
  if (research?.runId) {
    const title = String(research.title || "").trim();
    return [title ? `[Earlier deep research report: ${title}]` : "[Earlier deep research report]", text].filter(Boolean).join("\n");
  }
  return text;
}

/**
 * The conversation leading up to a Deep Research request, newest turns kept first,
 * as a plain transcript. Only turns before `userMessageId` count, so the research
 * question itself (and anything after it) never leaks back in as "context"; an
 * unknown id yields no context at all. Without an id, every turn is prior.
 */
export function researchConversationContext(messages, {
  userMessageId = "",
  maxChars = DEFAULT_MAX_CHARS,
  maxMessageChars = DEFAULT_MAX_MESSAGE_CHARS,
  maxMessages = DEFAULT_MAX_MESSAGES
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const cutoff = userMessageId ? list.findIndex((message) => String(message?.id) === String(userMessageId)) : list.length;
  // A boundary that no longer exists (request deleted) must not widen to the whole chat.
  if (cutoff < 0) return "";
  const prior = filterCouncilHistory(list.slice(0, cutoff));

  const turns = [];
  let remaining = maxChars;
  for (let index = prior.length - 1; index >= 0 && remaining > 0 && turns.length < maxMessages; index -= 1) {
    const message = prior[index];
    if (!["user", "assistant"].includes(message?.role) || message.error) continue;
    const text = messageText(message);
    if (!text) continue;
    const prefix = message.role === "user" ? "User: " : "Assistant: ";
    // Prefix and the blank line between turns count toward the budget too.
    const room = Math.min(maxMessageChars, remaining - prefix.length - 2);
    if (room < Math.min(MIN_TURN_CHARS, text.length)) break;
    const turn = `${prefix}${clip(text, room)}`;
    turns.push(turn);
    remaining -= turn.length + 2;
  }
  return turns.reverse().join("\n\n");
}
