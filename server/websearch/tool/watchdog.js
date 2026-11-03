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

/* Watches one model call from the request until its stream ends. Until the model streams
   anything (headers, queueing) the call gets `startMs`; once reasoning, answer text or a tool
   call arrives, every gap between them gets `idleMs`. Streamed reasoning is the model working
   (a bank statement on xhigh thinks for 5+ minutes), so only silence counts as a stall. GPT
   models stream summaries and `reasoning.encrypted` blocks, which count too; OpenRouter's
   keep-alive comments are not model output and do not. */
export function callWatchdog(controller, { startMs, idleMs }) {
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
    if (delta && (delta.content || delta.tool_calls?.length || delta.reasoning || delta.reasoning_content || delta.reasoning_details?.length)) arm(idleMs);
  };
  watch.stop = () => clearTimeout(timer);
  arm(startMs);
  return watch;
}
