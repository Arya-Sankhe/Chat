/**
 * Normalize reasoning/thinking tokens from provider stream deltas.
 *
 * Klui / DeepSeek-style APIs use `delta.reasoning_content`.
 * OpenRouter exposes `delta.reasoning` and/or `delta.reasoning_details`
 * (see https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
 */
export function extractReasoningDelta(delta = {}) {
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
    return delta.reasoning_content;
  }

  if (typeof delta.reasoning === "string" && delta.reasoning) {
    return delta.reasoning;
  }

  if (Array.isArray(delta.reasoning_details)) {
    let text = "";
    for (const detail of delta.reasoning_details) {
      if (!detail || typeof detail !== "object") continue;
      if (detail.type === "reasoning.text" && typeof detail.text === "string" && detail.text) {
        text += detail.text;
        continue;
      }
      if (detail.type === "reasoning.summary" && typeof detail.summary === "string" && detail.summary) {
        text += detail.summary;
      }
    }
    return text;
  }

  return "";
}
