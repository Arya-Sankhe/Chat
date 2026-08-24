import { HttpError } from "../http/responses.js";

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  if (next.getUTCDate() !== day) next.setUTCDate(0);
  return next;
}

function asObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

function customerNames(user) {
  const meta = user?.raw?.user_metadata || {};
  const tokens = String(meta.full_name || meta.name || meta.display_name || user?.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length) return { first_name: tokens[0], last_name: tokens.slice(1).join(" ") || "Klui" };
  return { first_name: String(user?.email || "").split("@")[0] || "Klui", last_name: "Klui" };
}

function subscriberByEmail(subscribers, email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  return (Array.isArray(subscribers) ? subscribers : []).find((row) => (
    String(row?.customer?.email || "").trim().toLowerCase() === needle
  )) || null;
}

function resolvePlanId(payload, plans, existing) {
  const custom = asObject(payload?.custom_data);
  const fromCustom = String(custom.planId || "").trim();
  if (fromCustom && plans.some((plan) => plan.id === fromCustom)) return fromCustom;
  const subscriptionId = String(payload?.subscription_id || "").trim();
  if (subscriptionId) {
    const match = plans.find((plan) => plan.mamoSubscriptionId && plan.mamoSubscriptionId === subscriptionId);
    if (match) return match.id;
  }
  const fromExisting = String(existing?.plan_id || "").trim();
  if (fromExisting && plans.some((plan) => plan.id === fromExisting)) return fromExisting;
  return "";
}

export async function mamoFetch(config, path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${config.mamo.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.mamo.apiKey}`,
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new HttpError(502, "Mamo request failed.");
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const messages = Array.isArray(payload?.messages)
      ? payload.messages.filter(Boolean).join(" ")
      : (typeof payload?.messages === "string" ? payload.messages : "");
    throw new HttpError(502, messages || "Mamo request failed.", { status: response.status });
  }
  return payload;
}

export async function createPaymentLink(config, { user, plan, appUrl, signal }) {
  const names = customerNames(user);
  const payload = await mamoFetch(config, "/links", {
    method: "POST",
    signal,
    body: {
      // ponytail: Mamo title max 50.
      title: `Klui ${plan.name}`.slice(0, 50),
      amount: plan.amountAed,
      amount_currency: "AED",
      return_url: `${appUrl}/`,
      failure_return_url: `${appUrl}/`,
      terms_and_conditions_url: "https://home.klui.ai/terms/",
      send_customer_receipt: true,
      email: user.email || undefined,
      first_name: names.first_name,
      last_name: names.last_name,
      custom_data: { userId: user.id, planId: plan.id },
      external_id: String(user.id),
      ...(plan.mamoSubscriptionId
        ? { subscription_id: plan.mamoSubscriptionId, link_type: "inline" }
        : {
          link_type: "standalone",
          subscription: { frequency: "monthly", frequency_interval: 1 },
          capacity: 1
        })
    }
  });
  if (!payload?.payment_url) throw new HttpError(502, "Mamo did not return a payment URL.");
  return {
    paymentUrl: payload.payment_url,
    id: payload.id,
    subscriptionId: payload.subscription?.identifier || null
  };
}

export async function listSubscribers(config, subscriptionId, { signal } = {}) {
  const rows = await mamoFetch(
    config,
    `/subscriptions/${encodeURIComponent(subscriptionId)}/subscribers`,
    { signal }
  );
  return Array.isArray(rows) ? rows : [];
}

export async function unsubscribe(config, subscriptionId, subscriberId, { signal } = {}) {
  return mamoFetch(
    config,
    `/subscriptions/${encodeURIComponent(subscriptionId)}/subscribers/${encodeURIComponent(subscriberId)}`,
    { method: "DELETE", signal }
  );
}

export function parseNextPaymentDate(value, now = new Date()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const text = String(value || "").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (dmy) {
    const date = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    if (Number.isFinite(date.getTime())) return date;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (Number.isFinite(date.getTime())) return date;
  }
  const parsed = text ? new Date(text) : null;
  if (parsed && Number.isFinite(parsed.getTime())) return parsed;
  return addMonths(now, 1);
}

export async function applyWebhookToSubscription(payload, { db, plans, config, signal, now = new Date() }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const aliases = {
    "charge.succeeded": "payment.succeeded",
    "charge.failed": "payment.failed",
    "charge.refunded": "payment.refunded"
  };
  const eventType = aliases[String(payload.event_type || "")] || String(payload.event_type || "");
  const status = String(payload.status || "").toLowerCase();
  const nextStatus = (
    (eventType === "subscription.succeeded" || eventType === "payment.succeeded")
    && (status === "captured" || status === "succeeded")
  ) ? "active"
    : eventType === "subscription.failed" ? "past_due"
    : eventType === "payment.refunded" ? "canceled"
    : null;
  if (!nextStatus) return;

  const custom = asObject(payload.custom_data);
  const userId = String(custom.userId || payload.external_id || "").trim();
  if (!userId) return;

  const existing = await db.getLatestSubscription(userId, { signal });
  const mamoExisting = existing?.provider === "mamo" ? existing : null;
  const planId = resolvePlanId(payload, plans, existing);
  if (!planId) return;

  const email = String(payload?.customer_details?.email || "").trim();
  const priorRaw = mamoExisting?.raw && typeof mamoExisting.raw === "object" ? mamoExisting.raw : {};
  const mamoPlanSubscriptionId = String(
    payload?.subscription_id || priorRaw.mamoPlanSubscriptionId || ""
  ).trim();
  let subscriberId = String(priorRaw.subscriberId || "").trim();
  if (mamoPlanSubscriptionId && email) {
    try {
      const match = subscriberByEmail(
        await listSubscribers(config, mamoPlanSubscriptionId, { signal }),
        email
      );
      if (match?.id) subscriberId = match.id;
    } catch {}
  }

  const currentPeriodEnd = nextStatus === "active"
    ? parseNextPaymentDate(payload?.next_payment_date, now).toISOString()
    : (mamoExisting?.current_period_end || parseNextPaymentDate(payload?.next_payment_date, now).toISOString());

  await db.upsertSubscription({
    user_id: userId,
    provider: "mamo",
    provider_subscription_id: `mamo:${userId}`,
    provider_customer_id: email || userId,
    provider_price_id: planId,
    plan_id: planId,
    status: nextStatus,
    cancel_at_period_end: nextStatus === "active" ? false : Boolean(mamoExisting?.cancel_at_period_end),
    current_period_end: currentPeriodEnd,
    raw: {
      ...priorRaw,
      ...payload,
      ...(mamoPlanSubscriptionId ? { mamoPlanSubscriptionId } : {}),
      ...(subscriberId ? { subscriberId } : {})
    },
    updated_at: now.toISOString()
  }, { signal });
}
