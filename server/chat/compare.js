import { HttpError } from "../http/responses.js";
import {
  contentText,
  reasoningDurationMetadata,
  sanitizeProviderEvent,
  streamProviderAndAccumulate,
  titleFromText
} from "../saas/messages.js";
import {
  hasAssistantOutput,
  injectWebContextMessage,
  sharedDocumentMetadata,
  sharedWebsearchMetadata,
  writeSse
} from "./shared.js";

export async function handleCompareConversationMessage({
  req,
  res,
  config,
  context,
  conversation,
  userContent,
  chatRequests,
  crofai,
  provider,
  webSearch,
  documentSearch
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
  for (const chatRequest of chatRequests) {
    const webMeta = sharedWebsearchMetadata(sharedSearch);
    const documentMeta = sharedDocumentMetadata(documentSearch);
    const baseMeta = {
      ...(webMeta ? { websearch: webMeta } : {}),
      ...(documentMeta ? { documents: documentMeta } : {})
    };
    assistantMessages.push(await context.db.insertMessage({
      user_id: context.user.id,
      conversation_id: conversation.id,
      role: "assistant",
      model: chatRequest.model,
      content: "",
      reasoning: "",
      tool_calls: [],
      metadata: baseMeta
    }, { signal: req.signal }));
  }

  if (!conversation.title || conversation.title === "New chat") {
    await context.db.updateConversation(context.user.id, conversation.id, {
      title: titleFromText(contentText(userContent)),
      model: chatRequests.map((request) => request.model).join(", ")
    }, { signal: req.signal });
  } else if (!conversation.model) {
    await context.db.updateConversation(context.user.id, conversation.id, {
      model: chatRequests.map((request) => request.model).join(", ")
    }, { signal: req.signal });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });

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
      const upstream = await crofai.streamChatCompletion({
        apiKey: provider?.apiKey || config.serverApiKey,
        baseUrl: provider?.baseUrl || config.defaultBaseUrl,
        body: chatRequest,
        providerId: provider?.id,
        signal: controller.signal
      });

      if (!upstream.body) throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response stream.`);

      const accumulated = await streamProviderAndAccumulate(upstream, (event) => {
        writeSse(res, {
          type: "delta",
          index,
          model: chatRequest.model,
          event: sanitizeProviderEvent(event, { includeReasoning })
        });
      });
      if (!hasAssistantOutput(accumulated)) {
        throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response.`);
      }

      const compareDurationMeta = reasoningDurationMetadata(assistantMessage.metadata, accumulated);
      await context.db.updateMessage(context.user.id, assistantMessage.id, {
        content: accumulated.content,
        reasoning: accumulated.reasoning,
        tool_calls: accumulated.toolCalls,
        finish_reason: accumulated.finishReason || null,
        ...(compareDurationMeta ? { metadata: compareDurationMeta } : {})
      }, { signal: req.signal });

      writeSse(res, { type: "done", index, model: chatRequest.model });
    } catch (error) {
      const aborted = error?.name === "AbortError";
      const message = aborted ? "Stopped by user." : error?.message || "Model request failed.";
      const partial = aborted ? error.partial : null;
      /* Drop req.signal on abort so the partial write is not cancelled by
         the already-aborted client request signal. */
      await context.db.updateMessage(context.user.id, assistantMessage.id, {
        ...(aborted ? {
          content: partial?.content || "",
          reasoning: partial?.reasoning || ""
        } : {}),
        error: message,
        finish_reason: "error"
      }, aborted ? {} : { signal: req.signal }).catch(() => {});
      writeSse(res, { type: "error", index, model: chatRequest.model, error: message });
    }
  }));

  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  res.end();
}
