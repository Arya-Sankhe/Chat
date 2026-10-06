import { HttpError } from "../http/responses.js";
import { runChatWithToolLoop } from "../websearch/tool.js";
import {
  reasoningDurationMetadata,
  sanitizeProviderEvent,
  streamProviderAndAccumulate
} from "../saas/messages.js";
import {
  hasAssistantOutput,
  injectWebContextMessage,
  sharedDocumentMetadata,
  sharedWebsearchMetadata,
  createAssistantOutputMessage,
  startSse,
  updateAssistantOutputMessage,
  writeSse
} from "./shared.js";

export async function handleCompareConversationMessage({
  req,
  res,
  context,
  conversation,
  chatRequests,
  modelClient,
  provider,
  webSearch,
  documentSearch,
  /* Per model, from withAvailableTools: each model gets web search as a tool it may
     call, like a normal chat, instead of a search forced on every question. */
  toolSetups = [],
  config = null,
  websearch = null,
  webSearchMode = "off",
  turnRun = null
}) {
  const includeReasoning = context.profile?.role === "admin";
  const sharedSearch = webSearch?.contextMessage
    ? webSearch
    : { contextMessage: "", citations: [], providers: [], detection: null };

  if (sharedSearch.contextMessage) {
    for (const request of chatRequests) {
      request.messages = injectWebContextMessage(request.messages, sharedSearch.contextMessage);
    }
  }
  if (documentSearch?.contextMessage) {
    for (const request of chatRequests) {
      request.messages = injectWebContextMessage(request.messages, documentSearch.contextMessage);
    }
  }

  const assistantMessages = [];
  for (const [index, chatRequest] of chatRequests.entries()) {
    const webMeta = sharedWebsearchMetadata(sharedSearch);
    const documentMeta = sharedDocumentMetadata(documentSearch);
    const baseMeta = {
      ...(webMeta ? { websearch: webMeta } : {}),
      ...(documentMeta ? { documents: documentMeta } : {})
    };
    assistantMessages.push(await createAssistantOutputMessage(context, {
      user_id: context.user.id,
      conversation_id: conversation.id,
      role: "assistant",
      model: chatRequest.model,
      content: "",
      reasoning: "",
      tool_calls: [],
      metadata: baseMeta
    }, { signal: req.signal, turnRun, outputSlot: `compare:${index}` }));
  }

  const controller = req.turnController || new AbortController();
  if (!turnRun?.id) {
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
  }

  startSse(res, turnRun?.id ? { "x-klui-turn-run-id": turnRun.id } : {});

  await Promise.all(chatRequests.map(async (chatRequest, index) => {
    const assistantMessage = assistantMessages[index];
    writeSse(res, {
      type: "start",
      index,
      model: chatRequest.model,
      assistantMessageId: assistantMessage.id,
      metadata: assistantMessage.metadata || null
    });

    try {
      const writeDelta = (event) => writeSse(res, { type: "delta", index, model: chatRequest.model, event });
      const toolSetup = toolSetups[index];
      let accumulated;
      let artifacts = [];
      let toolMeta = null;
      if (toolSetup?.augmented) {
        const result = await runChatWithToolLoop({
          chatRequest: toolSetup.request,
          modelClient,
          config,
          provider,
          signal: controller.signal,
          websearch,
          weather: config?.weather,
          documents: null,
          onUpstreamEvent: (event) => writeDelta(sanitizeProviderEvent(event, { includeReasoning })),
          onToolEvent: writeDelta
        });
        accumulated = result.accumulated;
        artifacts = result.artifacts || [];
        if (toolSetup.enabled?.websearch) {
          const providers = (result.providers || []).filter((name) => name !== "documents");
          toolMeta = {
            websearch: {
              mode: webSearchMode,
              citations: result.citations || [],
              toolCallCount: result.toolCallCount || 0,
              provider: providers[0] || null,
              providers
            }
          };
        }
        if (toolSetup.enabled?.weather && artifacts.length) {
          toolMeta = {
            ...toolMeta,
            weather: {
              provider: "openweather",
              artifacts: artifacts.filter((artifact) => artifact?.type === "weather"),
              toolCallCount: result.toolCallCount || 0
            }
          };
        }
      } else {
        const upstream = await modelClient.streamChatCompletion({
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          body: chatRequest,
          providerId: provider?.id,
          signal: controller.signal
        });

        if (!upstream.body) throw new HttpError(502, `${provider.label} returned an empty response stream.`);

        accumulated = await streamProviderAndAccumulate(upstream, (event) => {
          writeDelta(sanitizeProviderEvent(event, { includeReasoning }));
        });
      }
      if (!hasAssistantOutput(accumulated, artifacts)) {
        throw new HttpError(502, `${provider.label} returned an empty response.`);
      }

      const compareDurationMeta = reasoningDurationMetadata({ ...assistantMessage.metadata, ...toolMeta }, accumulated);
      await updateAssistantOutputMessage(context, assistantMessage.id, {
        content: accumulated.content,
        reasoning: accumulated.reasoning,
        tool_calls: accumulated.toolCalls,
        finish_reason: accumulated.finishReason || null,
        error: null,
        ...(compareDurationMeta ? { metadata: compareDurationMeta } : {})
      }, { signal: req.signal, turnRun });

      writeSse(res, { type: "done", index, model: chatRequest.model });
    } catch (error) {
      const aborted = error?.name === "AbortError";
      const message = aborted ? "Stopped by user." : error?.message || "Model request failed.";
      const partial = aborted ? error.partial : null;
      /* Drop req.signal on abort so the partial write is not cancelled by
         the already-aborted client request signal. */
      await updateAssistantOutputMessage(context, assistantMessage.id, {
        ...(aborted ? {
          content: partial?.content || "",
          reasoning: partial?.reasoning || ""
        } : {}),
        error: message,
        finish_reason: "error"
      }, { ...(aborted ? {} : { signal: req.signal }), turnRun }).catch(() => {});
      writeSse(res, { type: "error", index, model: chatRequest.model, error: message });
    }
  }));

  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  if (!turnRun?.id) res.end();
}
