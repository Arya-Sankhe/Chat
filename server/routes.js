import { requireUser } from "./auth/supabase.js";
import { StripeClient, subscriptionRecordFromStripe, verifyStripeSignature } from "./billing/stripe.js";
import { listModels, streamChatCompletion } from "./crofai/client.js";
import { normalizeBaseUrl } from "./crofai/constants.js";
import { normalizeChatRequest } from "./crofai/normalize.js";
import { SupabaseRest } from "./db/supabaseRest.js";
import { configuredServices } from "./config.js";
import { HttpError, parseJsonBody, readRawBody, sendJson, sendProblem } from "./http/responses.js";
import { consumeUsageOrThrow, requireActiveEntitlement } from "./saas/entitlements.js";
import {
  buildProviderMessages,
  buildStoredUserContent,
  contentText,
  hydrateMessagesForClient,
  imageCountFromContent,
  normalizeMessageSettings,
  pipeProviderStreamAndAccumulate,
  titleFromText
} from "./saas/messages.js";
import { publicPlan } from "./saas/plans.js";
import { assertImageUpload, R2Client } from "./storage/r2.js";

const modelCache = new Map();
const modelCacheTtlMs = 5 * 60 * 1000;

function pathParts(url) {
  return url.pathname.split("/").filter(Boolean);
}

function bearerContext(config) {
  return {
    db: new SupabaseRest(config),
    stripe: new StripeClient(config),
    r2: new R2Client(config)
  };
}

async function authContext(req, config) {
  const services = bearerContext(config);
  const user = await requireUser(req, config);
  const profile = await services.db.upsertProfile(user, { signal: req.signal });
  return { ...services, user, profile };
}

async function requirePaidContext(req, config) {
  const context = await authContext(req, config);
  const entitlement = await requireActiveEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
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
      role: profile?.role || "user",
      stripeCustomerId: profile?.stripe_customer_id || ""
    },
    subscription: subscription ? {
      status: subscription.status,
      planId: subscription.plan_id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    } : null,
    plan: plan ? publicPlan(plan) : null,
    usage: usage || { message_count: 0, image_count: 0 },
    services: configuredServices(config)
  };
}

async function handleMe(req, res, config) {
  const context = await authContext(req, config);
  const subscription = await context.db.getLatestSubscription(context.user.id, { signal: req.signal });
  const plan = config.plans.find((item) => item.id === subscription?.plan_id) || null;
  const usage = await context.db.getTodayUsage(context.user.id, { signal: req.signal });
  sendJson(res, 200, publicMe({ ...context, subscription, plan, usage, config }));
}

async function handleCheckout(req, res, config) {
  const context = await authContext(req, config);
  const body = await parseJsonBody(req);
  const plan = config.plans.find((item) => item.id === body.planId);
  if (!plan) throw new HttpError(400, "Choose a valid Smartyfy plan.");
  if (!plan.stripePriceId) throw new HttpError(503, "This plan is missing its Stripe price ID.");

  let profile = context.profile;
  let customerId = profile?.stripe_customer_id || "";

  if (!customerId) {
    const customer = await context.stripe.createCustomer({
      email: context.user.email,
      userId: context.user.id
    }, { signal: req.signal });
    customerId = customer.id;
    profile = await context.db.updateProfile(context.user.id, { stripe_customer_id: customerId }, { signal: req.signal });
  }

  const session = await context.stripe.createCheckoutSession({
    customerId,
    customerEmail: context.user.email,
    priceId: plan.stripePriceId,
    planId: plan.id,
    userId: context.user.id,
    successUrl: config.stripe.successUrl,
    cancelUrl: config.stripe.cancelUrl
  }, { signal: req.signal });

  sendJson(res, 200, { url: session.url });
}

async function handlePortal(req, res, config) {
  const context = await authContext(req, config);
  const customerId = context.profile?.stripe_customer_id;
  if (!customerId) throw new HttpError(400, "No billing customer exists yet.");

  const session = await context.stripe.createPortalSession({
    customerId,
    returnUrl: config.stripe.portalReturnUrl
  }, { signal: req.signal });

  sendJson(res, 200, { url: session.url });
}

async function syncStripeSubscription({ db, stripe, config, subscription, fallbackUserId, signal }) {
  const customerId = subscription?.customer || "";
  const profile = customerId ? await db.getProfileByStripeCustomer(customerId, { signal }) : null;
  const record = subscriptionRecordFromStripe(subscription, config.plans, fallbackUserId || profile?.id || "");
  if (!profile && fallbackUserId) {
    await db.updateProfile(fallbackUserId, { stripe_customer_id: record.stripe_customer_id }, { signal });
  }
  return db.upsertSubscription(record, { signal });
}

async function handleStripeWebhook(req, res, config) {
  if (!config.stripe.webhookSecret) throw new HttpError(503, "Stripe webhook secret is not configured.");

  const { db, stripe } = bearerContext(config);
  const raw = await readRawBody(req, 1024 * 1024);
  verifyStripeSignature(raw, req.headers["stripe-signature"], config.stripe.webhookSecret);

  const event = JSON.parse(raw.toString("utf8"));
  if (await db.hasWebhookEvent(event.id, { signal: req.signal })) {
    sendJson(res, 200, { received: true, duplicate: true });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    if (session.subscription) {
      const subscription = await stripe.retrieveSubscription(session.subscription, { signal: req.signal });
      await syncStripeSubscription({
        db,
        stripe,
        config,
        subscription,
        fallbackUserId: session.client_reference_id || session.metadata?.user_id || "",
        signal: req.signal
      });
    }
  }

  if (event.type?.startsWith("customer.subscription.")) {
    await syncStripeSubscription({
      db,
      stripe,
      config,
      subscription: event.data?.object,
      fallbackUserId: event.data?.object?.metadata?.user_id || "",
      signal: req.signal
    });
  }

  if ((event.type === "invoice.payment_succeeded" || event.type === "invoice.payment_failed") && event.data?.object?.subscription) {
    const subscriptionRef = event.data.object.subscription;
    const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
    const subscription = await stripe.retrieveSubscription(subscriptionId, { signal: req.signal });
    await syncStripeSubscription({
      db,
      stripe,
      config,
      subscription,
      fallbackUserId: subscription?.metadata?.user_id || "",
      signal: req.signal
    });
  }

  await db.recordWebhookEvent({
    id: event.id,
    type: event.type,
    payload: event,
    processed_at: new Date().toISOString()
  }, { signal: req.signal });

  sendJson(res, 200, { received: true });
}

async function handleModels(req, res, config) {
  requireServerCrofKey(config);
  const context = await requirePaidContext(req, config);

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
  const context = await requirePaidContext(req, config);
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
  const context = await requirePaidContext(req, config);
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
  const context = await requirePaidContext(req, config);
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
  const context = await requirePaidContext(req, config);
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
    await context.db.deleteConversation(context.user.id, conversation.id, { signal: req.signal });
    sendJson(res, 200, { deleted: true });
    return;
  }

  throw new HttpError(405, "Method not allowed.");
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

async function handleConversationMessage(req, res, config, conversationId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireServerCrofKey(config);

  const context = await requirePaidContext(req, config);
  const body = await parseJsonBody(req, 2 * 1024 * 1024);
  const conversation = await context.db.getConversation(context.user.id, conversationId, { signal: req.signal });
  if (!conversation) throw new HttpError(404, "Conversation not found.");

  const attachments = await loadUploadedAttachments(context, body.attachments, req, context.plan);
  const userContent = buildStoredUserContent(body.text, attachments);
  const imageCount = imageCountFromContent(userContent);
  await consumeUsageOrThrow({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    imageCount,
    signal: req.signal
  });

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

  const allMessages = await context.db.listMessages(context.user.id, conversation.id, { signal: req.signal });
  const settings = normalizeMessageSettings(body);
  const providerMessages = await buildProviderMessages({
    messages: allMessages,
    systemPrompt: settings.systemPrompt || "",
    r2: context.r2
  });

  const chatRequest = normalizeChatRequest({
    model: body.model || conversation.model,
    messages: providerMessages,
    ...settings
  });

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

  const upstream = await streamChatCompletion({
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
  await context.db.updateMessage(context.user.id, assistantMessage.id, {
    content: accumulated.content,
    reasoning: accumulated.reasoning,
    tool_calls: accumulated.toolCalls,
    finish_reason: accumulated.finishReason || null
  }, { signal: req.signal });
  await context.db.updateConversation(context.user.id, conversation.id, { updated_at: new Date().toISOString() }, { signal: req.signal });
  res.end();
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

    if (url.pathname === "/api/billing/checkout" && req.method === "POST") {
      await handleCheckout(req, res, config);
      return;
    }

    if (url.pathname === "/api/billing/portal" && req.method === "POST") {
      await handlePortal(req, res, config);
      return;
    }

    if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
      await handleStripeWebhook(req, res, config);
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
