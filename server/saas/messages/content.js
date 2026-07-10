import { HttpError } from "../../http/responses.js";

function cleanString(value, label, { max = 100000, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return "";
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be a string.`);
  }

  if (value.length > max) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return value;
}

export function titleFromText(text) {
  const clean = String(text || "New chat").trim().replace(/\s+/g, " ");
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean || "New chat";
}

export function normalizeMessageSettings(input = {}) {
  const settings = input.settings || {};
  const normalized = {};

  for (const [key, value] of Object.entries({
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens,
    seed: settings.seed,
    stop: settings.stop,
    reasoning_effort: settings.reasoning_effort || settings.thinkingEffort
  })) {
    if (value !== undefined && value !== null && value !== "") normalized[key] = value;
  }

  const systemPrompt = cleanString(settings.systemPrompt, "systemPrompt", { max: 20000 });
  if (systemPrompt.trim()) normalized.systemPrompt = systemPrompt.trim();

  return normalized;
}

export function buildStoredUserContent(text, attachments = []) {
  const cleanText = cleanString(text, "message", { max: 100000 }).trim();

  if (!attachments.length) {
    if (!cleanText) throw new HttpError(400, "Message cannot be empty.");
    return cleanText;
  }

  return [
    ...(cleanText ? [{ type: "text", text: cleanText }] : []),
    ...attachments.map((attachment) => {
      if ((attachment.category || "image") === "document") {
        return {
          type: "file",
          file: {
            attachment_id: attachment.id,
            object_key: attachment.object_key,
            file_name: attachment.file_name,
            content_type: attachment.content_type,
            size_bytes: attachment.size_bytes,
            url: `r2://${attachment.object_key}`
          }
        };
      }
      return {
        type: "image_url",
        image_url: {
          attachment_id: attachment.id,
          object_key: attachment.object_key,
          file_name: attachment.file_name,
          url: `r2://${attachment.object_key}`
        }
      };
    })
  ];
}

export function normalizePastedTextRange(value, text) {
  if (!value || typeof value !== "object") return null;
  const source = String(text || "");
  const start = Number(value.start);
  const length = Number(value.length);
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1) return null;
  if (start + length > source.length || !source.slice(start, start + length).trim()) return null;
  return {
    start,
    length,
    lines: Math.max(1, source.slice(start, start + length).split("\n").length)
  };
}

export function imageCountFromContent(content) {
  if (!Array.isArray(content)) return 0;
  return content.filter((part) => part?.type === "image_url").length;
}

export function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join(" ");
}

async function hydrateContent(content, r2, mode, { imageDescriptions = null } = {}) {
  if (!Array.isArray(content)) return content || "";

  const hydrated = [];
  for (const part of content) {
    if (part?.type === "text") {
      hydrated.push({ type: "text", text: part.text || "" });
      continue;
    }

    if (part?.type === "image_url") {
      const image = part.image_url || {};
      const attachmentId = image.attachment_id;
      if (imageDescriptions) {
        const fileName = image.file_name || "image";
        const description = String(image.description || image.alt_text || (attachmentId ? imageDescriptions[attachmentId] : "") || "").trim();
        hydrated.push({
          type: "text",
          text: description
            ? `[Image (${fileName}): ${description}]`
            : `[Image (${fileName}): image content omitted for a text-only model]`
        });
        continue;
      }

      const objectKey = image.object_key || String(image.url || "").replace(/^r2:\/\//, "");
      const signedUrl = objectKey ? r2.readUrl(objectKey) : image.url;
      hydrated.push({
        type: "image_url",
        image_url: mode === "client"
          ? { ...image, url: signedUrl }
          : { url: signedUrl, detail: image.detail || "high" }
      });
    }

    if (part?.type === "file") {
      const file = part.file || {};
      const objectKey = file.object_key || String(file.url || "").replace(/^r2:\/\//, "");
      const signedUrl = objectKey ? r2.readUrl(objectKey) : file.url;
      if (mode === "client") {
        hydrated.push({
          type: "file",
          file: { ...file, url: signedUrl }
        });
      } else {
        hydrated.push({
          type: "text",
          text: `[Document (${file.file_name || "file"}): available through document tools; raw file content omitted from prompt]`
        });
      }
    }
  }

  return hydrated;
}

export async function hydrateMessagesForClient(messages, r2, { includeReasoning = false } = {}) {
  const result = [];
  for (const message of messages) {
    result.push({
      ...message,
      reasoning: includeReasoning ? message.reasoning : "",
      content: await hydrateContent(message.content, r2, "client")
    });
  }
  return result;
}

/**
 * Drop council Stage 1 panelist messages when their session produced a
 * SUCCESSFUL chairman synthesis — the chairman speaks for the panel in
 * follow-up turns so the next model doesn't see N parallel takes plus the
 * synthesis. If the chairman failed, fall back to keeping panelist context.
 */
export function filterCouncilHistory(messages) {
  const successfulChairmanSessions = new Set();
  for (const message of messages || []) {
    const council = message?.metadata?.council;
    if (council?.role !== "chairman" || !council?.sessionId) continue;
    if (String(message.content || "").trim()) {
      successfulChairmanSessions.add(council.sessionId);
    }
  }

  if (!successfulChairmanSessions.size) return messages || [];

  return (messages || []).filter((message) => {
    const council = message?.metadata?.council;
    if (council?.role !== "panelist") return true;
    return !successfulChairmanSessions.has(council.sessionId);
  });
}

const CONTEXT_CHARS_PER_TOKEN = 4;
const CONTEXT_MESSAGE_OVERHEAD_TOKENS = 8;
const CONTEXT_IMAGE_TOKENS = 1200;

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

export function estimateContextTokens(messages = []) {
  return (messages || []).reduce((total, message) => {
    const toolCalls = Array.isArray(message?.tool_calls)
      ? Math.ceil(JSON.stringify(message.tool_calls).length / CONTEXT_CHARS_PER_TOKEN)
      : 0;
    return total + CONTEXT_MESSAGE_OVERHEAD_TOKENS + estimateContentTokens(message?.content) + toolCalls;
  }, 0);
}

function groupConversationTurns(messages = []) {
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

function partitionRecentTurns(messages, tokenBudget) {
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

function buildSummaryTranscript(messages, maxTokens) {
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
  return selected.join("\n\n");
}

function truncateTextContent(content, maxChars) {
  const limit = Math.max(0, Math.floor(maxChars));
  const marker = "\n[Earlier content omitted to fit the context limit.]\n";
  if (typeof content === "string") {
    if (content.length <= limit) return content;
    if (limit <= marker.length) return marker.slice(0, limit);
    const available = limit - marker.length;
    const head = Math.ceil(available / 2);
    const tail = Math.floor(available / 2);
    return `${content.slice(0, head)}${marker}${tail ? content.slice(-tail) : ""}`;
  }
  return content;
}

function truncateContentToTokenBudget(content, tokenBudget) {
  const budget = Math.max(0, Math.floor(tokenBudget));
  if (typeof content === "string") {
    return truncateTextContent(content, budget * CONTEXT_CHARS_PER_TOKEN);
  }
  if (!Array.isArray(content)) return content;

  let remaining = budget;
  const keptNonText = new Set();
  for (const part of content) {
    if (part?.type === "text" || typeof part === "string") continue;
    const partTokens = estimateContentTokens([part]);
    if (partTokens <= remaining) {
      keptNonText.add(part);
      remaining -= partTokens;
    }
  }

  return content.flatMap((part) => {
    if (part?.type !== "text" && typeof part !== "string") {
      return keptNonText.has(part) ? [part] : [];
    }
    const text = typeof part === "string" ? part : String(part.text || "");
    if (!remaining || !text) return [];
    const next = truncateTextContent(text, remaining * CONTEXT_CHARS_PER_TOKEN);
    remaining = Math.max(0, remaining - estimateContentTokens(next));
    return typeof part === "string" ? [next] : [{ ...part, text: next }];
  });
}

export function trimProviderMessagesToBudget(messages, maxTokens) {
  const budget = Math.max(1, Math.floor(Number(maxTokens) || 1));
  if (estimateContextTokens(messages) <= budget) return messages;

  const systemMessages = messages.filter((message) => message?.role === "system");
  let turns = groupConversationTurns(messages.filter((message) => message?.role !== "system"));
  while (turns.length > 1 && estimateContextTokens([...systemMessages, ...turns.flat()]) > budget) {
    turns.shift();
  }

  let conversation = turns.flat();
  while (conversation.length > 1 && estimateContextTokens([...systemMessages, ...conversation]) > budget) {
    conversation.shift();
  }

  let result = [...systemMessages, ...conversation];
  if (estimateContextTokens(result) > budget && conversation.length) {
    const fixedTokens = estimateContextTokens([...systemMessages, { ...conversation[0], content: "" }]);
    const allowedTokens = Math.max(0, budget - fixedTokens);
    conversation = [{
      ...conversation[0],
      content: truncateContentToTokenBudget(conversation[0].content, allowedTokens)
    }];
    result = [...systemMessages, ...conversation];
  }
  return result;
}

export function createConversationSummarizer({ crofai, config, signal }) {
  const provider = config?.providers?.openrouter;
  if (!crofai?.chatCompletion || !provider?.apiKey) return null;

  let summaryPromise = null;
  return (transcript) => {
    if (!summaryPromise) {
      summaryPromise = crofai.chatCompletion({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerId: "openrouter",
        signal,
        body: {
          model: config.context.summaryModel,
          messages: [
            {
              role: "system",
              content: "Summarize the earlier conversation for continuity. Preserve user goals, decisions, constraints, facts, exact identifiers, files, and unresolved work. Do not answer the newest request and do not add new facts. Return only the concise summary."
            },
            { role: "user", content: transcript }
          ],
          temperature: 0.1,
          reasoning_effort: "low",
          max_tokens: config.context.summaryMaxTokens
        }
      });
    }
    return summaryPromise;
  };
}

export async function buildProviderMessages({
  messages,
  systemPrompt,
  r2,
  imageDescriptions = null,
  contextConfig = null,
  summarizeHistory = null
}) {
  const providerMessages = [];
  if (systemPrompt) providerMessages.push({ role: "system", content: systemPrompt });

  const eligible = filterCouncilHistory(messages).filter((message) => {
    // Persisted tool rows do not retain the complete assistant tool-call
    // envelope, so only replay normal conversation roles here. The live
    // tool loop appends its own correctly paired tool messages later.
    if (message.role !== "user" && message.role !== "assistant") return false;
    return message.role !== "assistant" || String(message.content || "").trim();
  });
  let selected = eligible;
  let summary = "";

  if (contextConfig) {
    const totalTokens = estimateContextTokens([
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...eligible
    ]);
    if (totalTokens >= contextConfig.compactAtTokens) {
      const partition = partitionRecentTurns(eligible, contextConfig.keepRecentTokens);
      if (partition.older.length && summarizeHistory) {
        const transcript = buildSummaryTranscript(partition.older, contextConfig.compactAtTokens);
        if (transcript) {
          try {
            summary = String(await summarizeHistory(transcript) || "").trim();
          } catch (error) {
            if (error?.name === "AbortError") throw error;
          }
        }
      }
      if (summary) selected = partition.recent;
    }
  }

  if (summary) {
    providerMessages.push({
      role: "system",
      content: `Conversation summary of earlier turns:\n${summary}`
    });
  }

  for (const message of selected) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (message.role === "assistant" && !String(message.content || "").trim()) continue;
    providerMessages.push({
      role: message.role,
      content: await hydrateContent(message.content, r2, "provider", { imageDescriptions })
    });
  }

  if (!contextConfig) return providerMessages;
  const historyBudget = Math.max(1, contextConfig.maxTokens - contextConfig.reserveTokens);
  return trimProviderMessagesToBudget(providerMessages, historyBudget);
}

export function resolveReasoningDurationMs(message) {
  const stored = message?.metadata?.reasoningDurationMs ?? message?.reasoningDurationMs;
  if (stored != null && Number.isFinite(Number(stored))) return Math.max(0, Number(stored));
  if (message?.activityStartedAt && message?.activityEndedAt) {
    return Math.max(0, message.activityEndedAt - message.activityStartedAt);
  }
  if (message?.reasoningStartedAt && message?.reasoningEndedAt) {
    return Math.max(0, message.reasoningEndedAt - message.reasoningStartedAt);
  }
  return null;
}

export function reasoningDurationMetadata(existingMetadata, accumulated) {
  const ms = resolveReasoningDurationMs(accumulated);
  if (ms == null) return existingMetadata;
  return { ...(existingMetadata || {}), reasoningDurationMs: ms };
}

/**
 * Normalize an OpenAI/OpenRouter `usage` object to a stable shape.
 * `total_tokens` already includes reasoning tokens (reasoning is part of
 * the completion), so it represents everything in the context window for
 * that turn: system prompt + full input history + output + reasoning.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  const decimal = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const prompt = num(usage.prompt_tokens ?? usage.promptTokens);
  const completion = num(usage.completion_tokens ?? usage.completionTokens);
  const reasoning = num(
    usage.completion_tokens_details?.reasoning_tokens
    ?? usage.reasoning_tokens
    ?? usage.reasoningTokens
  );
  const cost = decimal(usage.cost ?? usage.costCredits ?? usage.total_cost ?? usage.totalCost);
  let total = num(usage.total_tokens ?? usage.totalTokens);
  if (total == null && (prompt != null || completion != null)) {
    total = (prompt || 0) + (completion || 0);
  }

  const result = {};
  if (prompt != null) result.promptTokens = prompt;
  if (completion != null) result.completionTokens = completion;
  if (reasoning != null) result.reasoningTokens = reasoning;
  if (total != null) result.totalTokens = total;
  if (cost != null) result.costCredits = cost;
  if (usage.cost_details && typeof usage.cost_details === "object") result.costDetails = usage.cost_details;
  return Object.keys(result).length ? result : null;
}

// Keep in sync with the mirrored copy in public/js/app.js (client/server bundles are separate).
export function stripLeakedToolMarkup(value) {
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
