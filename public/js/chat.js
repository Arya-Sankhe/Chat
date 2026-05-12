import { createId } from "./storage.js";

export function createUserMessage(content) {
  return {
    id: createId("msg"),
    role: "user",
    content,
    createdAt: new Date().toISOString()
  };
}

export function createAssistantMessage(model) {
  return {
    id: createId("msg"),
    role: "assistant",
    model,
    content: "",
    reasoning: "",
    toolCalls: [],
    createdAt: new Date().toISOString()
  };
}

export function titleFromMessage(content) {
  const text = Array.isArray(content)
    ? content.filter((part) => part.type === "text").map((part) => part.text).join(" ")
    : content;

  const clean = String(text || "New chat").trim().replace(/\s+/g, " ");
  return clean.length > 48 ? `${clean.slice(0, 45)}...` : clean || "New chat";
}

export function buildUserContent(text, imageUrls) {
  const cleanText = text.trim();
  const cleanImages = imageUrls.map((url) => url.trim()).filter(Boolean);

  if (!cleanImages.length) return cleanText;

  return [
    ...(cleanText ? [{ type: "text", text: cleanText }] : []),
    ...cleanImages.map((url) => ({ type: "image_url", image_url: { url } }))
  ];
}

export function buildRequestMessages(conversation, settings, pendingAssistantId) {
  const messages = [];

  if (settings.systemPrompt.trim()) {
    messages.push({ role: "system", content: settings.systemPrompt.trim() });
  }

  for (const message of conversation.messages) {
    if (message.id === pendingAssistantId) continue;
    if (message.role === "assistant" && !message.content.trim()) continue;
    messages.push({
      role: message.role,
      content: message.content
    });
  }

  return messages;
}

export function buildChatPayload(conversation, assistantMessage, settings) {
  const stop = settings.stop
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const payload = {
    model: settings.model.trim(),
    messages: buildRequestMessages(conversation, settings, assistantMessage.id),
    temperature: settings.temperature,
    top_p: settings.top_p,
    max_tokens: settings.max_tokens || undefined,
    seed: settings.seed || undefined,
    stop: stop.length ? stop : undefined
  };

  const toolsText = settings.toolsText.trim();
  if (toolsText) {
    payload.tools = JSON.parse(toolsText);
  }

  return payload;
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
        function: {
          name: "",
          arguments: ""
        }
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
  }
}
