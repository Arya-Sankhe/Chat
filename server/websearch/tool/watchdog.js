// Stall detection for one streamed model call, shared by the chat tool loop and the document
// writers' plain calls. It stops calls that hang, never calls that are slow but still working.

function positiveMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export class AnswerStallError extends Error {}

export function stallLimits(config) {
  return {
    startMs: positiveMs(config?.context?.answerStallMs),
    idleMs: positiveMs(config?.context?.answerIdleMs) || positiveMs(config?.context?.answerStallMs)
  };
}

/* Watches one model call from the request until its stream ends. Before the answer starts
   (headers, reasoning) the call gets `startMs`; once answer text or a tool call arrives,
   every gap between stream events gets `idleMs`. A miss aborts the call as stalled. */
export function callWatchdog(controller, { startMs, idleMs }) {
  let answering = false;
  let timer = null;
  const watch = { stalled: false };
  const arm = (ms) => {
    clearTimeout(timer);
    timer = ms ? setTimeout(() => {
      watch.stalled = true;
      controller.abort(new AnswerStallError("answer stalled"));
    }, ms) : null;
  };
  watch.event = (event) => {
    const delta = event?.choices?.[0]?.delta;
    if ((typeof delta?.content === "string" && delta.content) || delta?.tool_calls?.length) answering = true;
    if (answering) arm(idleMs);
  };
  watch.stop = () => clearTimeout(timer);
  arm(startMs);
  return watch;
}
