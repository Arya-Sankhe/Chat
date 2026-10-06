import { HttpError } from "../http/responses.js";
import {
  COUNCIL_JUDGE_MODEL,
  generateNonce,
  judgeAnswerText,
  runCouncilJudge
} from "../saas/council.js";
import {
  reasoningDurationMetadata,
  sanitizeProviderEvent,
  streamProviderAndAccumulate
} from "../saas/messages.js";
import { withModelSystemPrompt } from "../saas/systemPrompt.js";
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

export async function handleCouncilConversationMessage({
  req,
  res,
  context,
  conversation,
  chatRequests,
  panelModels,
  originalPrompt,
  settings,
  modelClient,
  provider,
  webSearch,
  documentSearch,
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

  const sessionId = `cnc_${generateNonce()}_${generateNonce()}`;
  const panelistMessages = [];
  for (const [index, chatRequest] of chatRequests.entries()) {
    const baseMeta = { council: { sessionId, role: "panelist", stage: 1 } };
    const webMeta = sharedWebsearchMetadata(sharedSearch);
    const documentMeta = sharedDocumentMetadata(documentSearch);
    if (webMeta) baseMeta.websearch = webMeta;
    if (documentMeta) baseMeta.documents = documentMeta;
    panelistMessages.push(await createAssistantOutputMessage(context, {
      user_id: context.user.id,
      conversation_id: conversation.id,
      role: "assistant",
      model: chatRequest.model,
      content: "",
      reasoning: "",
      tool_calls: [],
      metadata: baseMeta
    }, { signal: req.signal, turnRun, outputSlot: `panel:${index}` }));
  }

  const controller = req.turnController || new AbortController();
  if (!turnRun?.id) {
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
  }

  startSse(res, turnRun?.id ? { "x-klui-turn-run-id": turnRun.id } : {});

  writeSse(res, {
    type: "council:start",
    sessionId,
    panel: panelModels,
    assistantMessageIds: panelistMessages.map((message) => message.id)
  });

  /* ── Stage 1 — independent responses ── */
  const panelistResults = panelistMessages.map((message, index) => ({
    message,
    chatRequest: chatRequests[index],
    accumulated: null,
    error: null
  }));

  await Promise.all(panelistResults.map(async (entry, index) => {
    writeSse(res, {
      type: "start",
      index,
      model: entry.chatRequest.model,
      assistantMessageId: entry.message.id,
      metadata: entry.message.metadata || null
    });

    try {
      const upstream = await modelClient.streamChatCompletion({
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        body: entry.chatRequest,
        providerId: provider?.id,
        signal: controller.signal
      });

      if (!upstream.body) throw new HttpError(502, `${provider.label} returned an empty response stream.`);

      const accumulated = await streamProviderAndAccumulate(upstream, (event) => {
        writeSse(res, {
          type: "delta",
          index,
          model: entry.chatRequest.model,
          event: sanitizeProviderEvent(event, { includeReasoning })
        });
      });

      if (!hasAssistantOutput(accumulated)) throw new HttpError(502, `${provider.label} returned an empty response.`);
      entry.accumulated = accumulated;

      const durationMeta = reasoningDurationMetadata(entry.message.metadata, accumulated);
      await updateAssistantOutputMessage(context, entry.message.id, {
        content: accumulated.content,
        reasoning: accumulated.reasoning,
        tool_calls: accumulated.toolCalls,
        finish_reason: accumulated.finishReason || null,
        error: null,
        ...(durationMeta ? { metadata: durationMeta } : {})
      }, { signal: req.signal, turnRun });

      writeSse(res, { type: "done", index, model: entry.chatRequest.model });
    } catch (error) {
      const aborted = error?.name === "AbortError";
      const message = aborted ? "Stopped by user." : error?.message || "Model request failed.";
      const partial = aborted ? error.partial : null;
      entry.error = message;
      if (aborted && partial) entry.accumulated = partial;
      await updateAssistantOutputMessage(context, entry.message.id, {
        ...(aborted ? {
          content: partial?.content || "",
          reasoning: partial?.reasoning || ""
        } : {}),
        error: message,
        finish_reason: "error"
      }, { ...(aborted ? {} : { signal: req.signal }), turnRun }).catch(() => {});
      writeSse(res, { type: "error", index, model: entry.chatRequest.model, error: message });
    }
  }));

  /* ── Stage 2 — the judge ranks the answers and writes the final one ── */
  const validPanelists = panelistResults
    .filter((entry) => !entry.error && entry.accumulated?.content?.trim())
    .map((entry) => ({
      modelId: entry.chatRequest.model,
      responseText: entry.accumulated.content,
      assistantMessageId: entry.message.id
    }));

  if (!validPanelists.length) {
    writeSse(res, { type: "council:peer:skipped", reason: "No valid panelist responses." });
    writeSse(res, { type: "council:chairman:skipped", reason: "No responses to synthesize." });
    await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
    if (!turnRun?.id) res.end();
    return;
  }

  // Saved on each panelist so a reloaded chat shows the judge's rank and note.
  async function saveRanking(ranked, status, reason = "") {
    const webMeta = sharedWebsearchMetadata(sharedSearch);
    const documentMeta = sharedDocumentMetadata(documentSearch);
    await Promise.all(validPanelists.map(async (panelist) => {
      const index = ranked ? ranked.ranking.indexOf(panelist.modelId) : -1;
      const entry = panelistResults.find((result) => result.message.id === panelist.assistantMessageId);
      const durationMeta = entry?.accumulated ? reasoningDurationMetadata(entry.message.metadata, entry.accumulated) : null;
      const note = ranked?.notes?.[panelist.modelId];
      await updateAssistantOutputMessage(context, panelist.assistantMessageId, {
        metadata: {
          ...(durationMeta || {}),
          ...(webMeta ? { websearch: webMeta } : {}),
          ...(documentMeta ? { documents: documentMeta } : {}),
          council: {
            sessionId,
            role: "panelist",
            stage: 1,
            peerReviewStatus: status,
            peerReviewReason: reason,
            judgeModel: COUNCIL_JUDGE_MODEL,
            peerRank: index >= 0 ? index + 1 : null,
            ballotCount: index >= 0 ? 1 : 0,
            peerJustifications: note ? { [COUNCIL_JUDGE_MODEL]: note } : {}
          }
        }
      }, { signal: req.signal, turnRun }).catch(() => {});
    }));
  }

  writeSse(res, { type: "council:peer:start", reviewers: [COUNCIL_JUDGE_MODEL] });

  const chairmanWebMeta = sharedWebsearchMetadata(sharedSearch);
  const chairmanDocumentMeta = sharedDocumentMetadata(documentSearch);
  const chairmanMessage = await createAssistantOutputMessage(context, {
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "assistant",
    model: COUNCIL_JUDGE_MODEL,
    content: "",
    reasoning: "",
    tool_calls: [],
    metadata: {
      council: {
        sessionId,
        role: "chairman",
        stage: 3,
        chairmanModel: COUNCIL_JUDGE_MODEL,
        panel: panelModels
      },
      ...(chairmanWebMeta ? { websearch: chairmanWebMeta } : {}),
      ...(chairmanDocumentMeta ? { documents: chairmanDocumentMeta } : {})
    }
  }, { signal: req.signal, turnRun, outputSlot: "chairman" });

  writeSse(res, {
    type: "council:chairman:start",
    chairmanModel: COUNCIL_JUDGE_MODEL,
    assistantMessageId: chairmanMessage.id,
    sessionId
  });

  let rankingSaved = null;
  const rankingDone = (ranked) => {
    if (ranked) {
      writeSse(res, {
        type: "council:peer:ballot",
        reviewerModel: COUNCIL_JUDGE_MODEL,
        valid: true,
        ranking: ranked.ranking,
        justifications: ranked.notes,
        error: null
      });
      writeSse(res, {
        type: "council:peer:done",
        borda: ranked.ranking.map((modelId, index) => ({
          modelId,
          bordaScore: ranked.ranking.length - 1 - index,
          ballotCount: 1,
          rank: index + 1
        }))
      });
      rankingSaved = saveRanking(ranked, "done");
    } else {
      const reason = "The judge's ranking couldn't be read.";
      writeSse(res, { type: "council:peer:skipped", reason });
      rankingSaved = saveRanking(null, "skipped", reason);
    }
  };

  try {
    const accumulated = await runCouncilJudge({
      originalUserPrompt: originalPrompt,
      panelists: validPanelists,
      context: [sharedSearch.contextMessage, documentSearch?.contextMessage].filter(Boolean).join("\n\n"),
      systemPrompt: withModelSystemPrompt(settings?.systemPrompt, COUNCIL_JUDGE_MODEL),
      provider,
      signal: controller.signal,
      maxTokens: settings?.max_tokens,
      streamChatCompletionFn: modelClient.streamChatCompletion,
      onRanking: rankingDone,
      onEvent: (event) => {
        writeSse(res, { type: "council:chairman:delta", event: sanitizeProviderEvent(event, { includeReasoning }) });
      }
    });
    await rankingSaved;

    if (!hasAssistantOutput(accumulated)) {
      throw new HttpError(502, "The council judge returned an empty answer.");
    }

    const chairmanDurationMeta = reasoningDurationMetadata(chairmanMessage.metadata, accumulated);
    await updateAssistantOutputMessage(context, chairmanMessage.id, {
      content: accumulated.content,
      reasoning: accumulated.reasoning,
      tool_calls: accumulated.toolCalls,
      finish_reason: accumulated.finishReason || null,
      error: null,
      ...(chairmanDurationMeta ? { metadata: chairmanDurationMeta } : {})
    }, { signal: req.signal, turnRun });

    writeSse(res, { type: "council:chairman:done", chairmanModel: COUNCIL_JUDGE_MODEL });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    const message = aborted ? "Stopped by user." : error?.message || "The council judge failed.";
    const partial = aborted ? error.partial : null;
    if (!rankingSaved) {
      writeSse(res, { type: "council:peer:error", error: message });
      await saveRanking(null, "error", message);
    } else {
      await rankingSaved;
    }
    await updateAssistantOutputMessage(context, chairmanMessage.id, {
      ...(aborted ? {
        content: judgeAnswerText(partial?.content),
        reasoning: partial?.reasoning || ""
      } : {}),
      error: message,
      finish_reason: "error"
    }, { ...(aborted ? {} : { signal: req.signal }), turnRun }).catch(() => {});
    writeSse(res, { type: "council:chairman:error", error: message });
  }

  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  if (!turnRun?.id) res.end();
}
