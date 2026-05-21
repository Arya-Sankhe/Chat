import { requireUser } from "./auth/supabase.js";
import { listModels } from "./crofai/client.js";
import { normalizeBaseUrl } from "./crofai/constants.js";
import { normalizeChatRequest } from "./crofai/normalize.js";
import { SupabaseRest } from "./db/supabaseRest.js";
import { configuredServices } from "./config.js";
import { HttpError, parseJsonBody, sendJson, sendProblem } from "./http/responses.js";
import { getCurrentEntitlement, requireActiveEntitlement } from "./saas/entitlements.js";
import {
  buildChairmanPrompt,
  generateNonce,
  runChairmanSynthesis,
  runPeerReview,
  selectChairman,
  withCouncilSystemPrompt
} from "./saas/council.js";
import {
  applyImageDescriptionsToContent,
  collectImageDescriptions,
  collectUndescribedImageAttachmentIds,
  describeConversationImages,
  messagesHaveImages
} from "./saas/images.js";
import {
  buildProviderMessages,
  buildStoredUserContent,
  contentText,
  hydrateMessagesForClient,
  imageCountFromContent,
  normalizeMessageSettings,
  pipeProviderStreamAndAccumulate,
  streamProviderAndAccumulate,
  titleFromText
} from "./saas/messages.js";
import { modelSupportsVision, resolveVisionDescribeModel } from "./saas/models.js";
import { publicPlan } from "./saas/plans.js";
import { createCrofaiUsageMeter } from "./saas/usageMeter.js";
import { assertImageUpload, R2Client } from "./storage/r2.js";

const COUNCIL_MIN_MODELS = 2;
const COUNCIL_MAX_MODELS = 4;

const modelCache = new Map();
const modelCacheTtlMs = 5 * 60 * 1000;

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean);
}

function bearerContext(config) {
  return {
    db: new SupabaseRest(config),
    r2: new R2Client(config)
  };
}

async function authContext(req, config) {
  const services = bearerContext(config);
  const user = await requireUser(req, config);
  const profile = await services.db.upsertProfile(user, { signal: req.signal });
  return { ...services, user, profile };
}

async function requireChatContext(req, config) {
  const context = await authContext(req, config);
  const entitlement = await requireActiveEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
    access: config.access,
    signal: req.signal
  });

  return { ...context, ...entitlement };
}

function requireServerCrofKey(config) {
  if (!config.serverApiKey) {
    throw new HttpError(503, "Smartyfy model API key is not configured on the server.");
  }
}

function publicMe({ user, profile, subscription, plan, usage, config }) {
  return {
    user: { id: user.id, email: user.email },
    profile: {
      role: profile?.role || "user"
    },
    subscription: subscription ? {
      status: subscription.status,
      planId: subscription.plan_id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    } : null,
    plan: plan ? publicPlan(plan) : null,
    usage: usage || { message_count: 0, image_count: 0 },
    access: {
      mode: config.access.mode,
      active: Boolean(plan)
    },
    services: configuredServices(config)
  };
}

async function handleMe(req, res, config) {
  const context = await authContext(req, config);
  const entitlement = await getCurrentEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
    access: config.access,
    signal: req.signal
  });
  const usage = await context.db.getTodayUsage(context.user.id, { signal: req.signal });
  sendJson(res, 200, publicMe({
    ...context,
    subscription: entitlement.subscription,
    plan: entitlement.plan,
    usage,
    config
  }));
}

async function handleModels(req, res, config) {
  requireServerCrofKey(config);
  const context = await requireChatContext(req, config);

  const baseUrl = normalizeBaseUrl(urlSafeSearch(req, "baseUrl") || config.defaultBaseUrl);
  const cached = modelCache.get(baseUrl);
  if (cached && Date.now() - cached.fetchedAt < modelCacheTtlMs) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const dbCached = await context.db.getModelCache(baseUrl, { signal: req.signal });
  if (dbCached && Date.now() - new Date(dbCached.fetched_at).getTime() < modelCacheTtlMs) {
    modelCache.set(baseUrl, { payload: dbCached.payload, fetchedAt: new Date(dbCached.fetched_at).getTime() });
    sendJson(res, 200, dbCached.payload);
    return;
  }

  const payload = await listModels({ apiKey: config.serverApiKey, baseUrl, signal: req.signal });
  modelCache.set(baseUrl, { payload, fetchedAt: Date.now() });
  await context.db.upsertModelCache(baseUrl, payload, { signal: req.signal });
  sendJson(res, 200, payload);
}

function urlSafeSearch(req, key) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    return url.searchParams.get(key);
  } catch {
    return "";
  }
}

async function handlePresignUpload(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);

  assertImageUpload({
    contentType: body.contentType,
    sizeBytes: Number(body.sizeBytes)
  }, config.r2.maxImageBytes);

  const objectKey = context.r2.objectKey({ userId: context.user.id, fileName: body.fileName });
  const attachment = await context.db.createAttachment({
    user_id: context.user.id,
    object_key: objectKey,
    file_name: String(body.fileName || "upload"),
    content_type: body.contentType,
    size_bytes: Number(body.sizeBytes),
    status: "pending"
  }, { signal: req.signal });

  sendJson(res, 200, {
    uploadId: attachment.id,
    objectKey,
    uploadUrl: context.r2.uploadUrl(objectKey),
    method: "PUT",
    maxImageBytes: config.r2.maxImageBytes
  });
}

async function handleCompleteUpload(req, res, config) {
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  const attachment = await context.db.getAttachment(context.user.id, body.uploadId, { signal: req.signal });
  if (!attachment) throw new HttpError(404, "Upload not found.");
  if (attachment.status !== "pending") throw new HttpError(400, "Upload was already completed.");

  const head = await context.r2.headObject(attachment.object_key, { signal: req.signal });
  assertImageUpload({
    contentType: attachment.content_type,
    sizeBytes: head.sizeBytes || attachment.size_bytes
  }, config.r2.maxImageBytes);

  const completed = await context.db.completeAttachment(context.user.id, attachment.id, {
    size_bytes: head.sizeBytes || attachment.size_bytes,
    etag: head.etag || null
  }, { signal: req.signal });

  sendJson(res, 200, {
    id: completed.id,
    fileName: completed.file_name,
    contentType: completed.content_type,
    sizeBytes: completed.size_bytes
  });
}

async function handleConversations(req, res, config) {
  const context = await requireChatContext(req, config);
  if (req.method === "GET") {
    const conversations = await context.db.listConversations(context.user.id, { signal: req.signal });
    sendJson(res, 200, { conversations });
    return;
  }

  if (req.method === "POST") {
    const body = await parseJsonBody(req);
    const conversation = await context.db.createConversation(context.user.id, {
      title: body.title || "New chat",
      model: body.model || ""
    }, { signal: req.signal });
    sendJson(res, 201, { conversation });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

async function handleConversationById(req, res, config, conversationId) {
  const context = await requireChatContext(req, config);
  const conversation = await context.db.getConversation(context.user.id, conversationId, { signal: req.signal });
  if (!conversation) throw new HttpError(404, "Conversation not found.");

  if (req.method === "GET") {
    const messages = await context.db.listMessages(context.user.id, conversation.id, { signal: req.signal });
    sendJson(res, 200, {
      conversation,
      messages: await hydrateMessagesForClient(messages, context.r2)
    });
    return;
  }

  if (req.method === "DELETE") {
    const attachments = await context.db.listConversationAttachments(context.user.id, conversation.id, { signal: req.signal });
    await context.r2.deleteObjects(attachments.map((attachment) => attachment.object_key), { signal: req.signal });
    await context.db.deleteConversation(context.user.id, conversation.id, { signal: req.signal });
    sendJson(res, 200, { deleted: true, deletedImages: attachments.length });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
}

async function handleMessageById(req, res, config, messageId) {
  if (req.method !== "DELETE") throw new HttpError(405, "Method not allowed.");

  const context = await requireChatContext(req, config);
  const attachments = await context.db.listMessageAttachments(context.user.id, messageId, { signal: req.signal });
  await context.r2.deleteObjects(attachments.map((attachment) => attachment.object_key), { signal: req.signal });

  const message = await context.db.deleteMessage(context.user.id, messageId, { signal: req.signal });
  if (!message) throw new HttpError(404, "Message not found.");

  sendJson(res, 200, { deleted: true, deletedImages: attachments.length });
}

async function loadUploadedAttachments(context, attachmentIds, req, plan) {
  const ids = Array.isArray(attachmentIds) ? attachmentIds.filter(Boolean).slice(0, plan.maxImagesPerMessage + 1) : [];
  if (ids.length > plan.maxImagesPerMessage) {
    throw new HttpError(400, `Attach up to ${plan.maxImagesPerMessage} images for this plan.`);
  }

  const attachments = [];
  for (const id of ids) {
    const attachment = await context.db.getAttachment(context.user.id, id, { signal: req.signal });
    if (!attachment || attachment.status !== "uploaded") {
      throw new HttpError(400, "One of the selected uploads is not ready.");
    }
    attachments.push(attachment);
  }

  return attachments;
}

function normalizeCompareModels(value) {
  if (!Array.isArray(value)) return [];

  const models = [];
  for (const item of value) {
    if (typeof item !== "string") throw new HttpError(400, "Compare models must be strings.");
    const id = item.trim();
    if (!id || models.includes(id)) continue;
    models.push(id);
    if (models.length > 4) throw new HttpError(400, "Compare up to 4 models.");
  }

  if (models.length === 1) throw new HttpError(400, "Pick at least 2 models to compare.");
  return models;
}

function normalizeCouncilFlag(value) {
  return Boolean(value === true || value === "true" || value === 1 || value === "1");
}

function writeSse(res, payload) {
  if (res.destroyed || res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function hasAssistantOutput(accumulated) {
  return Boolean(
    String(accumulated?.content || "").trim() ||
    (Array.isArray(accumulated?.toolCalls) && accumulated.toolCalls.length)
  );
}

async function persistImageDescriptions({ db, userId, existingMessages, userContent, descriptions, signal }) {
  const nextMessages = [];
  for (const message of existingMessages) {
    const nextContent = applyImageDescriptionsToContent(message.content, descriptions);
    if (nextContent !== message.content) {
      await db.updateMessage(userId, message.id, { content: nextContent }, { signal });
      nextMessages.push({ ...message, content: nextContent });
    } else {
      nextMessages.push(message);
    }
  }

  return {
    existingMessages: nextMessages,
    userContent: applyImageDescriptionsToContent(userContent, descriptions)
  };
}

async function handleCouncilConversationMessage({
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
  crofai
}) {
  const sessionId = `cnc_${generateNonce()}_${generateNonce()}`;
  const panelistMessages = [];
  for (const chatRequest of chatRequests) {
    panelistMessages.push(await context.db.insertMessage({
      user_id: context.user.id,
      conversation_id: conversation.id,
      role: "assistant",
      model: chatRequest.model,
      content: "",
      reasoning: "",
      tool_calls: [],
      metadata: { council: { sessionId, role: "panelist", stage: 1 } }
    }, { signal: req.signal }));
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
      assistantMessageId: entry.message.id
    });

    try {
      const upstream = await crofai.streamChatCompletion({
        apiKey: config.serverApiKey,
        baseUrl: config.defaultBaseUrl,
        body: entry.chatRequest,
        signal: controller.signal
      });

      if (!upstream.body) throw new HttpError(502, "Smartyfy returned an empty response stream.");

      const accumulated = await streamProviderAndAccumulate(upstream, (event) => {
        writeSse(res, { type: "delta", index, model: entry.chatRequest.model, event });
      });

      if (!hasAssistantOutput(accumulated)) throw new HttpError(502, "Smartyfy returned an empty response.");
      entry.accumulated = accumulated;

      await context.db.updateMessage(context.user.id, entry.message.id, {
        content: accumulated.content,
        reasoning: accumulated.reasoning,
        tool_calls: accumulated.toolCalls,
        finish_reason: accumulated.finishReason || null
      }, { signal: req.signal });

      writeSse(res, { type: "done", index, model: entry.chatRequest.model });
    } catch (error) {
      const message = error?.name === "AbortError" ? "Stopped by user." : error?.message || "Model request failed.";
      entry.error = message;
      await context.db.updateMessage(context.user.id, entry.message.id, {
        error: message,
        finish_reason: "error"
      }, { signal: req.signal }).catch(() => {});
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
      const meta = {
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
      await context.db.updateMessage(context.user.id, panelist.assistantMessageId, {
        metadata: meta
      }, { signal: req.signal }).catch(() => {});
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
    res.end();
    return;
  }

  const chairmanModel = selectChairman({
    override: chairmanOverride,
    borda: stage2.borda,
    defaultModel: settings?.preferredModel || panelModels[0],
    panelists: validPanelists
  });

  const chairmanMessage = await context.db.insertMessage({
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
      }
    }
  }, { signal: req.signal });

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

    const accumulated = await runChairmanSynthesis({
      chairmanModel,
      prompt: chairmanPrompt,
      systemPrompt: settings?.systemPrompt || "",
      config,
      signal: controller.signal,
      reasoningEffort: settings?.reasoning_effort,
      maxTokens: settings?.max_tokens,
      streamChatCompletionFn: crofai.streamChatCompletion,
      onEvent: (event) => {
        writeSse(res, { type: "council:chairman:delta", event });
      }
    });

    if (!hasAssistantOutput(accumulated)) {
      throw new HttpError(502, "Chairman returned an empty response.");
    }

    await context.db.updateMessage(context.user.id, chairmanMessage.id, {
      content: accumulated.content,
      reasoning: accumulated.reasoning,
      tool_calls: accumulated.toolCalls,
      finish_reason: accumulated.finishReason || null
    }, { signal: req.signal });

    writeSse(res, { type: "council:chairman:done", chairmanModel });
  } catch (error) {
    const message = error?.name === "AbortError" ? "Stopped by user." : error?.message || "Chairman synthesis failed.";
    await context.db.updateMessage(context.user.id, chairmanMessage.id, {
      error: message,
      finish_reason: "error"
    }, { signal: req.signal }).catch(() => {});
    writeSse(res, { type: "council:chairman:error", error: message });
  }

  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  res.end();
}

async function handleCompareConversationMessage({
  req,
  res,
  config,
  context,
  conversation,
  userContent,
  chatRequests,
  crofai
}) {
  const assistantMessages = [];
  for (const chatRequest of chatRequests) {
    assistantMessages.push(await context.db.insertMessage({
      user_id: context.user.id,
      conversation_id: conversation.id,
      role: "assistant",
      model: chatRequest.model,
      content: "",
      reasoning: "",
      tool_calls: []
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
      assistantMessageId: assistantMessage.id
    });

    try {
      const upstream = await crofai.streamChatCompletion({
        apiKey: config.serverApiKey,
        baseUrl: config.defaultBaseUrl,
        body: chatRequest,
        signal: controller.signal
      });

      if (!upstream.body) throw new HttpError(502, "Smartyfy returned an empty response stream.");

      const accumulated = await streamProviderAndAccumulate(upstream, (event) => {
        writeSse(res, { type: "delta", index, model: chatRequest.model, event });
      });
      if (!hasAssistantOutput(accumulated)) {
        throw new HttpError(502, "Smartyfy returned an empty response.");
      }

      await context.db.updateMessage(context.user.id, assistantMessage.id, {
        content: accumulated.content,
        reasoning: accumulated.reasoning,
        tool_calls: accumulated.toolCalls,
        finish_reason: accumulated.finishReason || null
      }, { signal: req.signal });

      writeSse(res, { type: "done", index, model: chatRequest.model });
    } catch (error) {
      const message = error?.name === "AbortError" ? "Stopped by user." : error?.message || "Model request failed.";
      await context.db.updateMessage(context.user.id, assistantMessage.id, {
        error: message,
        finish_reason: "error"
      }, { signal: req.signal }).catch(() => {});
      writeSse(res, { type: "error", index, model: chatRequest.model, error: message });
    }
  }));

  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  res.end();
}

async function handleConversationMessage(req, res, config, conversationId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireServerCrofKey(config);

  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req, 2 * 1024 * 1024);
  const conversation = await context.db.getConversation(context.user.id, conversationId, { signal: req.signal });
  if (!conversation) throw new HttpError(404, "Conversation not found.");

  const attachments = await loadUploadedAttachments(context, body.attachments, req, context.plan);
  let userContent = buildStoredUserContent(body.text, attachments);
  const imageCount = imageCountFromContent(userContent);
  const compareModels = normalizeCompareModels(body.models);
  const councilEnabled = normalizeCouncilFlag(body.council);
  if (councilEnabled) {
    if (compareModels.length < COUNCIL_MIN_MODELS) {
      throw new HttpError(400, `Pick at least ${COUNCIL_MIN_MODELS} models for the council.`);
    }
    if (compareModels.length > COUNCIL_MAX_MODELS) {
      throw new HttpError(400, `Council supports up to ${COUNCIL_MAX_MODELS} models.`);
    }
  }
  const settings = normalizeMessageSettings(body);
  const crofai = createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    imageCount,
    signal: req.signal
  });
  let existingMessages = await context.db.listMessages(context.user.id, conversation.id, { signal: req.signal });
  let historyMessages = [...existingMessages, { role: "user", content: userContent }];
  const compareNeedsImageDescribe = compareModels.length > 0
    && messagesHaveImages(historyMessages)
    && compareModels.some((model) => !modelSupportsVision(model));

  let imageDescriptions = compareNeedsImageDescribe ? collectImageDescriptions(historyMessages) : null;
  let describeModelUsed = null;
  let missingDescriptionIds = [];
  if (compareNeedsImageDescribe) {
    missingDescriptionIds = collectUndescribedImageAttachmentIds(historyMessages);
    if (missingDescriptionIds.length && !body.describeImages) {
      throw new HttpError(409, "Compare includes text-only models, but this chat has images. Describe images or start a new chat.");
    }

    if (missingDescriptionIds.length) {
      describeModelUsed = resolveVisionDescribeModel(config, compareModels);
      if (!modelSupportsVision(describeModelUsed)) {
        throw new HttpError(503, "No vision model is configured to describe chat images.");
      }
    }
  }

  const responseModels = compareModels.length ? compareModels : [body.model || conversation.model];
  for (const model of responseModels) {
    normalizeChatRequest({
      model,
      messages: [{ role: "user", content: "preflight" }],
      ...settings
    });
  }

  if (missingDescriptionIds.length) {
    const describeResult = await describeConversationImages({
      messages: historyMessages,
      db: context.db,
      userId: context.user.id,
      r2: context.r2,
      config,
      modelIds: compareModels,
      attachmentIds: missingDescriptionIds,
      describeModel: describeModelUsed,
      chatCompletionFn: crofai.chatCompletion,
      signal: req.signal
    });
    imageDescriptions = { ...imageDescriptions, ...describeResult.descriptions };

    const persisted = await persistImageDescriptions({
      db: context.db,
      userId: context.user.id,
      existingMessages,
      userContent,
      descriptions: imageDescriptions,
      signal: req.signal
    });
    existingMessages = persisted.existingMessages;
    userContent = persisted.userContent;
    historyMessages = [...existingMessages, { role: "user", content: userContent }];
  }

  const stage1SystemPrompt = councilEnabled
    ? withCouncilSystemPrompt(settings.systemPrompt || "")
    : (settings.systemPrompt || "");

  async function providerMessagesForModel(model) {
    return buildProviderMessages({
      messages: historyMessages,
      systemPrompt: stage1SystemPrompt,
      r2: context.r2,
      imageDescriptions: compareNeedsImageDescribe && !modelSupportsVision(model) ? imageDescriptions : null
    });
  }

  const chatRequests = compareModels.length
    ? await Promise.all(compareModels.map(async (model) => normalizeChatRequest({
        model,
        messages: await providerMessagesForModel(model),
        ...settings
      })))
    : [normalizeChatRequest({
        model: body.model || conversation.model,
        messages: await providerMessagesForModel(body.model || conversation.model),
        ...settings
      })];

  const userMessage = await context.db.insertMessage({
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "user",
    content: userContent
  }, { signal: req.signal });

  for (const attachment of attachments) {
    await context.db.updateAttachment(context.user.id, attachment.id, {
      conversation_id: conversation.id,
      message_id: userMessage.id
    }, { signal: req.signal });
  }

  if (councilEnabled) {
    await handleCouncilConversationMessage({
      req,
      res,
      config,
      context,
      conversation,
      userContent,
      chatRequests,
      panelModels: compareModels,
      originalPrompt: contentText(userContent),
      settings: {
        systemPrompt: settings.systemPrompt || "",
        reasoning_effort: settings.reasoning_effort,
        max_tokens: settings.max_tokens,
        preferredModel: body.model
      },
      chairmanOverride: typeof body.chairmanModel === "string" ? body.chairmanModel.trim() : "",
      crofai
    });
    return;
  }

  if (compareModels.length) {
    await handleCompareConversationMessage({
      req,
      res,
      config,
      context,
      conversation,
      userContent,
      chatRequests,
      crofai
    });
    return;
  }

  const chatRequest = chatRequests[0];

  const assistantMessage = await context.db.insertMessage({
    user_id: context.user.id,
    conversation_id: conversation.id,
    role: "assistant",
    model: chatRequest.model,
    content: "",
    reasoning: "",
    tool_calls: []
  }, { signal: req.signal });

  if (!conversation.title || conversation.title === "New chat") {
    await context.db.updateConversation(context.user.id, conversation.id, {
      title: titleFromText(contentText(userContent)),
      model: chatRequest.model
    }, { signal: req.signal });
  } else if (!conversation.model) {
    await context.db.updateConversation(context.user.id, conversation.id, { model: chatRequest.model }, { signal: req.signal });
  }

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstream = await crofai.streamChatCompletion({
      apiKey: config.serverApiKey,
      baseUrl: config.defaultBaseUrl,
      body: chatRequest,
      signal: controller.signal
    });

    if (!upstream.body) throw new HttpError(502, "Smartyfy returned an empty response stream.");

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-smartyfy-user-message-id": userMessage.id,
      "x-smartyfy-assistant-message-id": assistantMessage.id
    });

    const accumulated = await pipeProviderStreamAndAccumulate(upstream, res);
    if (!hasAssistantOutput(accumulated)) {
      throw new HttpError(502, "Smartyfy returned an empty response.");
    }
    await context.db.updateMessage(context.user.id, assistantMessage.id, {
      content: accumulated.content,
      reasoning: accumulated.reasoning,
      tool_calls: accumulated.toolCalls,
      finish_reason: accumulated.finishReason || null
    }, { signal: req.signal });
    await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
    res.end();
  } catch (error) {
    const message = error?.name === "AbortError" ? "Stopped by user." : error?.message || "Model request failed.";
    await context.db.updateMessage(context.user.id, assistantMessage.id, {
      error: message,
      finish_reason: "error"
    }, { signal: req.signal }).catch(() => {});
    if (res.headersSent) {
      writeSse(res, { type: "error", error: message });
      res.end();
      return;
    }
    throw error;
  }
}

async function handleAdminSummary(req, res, config) {
  const context = await authContext(req, config);
  if (context.profile?.role !== "admin") throw new HttpError(403, "Admin access is required.");
  sendJson(res, 200, await context.db.adminSummary({ signal: req.signal }));
}

export async function handleApiRequest(req, res, url, config) {
  try {
    const parts = pathParts(url);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: "smartyfy-chat",
        services: configuredServices(config)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, {
        app: "smartyfy-chat",
        supabaseUrl: config.supabase.url,
        supabaseAnonKey: config.supabase.anonKey,
        auth: config.auth,
        defaultBaseUrl: config.defaultBaseUrl,
        services: configuredServices(config)
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/plans") {
      sendJson(res, 200, { plans: config.plans.map(publicPlan) });
      return;
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      await handleMe(req, res, config);
      return;
    }

    if (url.pathname === "/api/models" && req.method === "GET") {
      await handleModels(req, res, config);
      return;
    }

    if (url.pathname === "/api/uploads/presign" && req.method === "POST") {
      await handlePresignUpload(req, res, config);
      return;
    }

    if (url.pathname === "/api/uploads/complete" && req.method === "POST") {
      await handleCompleteUpload(req, res, config);
      return;
    }

    if (url.pathname === "/api/conversations") {
      await handleConversations(req, res, config);
      return;
    }

    if (parts[0] === "api" && parts[1] === "conversations" && parts[2] && !parts[3]) {
      await handleConversationById(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "conversations" && parts[2] && parts[3] === "messages") {
      await handleConversationMessage(req, res, config, parts[2]);
      return;
    }

    if (parts[0] === "api" && parts[1] === "messages" && parts[2] && !parts[3]) {
      await handleMessageById(req, res, config, parts[2]);
      return;
    }

    if (url.pathname === "/api/admin/summary" && req.method === "GET") {
      await handleAdminSummary(req, res, config);
      return;
    }

    if (url.pathname === "/api/chat") {
      throw new HttpError(410, "Use /api/conversations/:id/messages for managed Smartyfy chat.");
    }

    throw new HttpError(404, "API route not found.");
  } catch (error) {
    sendProblem(res, error);
  }
}
