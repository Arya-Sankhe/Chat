import { HttpError } from "../http/responses.js";
import {
  buildChairmanPrompt,
  generateNonce,
  runChairmanSynthesis,
  runPeerReview,
  selectChairman
} from "../saas/council.js";
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
  createAssistantOutputMessage,
  startSse,
  updateAssistantOutputMessage,
  writeSse
} from "./shared.js";

export async function handleCouncilConversationMessage({
  req,
  res,
  config,
  context,
  conversation,
  userContent,
  chatRequests,
  panelModels,
  originalPrompt,
  settings,
  chairmanOverride,
  crofai,
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

  if (!conversation.title || conversation.title === "New chat") {
    await context.db.updateConversation(context.user.id, conversation.id, {
      title: titleFromText(contentText(userContent)),
      model: panelModels.join(", ")
    }, { signal: req.signal });
  } else if (!conversation.model) {
    await context.db.updateConversation(context.user.id, conversation.id, {
      model: panelModels.join(", ")
    }, { signal: req.signal });
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
      const upstream = await crofai.streamChatCompletion({
        apiKey: provider?.apiKey || config.serverApiKey,
        baseUrl: provider?.baseUrl || config.defaultBaseUrl,
        body: entry.chatRequest,
        providerId: provider?.id,
        signal: controller.signal
      });

      if (!upstream.body) throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response stream.`);

      const accumulated = await streamProviderAndAccumulate(upstream, (event) => {
        writeSse(res, {
          type: "delta",
          index,
          model: entry.chatRequest.model,
          event: sanitizeProviderEvent(event, { includeReasoning })
        });
      });

      if (!hasAssistantOutput(accumulated)) throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response.`);
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

  /* ── Stage 2 — anonymized peer review ── */
  const validPanelists = panelistResults
    .filter((entry) => !entry.error && entry.accumulated?.content?.trim())
    .map((entry) => ({
      modelId: entry.chatRequest.model,
      responseText: entry.accumulated.content,
      assistantMessageId: entry.message.id
    }));

  let stage2 = { ballots: [], borda: [] };
  let peerReviewStatus = "pending";
  let peerReviewReason = "";
  async function persistPeerReviewMetadata() {
    const justificationsByModel = {};
    for (const ballot of stage2.ballots) {
      if (!ballot.valid) continue;
      for (const [modelId, reason] of Object.entries(ballot.justifications || {})) {
        if (!justificationsByModel[modelId]) justificationsByModel[modelId] = {};
        justificationsByModel[modelId][ballot.reviewerModelId] = reason;
      }
    }

    await Promise.all(validPanelists.map(async (panelist) => {
      const bordaRow = stage2.borda.find((row) => row.modelId === panelist.modelId);
      const hasBallot = Boolean(bordaRow && bordaRow.ballotCount > 0);
      const webMeta = sharedWebsearchMetadata(sharedSearch);
      const documentMeta = sharedDocumentMetadata(documentSearch);
      const panelEntry = panelistResults.find((entry) => entry.message.id === panelist.assistantMessageId);
      const durationMeta = panelEntry?.accumulated
        ? reasoningDurationMetadata(panelEntry.message.metadata, panelEntry.accumulated)
        : null;
      const meta = {
        ...(durationMeta || {}),
        ...(webMeta ? { websearch: webMeta } : {}),
        ...(documentMeta ? { documents: documentMeta } : {}),
        council: {
          sessionId,
          role: "panelist",
          stage: 1,
          peerReviewStatus,
          peerReviewReason,
          bordaScore: hasBallot ? bordaRow.bordaScore : null,
          ballotCount: bordaRow ? bordaRow.ballotCount : 0,
          peerRank: hasBallot ? bordaRow.rank : null,
          peerJustifications: justificationsByModel[panelist.modelId] || {}
        }
      };
      await updateAssistantOutputMessage(context, panelist.assistantMessageId, {
        metadata: meta
      }, { signal: req.signal, turnRun }).catch(() => {});
    }));
  }

  if (validPanelists.length >= 2) {
    writeSse(res, {
      type: "council:peer:start",
      reviewers: validPanelists.map((p) => p.modelId)
    });

    try {
      stage2 = await runPeerReview({
        panelists: validPanelists,
        originalUserPrompt: originalPrompt,
        config,
        provider,
        signal: controller.signal,
        chatCompletionFn: crofai.chatCompletion,
        onBallot: (ballot) => {
          writeSse(res, {
            type: "council:peer:ballot",
            reviewerModel: ballot.reviewerModelId,
            valid: ballot.valid,
            ranking: ballot.ranking,
            justifications: ballot.justifications,
            error: ballot.error || null
          });
        }
      });

      if (stage2.ballots.some((ballot) => ballot.valid)) {
        peerReviewStatus = "done";
      } else {
        peerReviewStatus = "skipped";
        peerReviewReason = "Peer review could not produce reliable rankings.";
        stage2 = { ...stage2, borda: [] };
      }

      if (peerReviewStatus === "skipped") {
        writeSse(res, { type: "council:peer:skipped", reason: peerReviewReason });
      } else {
        writeSse(res, {
          type: "council:peer:done",
          borda: stage2.borda.map((row) => ({
            modelId: row.modelId,
            bordaScore: row.bordaScore,
            ballotCount: row.ballotCount,
            rank: row.rank
          }))
        });
      }
    } catch (error) {
      peerReviewStatus = "error";
      if (error?.name === "AbortError") {
        peerReviewReason = "Stopped by user.";
      } else {
        peerReviewReason = error?.message || "Peer review failed.";
      }
      writeSse(res, { type: "council:peer:error", error: peerReviewReason });
      stage2 = { ballots: [], borda: [] };
    }

    /* Persist peer review metadata onto each panelist message so the UI can
       reload council results without re-running peer review. */
    await persistPeerReviewMetadata();
  } else if (validPanelists.length === 1) {
    peerReviewStatus = "skipped";
    peerReviewReason = "Only one valid panelist response.";
    writeSse(res, { type: "council:peer:skipped", reason: peerReviewReason });
    await persistPeerReviewMetadata();
  } else {
    writeSse(res, { type: "council:peer:skipped", reason: "No valid panelist responses." });
  }

  /* ── Stage 3 — chairman synthesis ── */
  if (!validPanelists.length) {
    writeSse(res, { type: "council:chairman:skipped", reason: "No responses to synthesize." });
    await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
    if (!turnRun?.id) res.end();
    return;
  }

  const chairmanModel = selectChairman({
    override: chairmanOverride,
    borda: stage2.borda,
    defaultModel: settings?.preferredModel || panelModels[0],
    panelists: validPanelists
  });

  const chairmanWebMeta = sharedWebsearchMetadata(sharedSearch);
  const chairmanDocumentMeta = sharedDocumentMetadata(documentSearch);
  const chairmanMessage = await createAssistantOutputMessage(context, {
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "assistant",
    model: chairmanModel,
    content: "",
    reasoning: "",
    tool_calls: [],
    metadata: {
      council: {
        sessionId,
        role: "chairman",
        stage: 3,
        chairmanModel,
        panel: panelModels
      },
      ...(chairmanWebMeta ? { websearch: chairmanWebMeta } : {}),
      ...(chairmanDocumentMeta ? { documents: chairmanDocumentMeta } : {})
    }
  }, { signal: req.signal, turnRun, outputSlot: "chairman" });

  writeSse(res, {
    type: "council:chairman:start",
    chairmanModel,
    assistantMessageId: chairmanMessage.id,
    sessionId
  });

  try {
    const chairmanPrompt = buildChairmanPrompt({
      originalUserPrompt: originalPrompt,
      panelists: validPanelists,
      borda: stage2.borda
    });

    const sharedContexts = [sharedSearch.contextMessage, documentSearch?.contextMessage].filter(Boolean).join("\n\n");
    const chairmanPromptWithContext = sharedContexts
      ? `${sharedContexts}\n\n${chairmanPrompt}`
      : chairmanPrompt;
    const chairmanSystemPrompt = settings?.systemPrompt || "";

    const accumulated = await runChairmanSynthesis({
      chairmanModel,
      prompt: chairmanPromptWithContext,
      systemPrompt: chairmanSystemPrompt,
      config,
      provider,
      signal: controller.signal,
      reasoningEffort: settings?.reasoning_effort,
      maxTokens: settings?.max_tokens,
      streamChatCompletionFn: crofai.streamChatCompletion,
      onEvent: (event) => {
        writeSse(res, { type: "council:chairman:delta", event: sanitizeProviderEvent(event, { includeReasoning }) });
      }
    });

    if (!hasAssistantOutput(accumulated)) {
      throw new HttpError(502, "Chairman returned an empty response.");
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

    writeSse(res, { type: "council:chairman:done", chairmanModel });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    const message = aborted ? "Stopped by user." : error?.message || "Chairman synthesis failed.";
    const partial = aborted ? error.partial : null;
    await updateAssistantOutputMessage(context, chairmanMessage.id, {
      ...(aborted ? {
        content: partial?.content || "",
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
