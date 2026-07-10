import { extractReasoningDelta } from "./reasoning.js";

export function createStreamReducer({
  isAdminUser,
  mergeArtifacts,
  markActivityStarted,
  markActivityEnded,
  markReasoningStarted,
  markReasoningEnded,
  normalizeClientUsage,
  stripLeakedToolMarkup,
  isFinalFinishReason,
  isPlaceholderPeerReason
}) {
  function ensureToolState(message) {
    if (!message.toolEvents) message.toolEvents = [];
    if (!message.citations) message.citations = [];
  }

  function applyToolEvent(message, event) {
    ensureToolState(message);
    if (event.type === "tool:start") {
      markActivityStarted(message);
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(event.arguments || "{}"); } catch {}
      message.toolEvents.push({
        id: event.toolCallId,
        name: event.name,
        query: parsedArgs.query || parsedArgs.url || "",
        status: "running"
      });
      return;
    }
    if (event.type === "tool:result") {
      const entry = message.toolEvents.find((row) => row.id === event.toolCallId);
      if (entry) {
        entry.status = "done";
        entry.cached = Boolean(event.cached);
        entry.provider = event.provider || "";
        entry.resultCount = (event.citations || []).length;
      }
      const offset = message.citations.length;
      for (const citation of event.citations || []) {
        message.citations.push({ ...citation, index: offset + citation.index });
      }
      mergeArtifacts(message, event.artifacts || []);
      return;
    }
    if (event.type === "tool:error") {
      const entry = message.toolEvents.find((row) => row.id === event.toolCallId);
      if (entry) {
        entry.status = "error";
        entry.error = event.error?.message || "Tool failed.";
      } else {
        message.toolEvents.push({ id: event.toolCallId, name: event.name, status: "error", error: event.error?.message || "Tool failed." });
      }
      return;
    }
    if (event.type === "tool:limit") {
      message.toolEvents.push({ id: `limit_${Date.now()}`, name: "limit", status: "limit", limit: event.limit });
    }
  }

  function applyStreamEvent(message, event) {
    if (event?.type === "error") {
      message.error = event.error || "Model request failed.";
      message.finishReason = "error";
      markActivityEnded(message);
      markReasoningEnded(message);
      return;
    }

    if (event?.type === "done") {
      message.finishReason ||= "stop";
      markActivityEnded(message);
      markReasoningEnded(message);
      return;
    }

    if (event?.type === "usage") {
      if (event.usage) message.usage = event.usage;
      return;
    }

    if (event?.type === "response:reset") {
      // Tool-loop prose is useful while the tool is running. Replace it only
      // when the next answer actually begins, not when the tool call starts.
      message.resetContentOnNextTextDelta = true;
      return;
    }

    if (typeof event?.type === "string" && event.type.startsWith("tool:")) {
      applyToolEvent(message, event);
      return;
    }

    markActivityStarted(message);

    /* Providers stream a trailing usage chunk (usually with empty choices)
       when usage reporting is enabled — record it for the context meter. */
    if (event?.usage) {
      const usage = normalizeClientUsage(event.usage);
      if (usage) message.usage = usage;
    }

    const choice = event?.choices?.[0];
    const delta = choice?.delta || {};

    const reasoningDelta = extractReasoningDelta(delta);
    if (reasoningDelta) {
      markReasoningStarted(message);
      if (isAdminUser()) message.reasoning += reasoningDelta;
    }
    if (typeof delta.content === "string" && delta.content) {
      if (message.resetContentOnNextTextDelta) {
        message.content = "";
        delete message.resetContentOnNextTextDelta;
      }
      markReasoningEnded(message);
      message.content += delta.content;
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const callDelta of delta.tool_calls) {
        const index = Number.isInteger(callDelta.index) ? callDelta.index : message.toolCalls.length;
        const existing = message.toolCalls[index] || { id: "", type: "function", function: { name: "", arguments: "" } };
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

  function applyCompareStreamEvent(compareMessage, event) {
    const index = Number(event?.index);
    if (!Number.isInteger(index) || !compareMessage.compareResponses?.[index]) return null;
    const target = compareMessage.compareResponses[index];

    if (event.type === "start") {
      target.id = event.assistantMessageId || target.id;
      if (event.metadata && !target.metadata) target.metadata = event.metadata;
      markActivityStarted(target);
      return target;
    }

    if (event.type === "delta") {
      applyStreamEvent(target, event.event);
      return target;
    }

    if (event.type === "error") {
      target.error = event.error || "Model request failed.";
      target.finishReason = "error";
      markActivityEnded(target);
      return target;
    }

    if (event.type === "done") {
      target.finishReason ||= "stop";
      markActivityEnded(target);
      return target;
    }
    return target;
  }

  function applyCouncilStreamEvent(council, event) {
    const type = event?.type;

    if (type === "council:start") {
      council.sessionId = event.sessionId || council.sessionId;
      return null;
    }

    /* Stage 1 events reuse compare-style envelope */
    if (type === "start" || type === "delta" || type === "done" || type === "error") {
      const index = Number(event.index);
      const target = council.panelists?.[index];
      if (!target) return null;
      if (type === "start") {
        target.id = event.assistantMessageId || target.id;
        markActivityStarted(target);
        if (!target.metadata) target.metadata = { council: { sessionId: council.sessionId, role: "panelist", stage: 1 } };
      } else if (type === "delta") {
        applyStreamEvent(target, event.event);
      } else if (type === "error") {
        target.error = event.error || "Model request failed.";
        target.finishReason = "error";
        markActivityEnded(target);
      } else if (type === "done") {
        target.finishReason ||= "stop";
        markActivityEnded(target);
      }
      return target;
    }

    if (type === "council:peer:start") {
      council.stage1Status = "done";
      council.stage2Status = "active";
      council.peerStatus = "Peers are evaluating each response…";
      return null;
    }

    if (type === "council:peer:ballot") {
      if (!council.ballots) council.ballots = [];
      council.ballots.push({
        reviewer: event.reviewerModel,
        valid: event.valid,
        ranking: event.ranking || [],
        justifications: event.justifications || {},
        error: event.error || null
      });
      /* Stream justifications onto panelist metadata so UI updates progressively */
      for (const [modelId, reason] of Object.entries(event.justifications || {})) {
        if (isPlaceholderPeerReason(reason)) continue;
        const target = council.panelists.find((p) => p.model === modelId);
        if (!target) continue;
        if (!target.metadata) target.metadata = { council: {} };
        if (!target.metadata.council) target.metadata.council = {};
        if (!target.metadata.council.peerJustifications) target.metadata.council.peerJustifications = {};
        target.metadata.council.peerJustifications[event.reviewerModel] = reason;
      }
      return null;
    }

    if (type === "council:peer:done") {
      council.stage2Status = "done";
      council.peerStatus = "";
      for (const row of event.borda || []) {
        const target = council.panelists.find((p) => p.model === row.modelId);
        if (!target) continue;
        if (!target.metadata) target.metadata = { council: {} };
        if (!target.metadata.council) target.metadata.council = {};
        target.metadata.council.peerRank = row.rank;
        target.metadata.council.bordaScore = row.bordaScore;
        target.metadata.council.ballotCount = row.ballotCount;
      }
      return null;
    }

    if (type === "council:peer:error") {
      council.stage2Status = "error";
      council.peerStatus = `Peer review failed: ${event.error || "Unknown error."}`;
      for (const panelist of council.panelists || []) {
        if (!panelist.metadata) panelist.metadata = { council: {} };
        if (!panelist.metadata.council) panelist.metadata.council = {};
        panelist.metadata.council.peerReviewStatus = "error";
        panelist.metadata.council.peerReviewReason = event.error || "Peer review failed.";
      }
      return null;
    }

    if (type === "council:peer:skipped") {
      council.stage2Status = "done";
      council.peerStatus = event.reason || "Peer review skipped.";
      for (const panelist of council.panelists || []) {
        if (!panelist.metadata) panelist.metadata = { council: {} };
        if (!panelist.metadata.council) panelist.metadata.council = {};
        panelist.metadata.council.peerReviewStatus = "skipped";
        panelist.metadata.council.peerReviewReason = event.reason || "Peer review skipped.";
      }
      return null;
    }

    if (type === "council:chairman:start") {
      council.stage3Status = "active";
      if (!council.chairman) {
        council.chairman = {
          id: event.assistantMessageId || `local_chair_${Date.now()}`,
          role: "assistant",
          model: event.chairmanModel || "",
          content: "",
          reasoning: "",
          toolCalls: [],
          metadata: {
            council: {
              sessionId: council.sessionId,
              role: "chairman",
              stage: 3,
              chairmanModel: event.chairmanModel || ""
            }
          }
        };
      } else {
        council.chairman.model = event.chairmanModel || council.chairman.model;
        council.chairman.id = event.assistantMessageId || council.chairman.id;
      }
      markActivityStarted(council.chairman);
      return council.chairman;
    }

    if (type === "council:chairman:delta") {
      if (!council.chairman) return null;
      applyStreamEvent(council.chairman, event.event);
      return council.chairman;
    }

    if (type === "council:chairman:done") {
      council.stage3Status = "done";
      if (council.chairman) {
        council.chairman.finishReason ||= "stop";
        markActivityEnded(council.chairman);
      }
      return council.chairman || null;
    }

    if (type === "council:chairman:error") {
      council.stage3Status = "error";
      if (council.chairman) {
        council.chairman.error = event.error || "Chairman synthesis failed.";
        council.chairman.finishReason = "error";
        markActivityEnded(council.chairman);
      }
      return council.chairman || null;
    }

    if (type === "council:chairman:skipped") {
      council.stage3Status = "skipped";
      return null;
    }
    return null;
  }

  return {
    applyStreamEvent,
    applyToolEvent,
    applyCompareStreamEvent,
    applyCouncilStreamEvent,
    ensureToolState
  };
}
