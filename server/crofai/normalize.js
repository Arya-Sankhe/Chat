import { HttpError } from "../http/responses.js";

const roles = new Set(["system", "user", "assistant", "tool"]);

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be an object.`);
  }
}

function cleanString(value, label, { required = true, max = 20000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, `${label} must be a string.`);
  }

  if (required && value.trim().length === 0) {
    throw new HttpError(400, `${label} cannot be empty.`);
  }

  if (value.length > max) {
    throw new HttpError(400, `${label} is too long.`);
  }

  return value;
}

const imageDataUrlPattern = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function cleanImageReference(value, label) {
  const url = cleanString(value, label, { max: 10 * 1024 * 1024 });

  if (url.startsWith("data:")) {
    if (!imageDataUrlPattern.test(url)) {
      throw new HttpError(400, `${label} must be a png, jpeg, webp, or gif data URL.`);
    }

    return url.replace(/\s/g, "");
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw new HttpError(400, `${label} must be an http, https, or image data URL.`);
  }

  return url;
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return cleanString(content, "message content", { required: false, max: 100000 }) || "";
  }

  if (!Array.isArray(content)) {
    throw new HttpError(400, "message content must be a string or content array.");
  }

  return content.map((part, index) => {
    assertPlainObject(part, `message content part ${index + 1}`);

    if (part.type === "text") {
      return {
        type: "text",
        text: cleanString(part.text, `message content part ${index + 1} text`, { max: 100000 })
      };
    }

    if (part.type === "image_url") {
      const imageUrl = typeof part.image_url === "string" ? { url: part.image_url } : part.image_url;
      assertPlainObject(imageUrl, `message content part ${index + 1} image_url`);

      return {
        type: "image_url",
        image_url: {
          url: cleanImageReference(imageUrl.url, `message content part ${index + 1} image URL`)
        }
      };
    }

    throw new HttpError(400, `Unsupported message content part type: ${part.type}`);
  });
}

function normalizeMessage(message, index) {
  assertPlainObject(message, `message ${index + 1}`);

  if (!roles.has(message.role)) {
    throw new HttpError(400, `message ${index + 1} has an unsupported role.`);
  }

  const normalized = {
    role: message.role,
    content: normalizeContent(message.content)
  };

  if (message.role === "tool") {
    normalized.tool_call_id = cleanString(message.tool_call_id, `message ${index + 1} tool_call_id`, { max: 500 });
  }

  return normalized;
}

function numberParam(value, label, { min, max, integer = false }) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new HttpError(400, `${label} must be a number.`);
  }

  if (integer && !Number.isInteger(number)) {
    throw new HttpError(400, `${label} must be an integer.`);
  }

  if (number < min || number > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  }

  return number;
}

function normalizeStop(value) {
  if (value === undefined || value === null || value === "") return undefined;

  if (typeof value === "string") {
    return cleanString(value, "stop", { max: 500 });
  }

  if (Array.isArray(value)) {
    const stops = value
      .map((item, index) => cleanString(item, `stop ${index + 1}`, { max: 500 }))
      .filter(Boolean);
    return stops.length ? stops.slice(0, 8) : undefined;
  }

  throw new HttpError(400, "stop must be a string or string array.");
}

function normalizeTools(value) {
  if (value === undefined || value === null || value === "") return undefined;

  if (!Array.isArray(value)) {
    throw new HttpError(400, "tools must be a JSON array.");
  }

  JSON.stringify(value);
  return value;
}

export function normalizeChatRequest(input) {
  assertPlainObject(input, "chat request");

  const messages = input.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array.");
  }

  const normalized = {
    model: cleanString(input.model, "model", { max: 300 }),
    messages: messages.map(normalizeMessage),
    stream: true
  };

  const maxTokens = numberParam(input.max_tokens, "max_tokens", { min: 1, max: 1000000, integer: true });
  const temperature = numberParam(input.temperature, "temperature", { min: 0, max: 2 });
  const topP = numberParam(input.top_p, "top_p", { min: 0, max: 1 });
  const seed = numberParam(input.seed, "seed", { min: 0, max: 2147483647, integer: true });
  const stop = normalizeStop(input.stop);
  const tools = normalizeTools(input.tools);

  const validEfforts = new Set(["low", "medium", "high"]);
  const reasoningEffort = validEfforts.has(input.reasoning_effort) ? input.reasoning_effort : undefined;

  if (maxTokens !== undefined) normalized.max_tokens = maxTokens;
  if (temperature !== undefined) normalized.temperature = temperature;
  if (topP !== undefined) normalized.top_p = topP;
  if (seed !== undefined) normalized.seed = seed;
  if (stop !== undefined) normalized.stop = stop;
  if (tools !== undefined) normalized.tools = tools;
  if (reasoningEffort !== undefined) normalized.reasoning_effort = reasoningEffort;

  return normalized;
}
