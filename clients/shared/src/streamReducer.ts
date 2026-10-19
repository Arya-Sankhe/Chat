import {
  extractReasoningDelta,
  isFinalFinishReason,
  normalizeUsage,
  stripLeakedReasoningMarkup,
  stripLeakedToolMarkup
} from "./content";
import type { ActivityItem, Citation, LiveAssistant, StreamEvent, ToolCallDelta } from "./types";

/* Port of the single-chat path of public/js/streaming.js. It mutates the
   assistant in place; callers publish a copy when they want a re-render. */

export function createLiveAssistant(id = `local_assistant_${Date.now()}`): LiveAssistant {
  return {
    id,
    role: "assistant",
    content: "",
    reasoning: "",
    model: "",
    toolCalls: [],
    toolEvents: [],
    citations: [],
    activity: [],
    artifacts: [],
    finishReason: "",
    error: "",
    stopped: false,
    usage: null,
    metadata: null,
    illustrationStatus: "",
    activityStartedAt: 0,
    activityEndedAt: 0,
    reasoningStartedAt: 0,
    reasoningEndedAt: 0,
    resetContentOnNextTextDelta: false
  };
}

export interface ReducerOptions {
  /** Reasoning text is only kept for admins, matching the server's own filter. */
  keepReasoning?: boolean;
  now?: () => number;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function pushActivity(message: LiveAssistant, item: ActivityItem) {
  if (message.activity.some((row) => row.key === item.key)) return;
  message.activity.push(item);
}

function artifactKey(artifact: unknown): string {
  if (!artifact || typeof artifact !== "object") return "";
  const a = artifact as Record<string, unknown>;
  return String(a.id ?? a.url ?? a.key ?? "");
}

export function applyStreamEvent(message: LiveAssistant, event: StreamEvent, options: ReducerOptions = {}): void {
  const now = options.now ?? Date.now;
  const activityStarted = () => { if (!message.activityStartedAt) message.activityStartedAt = now(); };
  const activityEnded = () => {
    if (message.activityStartedAt && !message.activityEndedAt) message.activityEndedAt = now();
  };
  const reasoningStarted = () => {
    activityStarted();
    if (!message.reasoningStartedAt) message.reasoningStartedAt = now();
  };
  const reasoningEnded = () => {
    if (message.reasoningStartedAt && !message.reasoningEndedAt) message.reasoningEndedAt = now();
  };

  if (typeof event?.model === "string" && event.model && !message.model) message.model = event.model;
  const type = typeof event?.type === "string" ? event.type : "";

  switch (type) {
    case "illustration:status":
      message.illustrationStatus = String(event.label || "Planning illustration…");
      activityStarted();
      return;
    case "illustration:result":
      if (typeof event.content === "string") message.content = event.content;
      if (event.metadata) message.metadata = event.metadata as Record<string, unknown>;
      message.illustrationStatus = "";
      message.finishReason ||= "stop";
      activityEnded();
      reasoningEnded();
      return;
    case "error":
      message.error = String(event.error || "Model request failed.");
      message.finishReason = "error";
      activityEnded();
      reasoningEnded();
      return;
    case "done":
      message.finishReason ||= "stop";
      activityEnded();
      reasoningEnded();
      return;
    case "usage":
      message.usage = normalizeUsage(event.usage) ?? message.usage;
      return;
    case "response:reset":
      // Tool-loop prose stays visible until the next answer actually begins.
      message.resetContentOnNextTextDelta = true;
      return;
    case "status:step":
      activityStarted();
      if (event.text) {
        const text = String(event.text);
        pushActivity(message, { key: `step:${message.activity.length}:${text}`, kind: "step", text: clip(text, 80) });
      }
      return;
    case "status:thought":
      activityStarted();
      if (event.text) {
        const text = String(event.text);
        // Thoughts rotate through one line instead of piling up.
        if (message.activity.at(-1)?.kind === "thought") message.activity.pop();
        pushActivity(message, { key: `thought:${message.activity.length}:${text}`, kind: "thought", text: clip(text, 110) });
      }
      return;
  }

  if (type.startsWith("tool:")) {
    applyToolEvent(message, event, activityStarted);
    return;
  }
  // Turn bookkeeping (turn:submitted, turn:claimed, turn:waiting, turn:done) is the run's business.
  if (type.startsWith("turn:")) return;

  activityStarted();
  const usage = normalizeUsage(event?.usage);
  if (usage) message.usage = usage;

  const choice = (event?.choices as Array<Record<string, any>> | undefined)?.[0];
  const delta: Record<string, any> = choice?.delta ?? {};

  const reasoningDelta = extractReasoningDelta(delta);
  if (reasoningDelta) {
    reasoningStarted();
    if (options.keepReasoning) message.reasoning += reasoningDelta;
  }
  if (typeof delta.content === "string" && delta.content) {
    if (message.resetContentOnNextTextDelta) {
      message.content = "";
      message.finishReason = "";
      message.toolCalls = [];
      message.resetContentOnNextTextDelta = false;
    }
    reasoningEnded();
    message.content = stripLeakedReasoningMarkup(message.content + delta.content, message.model);
  }

  if (Array.isArray(delta.tool_calls)) {
    for (const callDelta of delta.tool_calls as Array<Record<string, any>>) {
      const index = Number.isInteger(callDelta.index) ? callDelta.index : message.toolCalls.length;
      const existing: ToolCallDelta = message.toolCalls[index] ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      existing.id = callDelta.id || existing.id;
      existing.type = callDelta.type || existing.type;
      existing.function.name = callDelta.function?.name || existing.function.name;
      existing.function.arguments += callDelta.function?.arguments || "";
      message.toolCalls[index] = existing;
    }
  }

  if (choice?.finish_reason) {
    message.finishReason = String(choice.finish_reason);
    if (isFinalFinishReason(message.finishReason)) activityEnded();
    reasoningEnded();
    message.content = stripLeakedToolMarkup(message.content);
  }
}

function applyToolEvent(message: LiveAssistant, event: StreamEvent, activityStarted: () => void) {
  const callId = String(event.toolCallId ?? "");
  if (event.type === "tool:start") {
    activityStarted();
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(String(event.arguments || "{}")); } catch {}
    message.toolEvents.push({
      id: callId,
      name: String(event.name ?? ""),
      query: String(args.query || args.url || ""),
      status: "running"
    });
    return;
  }
  const entry = message.toolEvents.find((row) => row.id === callId);
  if (event.type === "tool:result") {
    const citations = (event.citations as Citation[] | undefined) ?? [];
    if (entry) {
      entry.status = "done";
      entry.cached = Boolean(event.cached);
      entry.provider = String(event.provider || "");
      entry.resultCount = citations.length;
    }
    const offset = message.citations.length;
    for (const citation of citations) message.citations.push({ ...citation, index: offset + citation.index });
    const seen = new Set(message.artifacts.map(artifactKey).filter(Boolean));
    for (const artifact of (event.artifacts as unknown[] | undefined) ?? []) {
      const key = artifactKey(artifact);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      message.artifacts.push(artifact);
    }
    return;
  }
  if (event.type === "tool:error") {
    const error = String((event.error as { message?: string } | undefined)?.message || "Tool failed.");
    if (entry) {
      entry.status = "error";
      entry.error = error;
    } else {
      message.toolEvents.push({ id: callId, name: String(event.name ?? ""), status: "error", error });
    }
    return;
  }
  if (event.type === "tool:limit") {
    message.toolEvents.push({ id: `limit_${message.toolEvents.length}`, name: "limit", status: "limit", limit: event.limit });
  }
}
