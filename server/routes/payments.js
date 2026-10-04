import { timingSafeEqual } from "node:crypto";
import { generateNonce } from "../saas/council.js";
import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import {
  applyWebhookToSubscription,
  couponChargeExternalId,
  couponPrice,
  createPaymentLink,
  mamoCharges,
  mamoFetch,
  cancelMamoRenewal,
  closeOtherCheckouts,
  settleCouponCharge,
  startCouponPeriod
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

// First-month coupons are for a user's first Klui subscription, once per account.
async function eligibleCoupon(context, config, code, signal) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(normalized)) throw new HttpError(400, "That coupon code isn't valid.");
  let coupon = config.mamo?.coupons?.get(normalized);
  if (!coupon) {
    const row = await context.db.getAffiliateCoupon(normalized, { signal });
    if (row?.enabled && row.percent_off != null && row.affiliate_creators.user_id !== context.user.id) {
      coupon = { code: row.code, percentOff: Number(row.percent_off), affiliateCouponId: row.id };
    }
  }
  if (!coupon) throw new HttpError(400, "That coupon code isn't valid.");
  const [current, redemption] = await Promise.all([
    context.db.getLatestSubscription(context.user.id, { signal }),
    context.db.getMamoCouponRedemption(context.user.id, { signal })
  ]);
  if (current || (redemption && redemption.status !== "failed")) {
    throw new HttpError(409, "This coupon is only for your first Klui subscription.");
  }
  return coupon;
}

// Prices are before Mamo's processing fee; charges are what the card is billed.
function publicCouponOffer(plan, coupon, config, firstRenewalAt = null) {
  const { renewalAmount, initialAmount } = mamoCharges(plan, coupon, config);
  return {
    code: coupon.code,
    percentOff: coupon.percentOff,
    planId: plan.id,
    initialAmountAed: couponPrice(plan, coupon),
    renewalAmountAed: plan.amountAed,
    initialChargeAed: initialAmount,
    renewalChargeAed: renewalAmount,
    ...(firstRenewalAt ? { firstRenewalAt } : {})
  };
}

export async function handleCheckMamoCoupon(req, res, config) {
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const coupon = await eligibleCoupon(context, config, body.coupon, req.signal);
  sendJson(res, 200, { coupon: { code: coupon.code, percentOff: coupon.percentOff },
    offers: config.plans.filter((plan) => plan.amountAed > 0).map((plan) => publicCouponOffer(plan, coupon, config)) });
}

export async function handleCreateMamoPayment(req, res, config) {
  const context = await authContext(req, config);
  if (!config.mamo?.apiKey || !config.mamo?.webhookAuth) throw new HttpError(503, "Mamo is not configured.");
  const body = await parseJsonBody(req, 16 * 1024);
  const planId = String(body.planId || "").trim();
  const plan = config.plans.find((candidate) => candidate.id === planId);
  if (!plan) throw new HttpError(400, "Choose a valid Klui plan.");
  const coupon = String(body.coupon || "").trim() ? await eligibleCoupon(context, config, body.coupon, req.signal) : null;
  const current = await context.db.getLatestSubscription(context.user.id, { signal: req.signal });
  if (current?.provider === "mamo" && !current.cancel_at_period_end) {
    throw new HttpError(409, "Cancel your current renewal before starting another subscription.");
  }
  const link = await createPaymentLink(config, {
    user: context.user,
    plan,
    appUrl: config.appUrl,
    coupon,
    signal: req.signal
  });
  if (!link.id) throw new HttpError(502, "Mamo did not return a payment link ID.");
  await context.db.createMamoPaymentLink({
    id: link.id, user_id: context.user.id, plan_id: plan.id,
    amount_aed: link.renewalAmount, subscription_id: link.subscriptionId,
    ...(coupon ? { coupon_code: coupon.code, initial_amount_aed: link.initialAmount, first_renewal_at: link.firstRenewalAt,
      affiliate_coupon_id: coupon.affiliateCouponId || null } : {})
  }, { signal: req.signal });
  if (!await closeOtherCheckouts(context.db, context.user.id, link.id, { config, signal: req.signal })) {
    throw new HttpError(409, "Another checkout was just opened. Use the newest one.");
  }
  sendJson(res, 200, {
    paymentUrl: link.paymentUrl,
    checkout: "mamo",
    ...(coupon ? { offer: publicCouponOffer(plan, coupon, config, link.firstRenewalAt) } : {})
  });
}

const mamoBillingEvents = new Set(["payment.succeeded", "payment.failed", "payment.card_verified",
  "subscription.succeeded", "subscription.failed", "payment.refunded",
  "charge.succeeded", "charge.failed", "charge.card_verified", "charge.refunded"]);

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
  if (!mamoBillingEvents.has(payload?.event_type)) {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!payload.id) throw new HttpError(400, "Payment ID is required.");
  // Read the provider's current payment state: redirects and callback fields cannot grant access.
  const payment = await mamoFetch(config, `/payments/${encodeURIComponent(payload.id)}`, { signal: req.signal });
  const link = await db.getMamoPaymentLink(payment?.payment_link_id, { signal: req.signal });
  if (!link) throw new HttpError(409, "Payment link is not registered with this app.");
  // A coupon's discounted first month is a separate saved-card charge; renewals are full price.
  const couponCharge = Boolean(link.coupon_code) && payment?.external_id === couponChargeExternalId(link.id);
  if (payment?.id !== payload.id || payment.amount_currency !== "AED"
    || Number(payment.amount) !== Number(couponCharge ? link.initial_amount_aed : link.amount_aed)
    || (link.subscription_id && payment.subscription_id && payment.subscription_id !== link.subscription_id)
    || (link.subscription_id && !payment.subscription_id && !couponCharge)) {
    throw new HttpError(400, "Payment does not match the registered checkout.");
  }
  const context = { db, plans: config.plans, config, signal: req.signal };
  if (payment.status === "card_verified") {
    if (link.coupon_code) await startCouponPeriod(payment, link, context);
    sendJson(res, 200, { ok: true });
    return;
  }
  const fullRefund = Number(payment.refund_amount) >= Number(payment.amount) && Number(payment.amount) > 0;
  if (couponCharge && !fullRefund) {
    await settleCouponCharge(payment, link, context);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!fullRefund && !["captured", "succeeded", "failed"].includes(payment.status)) {
    sendJson(res, 200, { ok: true });
    return;
  }
  await applyWebhookToSubscription({
    ...payment,
    event_type: fullRefund ? "payment.refunded"
      : ["captured", "succeeded"].includes(payment.status) ? "payment.succeeded" : "subscription.failed",
    payment_link_id: link.id,
    subscription_id: payment.subscription_id || link.subscription_id,
    next_payment_date: payment.next_payment_date || payload.next_payment_date,
    custom_data: { userId: link.user_id, planId: link.plan_id }, external_id: link.user_id
  }, context);
  sendJson(res, 200, { ok: true });
}

export async function handleCancelSubscription(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await authContext(req, config);
  const subscription = await context.db.getLatestSubscription(context.user.id, { signal: req.signal });
  if (subscription?.provider !== "mamo") {
    throw new HttpError(400, "This plan cannot be cancelled here.");
  }
  const updated = await cancelMamoRenewal(subscription, { db: context.db, user: context.user, config, signal: req.signal });
  sendJson(res, 200, { subscription: publicMamoSubscription(updated) });
}
