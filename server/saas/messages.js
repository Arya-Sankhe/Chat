import { HttpError } from "../http/responses.js";

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
    reasoning_effort: settings.reasoning_effort
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
          : { url: signedUrl }
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

export async function hydrateMessagesForClient(messages, r2) {
  const result = [];
  for (const message of messages) {
    result.push({
      ...message,
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

export async function buildProviderMessages({ messages, systemPrompt, r2, imageDescriptions = null }) {
  const providerMessages = [];
  if (systemPrompt) providerMessages.push({ role: "system", content: systemPrompt });

  const trimmed = filterCouncilHistory(messages);
  for (const message of trimmed) {
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool") continue;
    if (message.role === "assistant" && !String(message.content || "").trim()) continue;
    providerMessages.push({
      role: message.role,
      content: await hydrateContent(message.content, r2, "provider", { imageDescriptions })
    });
  }

  return providerMessages;
}

function markReasoningStarted(message) {
  if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
}

function markReasoningEnded(message) {
  if (message.reasoningStartedAt && !message.reasoningEndedAt) {
    message.reasoningEndedAt = Date.now();
  }
}

export function resolveReasoningDurationMs(message) {
  const stored = message?.metadata?.reasoningDurationMs ?? message?.reasoningDurationMs;
  if (stored != null && Number.isFinite(Number(stored))) return Math.max(0, Number(stored));
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

export function applyStreamEvent(message, event) {
  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};

  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
    markReasoningStarted(message);
    message.reasoning += delta.reasoning_content;
  }

  if (typeof delta.content === "string" && delta.content) {
    markReasoningEnded(message);
    message.content += delta.content;
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const callDelta of delta.tool_calls) {
      const index = Number.isInteger(callDelta.index) ? callDelta.index : message.toolCalls.length;
      const existing = message.toolCalls[index] || {
        id: "",
        type: "function",
        function: { name: "", arguments: "" }
      };

      existing.id = callDelta.id || existing.id;
      existing.type = callDelta.type || existing.type;
      existing.function.name = callDelta.function?.name || existing.function.name;
      existing.function.arguments += callDelta.function?.arguments || "";
      message.toolCalls[index] = existing;
    }
  }

  if (choice?.finish_reason) {
    message.finishReason = choice.finish_reason;
    markReasoningEnded(message);
  }
}

function parseSseEvents(buffer, onEvent) {
  const events = buffer.split("\n\n");
  const remaining = events.pop() || "";

  for (const event of events) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (!data || data === "[DONE]") continue;
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Provider streams can occasionally include non-JSON diagnostics. Keep streaming.
    }
  }

  return remaining;
}

export async function pipeProviderStreamAndAccumulate(upstream, res) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const assistant = {
    content: "",
    reasoning: "",
    toolCalls: [],
    finishReason: ""
  };
  let buffer = "";

  while (!res.destroyed) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = Buffer.from(value);
    res.write(chunk);
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    buffer = parseSseEvents(buffer, (event) => applyStreamEvent(assistant, event));
  }

  return assistant;
}

export async function streamProviderAndAccumulate(upstream, onEvent) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const assistant = {
    content: "",
    reasoning: "",
    toolCalls: [],
    finishReason: ""
  };
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    buffer = parseSseEvents(buffer, (event) => {
      applyStreamEvent(assistant, event);
      onEvent(event);
    });
  }

  return assistant;
}
