// One document-model call for the editors and writers. When web search is available the model gets
// web_search and read_url like any chat turn and decides itself whether the work needs facts it
// does not have ("update the prices to today's"); a plain rewrite answers straight away at no
// extra cost. Returns the final reply text, its finish reason, the web sources the model used and
// the evidence it read (search results and pages), so later stages can check against it.
import { streamProviderAndAccumulate } from "../saas/messages/stream.js";
import { AnswerStallError, callWatchdog, stallLimits } from "../websearch/tool/watchdog.js";

// What a later stage (review, fact check, revision) gets of the pages a call read.
const EVIDENCE_MAX_CHARS = 60_000;

const SEARCH_NOTE = "You can call web_search and read_url when the edit needs current or missing facts. Your final reply must still be only the edit JSON.";

export async function runEditorModel({ config, modelClient, provider, websearch = null, signal, body, note = SEARCH_NOTE, progress = null, maxToolRounds = 0 }) {
  if (!websearch) {
    // The same stall rule as the tool loop: a call that never starts answering, or stops
    // mid-answer, is stopped; a slow call that keeps streaming is left to finish.
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.("abort", onAbort, { once: true });
    const watch = callWatchdog(controller, stallLimits(config));
    try {
      const upstream = await modelClient.streamChatCompletion({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        providerId: provider.id,
        signal: controller.signal,
        body
      });
      const result = await streamProviderAndAccumulate(upstream, (event) => {
        watch.event(event);
        progress?.onEvent(event);
      });
      return { content: result?.content || "", finishReason: result?.finishReason || "", citations: [], evidence: "" };
    } catch (error) {
      if (watch.stalled && !signal?.aborted) throw new AnswerStallError("the model stopped responding");
      throw error;
    } finally {
      watch.stop();
      signal?.removeEventListener?.("abort", onAbort);
    }
  }
  // Loaded on use: the tool loop imports the document tools, which import the editors.
  const { buildWebSearchTools, runChatWithToolLoop } = await import("../websearch/tool/loop.js");
  const [system, ...rest] = body.messages;
  let transcript = [];
  const result = await runChatWithToolLoop({
    chatRequest: {
      ...body,
      messages: [{ ...system, content: `${system.content}\n\n${note}` }, ...rest],
      tools: buildWebSearchTools({ maxResults: config?.websearch?.maxResults }),
      tool_choice: "auto"
    },
    modelClient,
    config: config || {},
    provider,
    signal,
    websearch,
    maxToolRounds,
    onUpstreamEvent: (event) => progress?.onEvent(event),
    onToolEvent: (event) => progress?.onToolEvent(event),
    onIterationStart: (messages) => { transcript = messages; }
  });
  const evidence = transcript
    .filter((message) => message.role === "tool" && typeof message.content === "string" && !/^\{"error"/.test(message.content))
    .map((message) => message.content)
    .join("\n\n")
    .slice(0, EVIDENCE_MAX_CHARS);
  return {
    content: result.accumulated?.content || "",
    finishReason: result.accumulated?.finishReason || "",
    citations: result.citations || [],
    evidence
  };
}
