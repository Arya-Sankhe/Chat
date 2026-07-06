/**
 * Detect provider errors that indicate tools/tool_choice are unsupported,
 * plus progressive fallback stripping of tool-related request fields.
 */

export function isToolsUnsupportedError(error) {
  if (!error) return false;
  const parts = [error.message];
  const details = error.details ?? error.payload ?? error.body;
  if (details) parts.push(typeof details === "string" ? details : safeJson(details));
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;

  if (text.includes("tool_choice")
    && (text.includes("no endpoints found") || text.includes("not support") || text.includes("unsupported") || text.includes("invalid"))) {
    return true;
  }
  if (text.includes("no endpoints found") && text.includes("tool")) return true;
  if (/\btools?\b[^.]*\b(not supported|unsupported|isn'?t supported|are not supported|is not supported)\b/.test(text)) return true;
  if (/\b(does not support|doesn'?t support|do not support|don'?t support|cannot use|can'?t use)\b[^.]*\btools?\b/.test(text)) return true;
  if (/\bfunction calling\b[^.]*\b(not supported|unsupported|not available)\b/.test(text)) return true;
  return false;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Progressively strip tool-related fields from a chat request body so a
 * provider that can't honor them still produces an answer.
 *   level 0 → request unchanged
 *   level 1 → drop `tool_choice` (provider rejects the value, may still tool-call)
 *   level 2 → drop `tools` too (provider can't tool-call at all)
 */
export function applyToolFallback(body, level) {
  if (!body || level <= 0) return body;
  const next = { ...body };
  delete next.tool_choice;
  if (level >= 2) delete next.tools;
  return next;
}
