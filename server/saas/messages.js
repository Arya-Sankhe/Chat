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
    ...attachments.map((attachment) => ({
      type: "image_url",
      image_url: {
        attachment_id: attachment.id,
        object_key: attachment.object_key,
        file_name: attachment.file_name,
        url: `r2://${attachment.object_key}`
      }
    }))
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

async function hydrateContent(content, r2, mode) {
  if (!Array.isArray(content)) return content || "";

  const hydrated = [];
  for (const part of content) {
    if (part?.type === "text") {
      hydrated.push({ type: "text", text: part.text || "" });
      continue;
    }

    if (part?.type === "image_url") {
      const image = part.image_url || {};
      const objectKey = image.object_key || String(image.url || "").replace(/^r2:\/\//, "");
      const signedUrl = objectKey ? r2.readUrl(objectKey) : image.url;
      hydrated.push({
        type: "image_url",
        image_url: mode === "client"
          ? { ...image, url: signedUrl }
          : { url: signedUrl }
      });
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

export async function buildProviderMessages({ messages, systemPrompt, r2 }) {
  const providerMessages = [];
  if (systemPrompt) providerMessages.push({ role: "system", content: systemPrompt });

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool") continue;
    if (message.role === "assistant" && !String(message.content || "").trim()) continue;
    providerMessages.push({
      role: message.role,
      content: await hydrateContent(message.content, r2, "provider")
    });
  }

  return providerMessages;
}

export function applyStreamEvent(message, event) {
  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};

  if (typeof delta.reasoning_content === "string") {
    message.reasoning += delta.reasoning_content;
  }

  if (typeof delta.content === "string") {
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

  if (choice?.finish_reason) message.finishReason = choice.finish_reason;
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
