import { extractReasoningDelta } from "../reasoning.js";
import { normalizeUsage, stripLeakedToolMarkup } from "./content.js";

function markReasoningStarted(message) {
  if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
}

function markReasoningEnded(message) {
  if (message.reasoningStartedAt && !message.reasoningEndedAt) {
    message.reasoningEndedAt = Date.now();
  }
}

function markActivityStarted(message) {
  if (!message.activityStartedAt) message.activityStartedAt = Date.now();
}

function markActivityEnded(message) {
  if (message.activityStartedAt && !message.activityEndedAt) {
    message.activityEndedAt = Date.now();
  }
}

function isFinalFinishReason(reason) {
  return Boolean(reason && reason !== "tool_calls");
}

export function applyStreamEvent(message, event) {
  if (event?.id && !message.generationId) message.generationId = String(event.id);

  /* Usage arrives in a trailing chunk (often with an empty `choices`
     array), so capture it before bailing on the missing choice. */
  if (event?.usage) {
    const usage = normalizeUsage(event.usage);
    if (usage) message.usage = usage;
  }

  const choice = event?.choices?.[0];
  const delta = choice?.delta || {};
  if (choice || event?.usage) markActivityStarted(message);

  const reasoningDelta = extractReasoningDelta(delta);
  if (reasoningDelta) {
    markReasoningStarted(message);
    message.reasoning += reasoningDelta;
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
    if (isFinalFinishReason(choice.finish_reason)) markActivityEnded(message);
    markReasoningEnded(message);
    message.content = stripLeakedToolMarkup(message.content);
  }
}

function finalizeAccumulatedAssistant(assistant) {
  if (assistant?.activityStartedAt && !assistant.activityEndedAt) {
    markActivityEnded(assistant);
  }
  assistant.content = stripLeakedToolMarkup(assistant.content);
}

function stripReasoningFields(target) {
  if (!target || typeof target !== "object") return target;
  const stripped = { ...target };
  delete stripped.reasoning;
  delete stripped.reasoning_content;
  delete stripped.reasoning_details;
  return stripped;
}

export function sanitizeProviderEvent(event, { includeReasoning = false } = {}) {
  if (includeReasoning || !event || typeof event !== "object") return event;
  const sanitized = stripReasoningFields(event);
  if (Array.isArray(event.choices)) {
    sanitized.choices = event.choices.map((choice) => {
      if (!choice || typeof choice !== "object") return choice;
      return {
        ...choice,
        ...(choice.delta ? { delta: stripReasoningFields(choice.delta) } : {}),
        ...(choice.message ? { message: stripReasoningFields(choice.message) } : {})
      };
    });
  }
  return sanitized;
}

export function writeProviderEvent(res, event, { includeReasoning = false } = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(sanitizeProviderEvent(event, { includeReasoning }))}\n\n`);
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

function attachPartialOnAbort(error, assistant) {
  if (error?.name !== "AbortError") return;
  finalizeAccumulatedAssistant(assistant);
  error.partial = assistant;
}

export async function pipeProviderStreamAndAccumulate(upstream, res, { includeReasoning = false } = {}) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const assistant = {
    content: "",
    reasoning: "",
    toolCalls: [],
    finishReason: "",
    usage: null,
    generationId: ""
  };
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (includeReasoning && !res.destroyed && !res.writableEnded) res.write(Buffer.from(value));
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      buffer = parseSseEvents(buffer, (event) => {
        applyStreamEvent(assistant, event);
        if (!includeReasoning) writeProviderEvent(res, event, { includeReasoning });
      });
    }
  } catch (error) {
    attachPartialOnAbort(error, assistant);
    throw error;
  }

  finalizeAccumulatedAssistant(assistant);
  return assistant;
}

export async function streamProviderAndAccumulate(upstream, onEvent) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const assistant = {
    content: "",
    reasoning: "",
    toolCalls: [],
    finishReason: "",
    usage: null,
    generationId: ""
  };
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      buffer = parseSseEvents(buffer, (event) => {
        applyStreamEvent(assistant, event);
        onEvent(event);
      });
    }
  } catch (error) {
    attachPartialOnAbort(error, assistant);
    throw error;
  }

  finalizeAccumulatedAssistant(assistant);
  return assistant;
}
