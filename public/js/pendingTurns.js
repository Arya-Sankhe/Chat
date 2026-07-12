function outputSlot(message) {
  return String(message?.output_slot || message?.outputSlot || "");
}

function resumedOutput(message) {
  const restored = {
    ...message,
    toolCalls: message?.toolCalls || message?.tool_calls || [],
    finishReason: "",
    finish_reason: null
  };
  delete restored.error;
  delete restored.stopped;
  return restored;
}

export function reconcilePendingTurnMessages(messages, turnRunId, assistant) {
  const source = Array.isArray(messages) ? messages : [];
  const runId = String(turnRunId || "");
  const outputs = source
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => String(message?.turn_run_id || message?.turnRunId || "") === runId);

  if (!outputs.length) return [...source, assistant];

  for (const { message } of outputs) {
    const slot = outputSlot(message);
    const restored = resumedOutput(message);
    if (assistant?.compareGroup && slot.startsWith("compare:")) {
      const index = Number(slot.slice("compare:".length));
      if (Number.isInteger(index) && assistant.compareResponses?.[index]) {
        assistant.compareResponses[index] = restored;
      }
    } else if (assistant?.councilGroup && slot.startsWith("panel:")) {
      const index = Number(slot.slice("panel:".length));
      if (Number.isInteger(index) && assistant.panelists?.[index]) {
        assistant.panelists[index] = restored;
      }
    } else if (assistant?.councilGroup && slot === "chairman") {
      assistant.chairman = restored;
    } else if (!assistant?.compareGroup && !assistant?.councilGroup && slot === "single") {
      Object.assign(assistant, restored);
    }
  }

  const outputSet = new Set(outputs.map(({ message }) => message));
  const remaining = source.filter((message) => !outputSet.has(message));
  const insertAt = source
    .slice(0, outputs[0].index)
    .filter((message) => !outputSet.has(message)).length;
  remaining.splice(insertAt, 0, assistant);
  return remaining;
}
