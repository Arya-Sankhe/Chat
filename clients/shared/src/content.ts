import type { MessageContent, Usage } from "./types";

export function textFromMessageContent(content: MessageContent | undefined): string {
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return String(part.text ?? "");
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Normalizes OpenRouter/DeepSeek reasoning delta shapes. */
export function extractReasoningDelta(delta: Record<string, unknown> = {}): string {
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === "string" && delta.reasoning) return delta.reasoning;
  if (Array.isArray(delta.reasoning_details)) {
    let text = "";
    for (const detail of delta.reasoning_details as Array<Record<string, unknown> | null>) {
      if (!detail || typeof detail !== "object") continue;
      if (detail.type === "reasoning.text" && typeof detail.text === "string") text += detail.text;
      else if (detail.type === "reasoning.summary" && typeof detail.summary === "string") text += detail.summary;
    }
    return text;
  }
  return "";
}

export function normalizeUsage(usage: unknown): Usage | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, any>;
  const num = (value: unknown) => {
    const n = Number(value);
    return value != null && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const prompt = num(u.promptTokens ?? u.prompt_tokens);
  const completion = num(u.completionTokens ?? u.completion_tokens);
  const reasoning = num(u.reasoningTokens ?? u.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens);
  let total = num(u.totalTokens ?? u.total_tokens);
  if (total == null && (prompt != null || completion != null)) total = (prompt ?? 0) + (completion ?? 0);
  const result: Usage = {};
  if (prompt != null) result.promptTokens = prompt;
  if (completion != null) result.completionTokens = completion;
  if (reasoning != null) result.reasoningTokens = reasoning;
  if (total != null) result.totalTokens = total;
  return Object.keys(result).length ? result : null;
}

export function isFinalFinishReason(reason: string | null | undefined): boolean {
  return Boolean(reason && reason !== "tool_calls");
}

// Keep in sync with stripLeakedToolMarkup in public/js/app.js and server/saas/messages.js.
export function stripLeakedToolMarkup(value: string): string {
  const text = String(value ?? "");
  const dsmlTag = /<[^>]*\bDSML\b/i;
  if (!dsmlTag.test(text)) return text;
  return text
    .replace(/<\s*\|\s*\|?\s*DSML\s*\|[\s\S]*?<\s*\/\s*\|\s*\|?\s*DSML\s*\|\s*\|?\s*tool_calls\s*>/gi, "")
    .split(/\r?\n/)
    .filter((line) => !dsmlTag.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const OPENROUTER_NITRO_MODEL = "inclusionai/ling-3.0-flash";

// Keep in sync with stripLeakedReasoningMarkup in public/js/app.js and server/saas/messages/content.js.
export function stripLeakedReasoningMarkup(value: string, model: string): string {
  const text = String(value ?? "");
  if (model !== OPENROUTER_NITRO_MODEL) return text;
  let inCodeFence = false;
  let leakedTagEnd = -1;
  for (const match of text.matchAll(/```|~~~|<\/think\s*>/gi)) {
    if (match[0] === "```" || match[0] === "~~~") inCodeFence = !inCodeFence;
    else if (!inCodeFence) leakedTagEnd = (match.index ?? 0) + match[0].length;
  }
  return leakedTagEnd < 0 ? text : text.slice(leakedTagEnd).trimStart();
}
