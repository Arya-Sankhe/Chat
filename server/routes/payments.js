import { timingSafeEqual } from "node:crypto";
import { generateNonce } from "../saas/council.js";
import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { hasActiveSubscription } from "../saas/entitlements.js";
import {
  applyWebhookToSubscription,
  createPaymentLink,
  listSubscribers,
  unsubscribe
} from "../saas/mamo.js";
import { authContext, bearerContext, requireAdminContext } from "./context.js";
import { clearAdminSummaryCache } from "./admin.js";

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next;
}

function paymentReferenceCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = generateNonce(5).toUpperCase();
  return `KLUI-${date}-${suffix}`;
}

function publicPaymentRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    planId: row.plan_id,
    amountAed: Number(row.amount_aed || 0),
    currency: row.currency || "AED",
    provider: row.provider || "ziina",
    paymentUrl: row.payment_url || "",
    qrImageUrl: row.qr_image_url || "",
    referenceCode: row.reference_code,
    status: row.status,
    adminNote: row.admin_note || "",
    approvedAt: row.approved_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function handleCreateZiinaPaymentRequest(req, res, config) {
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const planId = String(body.planId || "").trim();
  const plan = config.plans.find((candidate) => candidate.id === planId);
  if (!plan) throw new HttpError(400, "Choose a valid Klui plan.");

  let row = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      row = await context.db.createPaymentRequest({
        user_id: context.user.id,
        plan_id: plan.id,
        amount_aed: plan.amountAed,
        currency: "AED",
        provider: "ziina",
        payment_url: plan.ziinaPaymentUrl || null,
        qr_image_url: plan.ziinaQrImageUrl || null,
        reference_code: paymentReferenceCode(),
        status: "pending"
      }, { signal: req.signal });
      break;
    } catch (error) {
      if (error?.status !== 409 || attempt === 2) throw error;
    }
  }

  sendJson(res, 201, {
    paymentRequest: publicPaymentRequest(row),
    instructions: "Pay with Ziina, include the reference code if Ziina lets you add a note, then wait for admin approval."
  });
}

export async function handleListPaymentRequests(req, res, config) {
  const context = await authContext(req, config);
  const rows = await context.db.listPaymentRequests(context.user.id, { signal: req.signal });
  sendJson(res, 200, { paymentRequests: rows.map(publicPaymentRequest) });
}

export async function handleAdminPaymentRequests(req, res, config) {
  const context = await requireAdminContext(req, config);
  const rows = await context.db.listPendingPaymentRequests({ signal: req.signal });
  sendJson(res, 200, { paymentRequests: rows.map(publicPaymentRequest) });
}

export async function handleAdminUpdatePaymentRequest(req, res, config, id, action) {
  const context = await requireAdminContext(req, config);
  if (!["approve", "reject"].includes(action)) throw new HttpError(404, "Admin payment action not found.");
  const payment = await context.db.getPaymentRequest(id, { signal: req.signal });
  if (!payment) throw new HttpError(404, "Payment request was not found.");
  if (payment.status !== "pending") throw new HttpError(409, "Payment request is no longer pending.");

  const body = await parseJsonBody(req, 16 * 1024);
  if (action === "reject") {
    const rejected = await context.db.updatePaymentRequest(id, {
      status: "rejected",
      admin_note: String(body.note || "").trim() || null
    }, { signal: req.signal });
    sendJson(res, 200, { paymentRequest: publicPaymentRequest(rejected) });
    return;
  }

  const plan = config.plans.find((candidate) => candidate.id === payment.plan_id);
  if (!plan) throw new HttpError(400, "Payment request plan is not available.");

  const now = new Date();
  const subscription = await context.db.upsertSubscription({
    user_id: payment.user_id,
    provider: "ziina",
    provider_subscription_id: `ziina:${payment.id}`,
    provider_price_id: payment.plan_id,
    plan_id: payment.plan_id,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: addMonths(now, 1).toISOString(),
    raw: {
      payment_request_id: payment.id,
      reference_code: payment.reference_code,
      amount_aed: Number(payment.amount_aed || 0),
      approved_by: context.user.id,
      approved_at: now.toISOString()
    },
    updated_at: now.toISOString()
  }, { signal: req.signal });

  const approved = await context.db.updatePaymentRequest(id, {
    status: "approved",
    admin_note: String(body.note || "").trim() || null,
    approved_by: context.user.id,
    approved_at: now.toISOString()
  }, { signal: req.signal });

  clearAdminSummaryCache();
  sendJson(res, 200, {
    paymentRequest: publicPaymentRequest(approved),
    subscription: {
      id: subscription.id,
      planId: subscription.plan_id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
    }
  });
}

function mamoWebhookAuthorized(header, expected) {
  const raw = String(header || "").trim();
  const provided = /^Bearer\s+/i.test(raw) ? raw.replace(/^Bearer\s+/i, "").trim() : raw;
  const wanted = Buffer.from(expected);
  const stripped = Buffer.from(provided);
  if (stripped.length === wanted.length && timingSafeEqual(stripped, wanted)) return true;
  const full = Buffer.from(raw);
  if (full.length === wanted.length && timingSafeEqual(full, wanted)) return true;
  return false;
}

function publicMamoSubscription(row) {
  return {
    status: row.status,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    currentPeriodEnd: row.current_period_end,
    provider: row.provider
  };
}

export async function handleCreateMamoPayment(req, res, config) {
  const context = await authContext(req, config);
  if (!config.mamo?.apiKey) throw new HttpError(503, "Mamo is not configured.");
  const body = await parseJsonBody(req, 16 * 1024);
  const planId = String(body.planId || "").trim();
  const plan = config.plans.find((candidate) => candidate.id === planId);
  if (!plan) throw new HttpError(400, "Choose a valid Klui plan.");
  const link = await createPaymentLink(config, {
    user: context.user,
    plan,
    appUrl: config.appUrl,
    signal: req.signal
  });
  sendJson(res, 200, { paymentUrl: link.paymentUrl, checkout: "mamo" });
}

export async function handleMamoWebhook(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!config.mamo?.apiKey || !config.mamo?.webhookAuth) {
    throw new HttpError(503, "Mamo is not configured.");
  }
  const header = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  if (!mamoWebhookAuthorized(header, config.mamo.webhookAuth)) {
    throw new HttpError(401, "Unauthorized.");
  }
  // ponytail: 64KiB webhook payload cap.
  const payload = await parseJsonBody(req, 64 * 1024);
  const { db } = bearerContext(config);
  await applyWebhookToSubscription(payload, {
    db,
    plans: config.plans,
    config,
    signal: req.signal
  });
  sendJson(res, 200, { ok: true });
}

export async function handleCancelSubscription(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await authContext(req, config);
  const subscription = await context.db.getLatestSubscription(context.user.id, { signal: req.signal });
  if (subscription?.provider !== "mamo" || !hasActiveSubscription(subscription)) {
    throw new HttpError(400, "This plan cannot be cancelled here.");
  }
  if (subscription.cancel_at_period_end) {
    sendJson(res, 200, { subscription: publicMamoSubscription(subscription) });
    return;
  }

  const raw = subscription.raw && typeof subscription.raw === "object" ? subscription.raw : {};
  const mamoPlanSubscriptionId = String(raw.mamoPlanSubscriptionId || raw.subscription_id || "").trim();
  let subscriberId = String(raw.subscriberId || "").trim();
  if (!subscriberId && mamoPlanSubscriptionId && context.user.email) {
    const match = (await listSubscribers(config, mamoPlanSubscriptionId, { signal: req.signal }))
      .find((row) => String(row?.customer?.email || "").trim().toLowerCase() === String(context.user.email).trim().toLowerCase());
    subscriberId = String(match?.id || "").trim();
  }
  if (!mamoPlanSubscriptionId || !subscriberId) {
    throw new HttpError(502, "Mamo subscriber was not found.");
  }

  try {
    await unsubscribe(config, mamoPlanSubscriptionId, subscriberId, { signal: req.signal });
  } catch (error) {
    if (error?.details?.status !== 404) throw error;
  }

  const updated = await context.db.upsertSubscription({
    user_id: context.user.id,
    provider: "mamo",
    provider_subscription_id: subscription.provider_subscription_id || `mamo:${context.user.id}`,
    provider_customer_id: subscription.provider_customer_id || context.user.email || context.user.id,
    provider_price_id: subscription.provider_price_id || subscription.plan_id,
    plan_id: subscription.plan_id,
    status: subscription.status,
    cancel_at_period_end: true,
    current_period_end: subscription.current_period_end,
    raw,
    updated_at: new Date().toISOString()
  }, { signal: req.signal });

  sendJson(res, 200, { subscription: publicMamoSubscription(updated || { ...subscription, cancel_at_period_end: true }) });
}
