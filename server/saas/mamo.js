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

// Mamo prefills the cardholder name from these and rejects anything but letters.
function nameTokens(value) {
  return String(value || "").replace(/[^\p{L}\s]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}

function customerNames(user) {
  const meta = user?.raw?.user_metadata || {};
  const tokens = nameTokens(meta.full_name || meta.name || meta.display_name || user?.name);
  if (tokens.length) return { first_name: tokens[0], last_name: tokens.slice(1).join(" ") || "Klui" };
  return { first_name: nameTokens(String(user?.email || "").split("@")[0])[0] || "Klui", last_name: "Klui" };
}

export function subscriberByEmail(subscribers, email) {
  const needle = String(email || "").trim().toLowerCase();
  if (!needle) return null;
  const matches = (Array.isArray(subscribers) ? subscribers : []).filter((row) => (
    String(row?.customer?.email || "").trim().toLowerCase() === needle
  ));
  return matches.find((row) => String(row.status).toLowerCase() === "active") || matches.at(-1) || null;
}

function resolvePlanId(payload, plans, existing) {
  const custom = asObject(payload?.custom_data);
  const fromCustom = String(custom.planId || "").trim();
  if (fromCustom && plans.some((plan) => plan.id === fromCustom)) return fromCustom;
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
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000)
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

// Mamo schedules run on Dubai calendar days (UTC+4, no DST).
function dubaiDay(date, addDays = 0) {
  const local = new Date(date.getTime() + 4 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays) - 4 * 3600_000);
}

function mamoDate(date) {
  return new Date(date.getTime() + 4 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "/");
}

export function couponPrice(plan, coupon) {
  if (!coupon) return null;
  return Math.round(plan.amountAed * (100 - coupon.percentOff)) / 100;
}

// Mamo deducts percent + fixed from each captured charge, plus VAT on that fee. Gross the
// amount up so Klui still nets `amount` after Mamo's cut. Nothing is captured for 0.
export function withProcessingFee(amount, fees) {
  if (!(amount > 0) || !fees) return amount;
  const cents = Math.round(amount * 100);
  const net = (total) => {
    const fee = Math.round(total * fees.percent / 100 + fees.fixedAed * 100);
    return total - fee - Math.round(fee * fees.vatPercent / 100);
  };
  const vat = 1 + fees.vatPercent / 100;
  let total = Math.ceil((cents + fees.fixedAed * 100 * vat) / (1 - fees.percent / 100 * vat));
  while (net(total) < cents) total += 1;
  while (total > cents && net(total - 1) >= cents) total -= 1;
  return total / 100;
}

// What Mamo charges for a plan: renewal price, and the first-month price with a coupon.
export function mamoCharges(plan, coupon, config) {
  const fees = config.mamo?.fees;
  const initialPrice = couponPrice(plan, coupon);
  return {
    renewalAmount: withProcessingFee(plan.amountAed, fees),
    initialAmount: initialPrice == null ? null : withProcessingFee(initialPrice, fees)
  };
}

function aed(value) {
  return `AED ${Number(value).toFixed(2).replace(/\.00$/, "")}`;
}

export function couponChargeExternalId(linkId) {
  return `klui-coupon:${linkId}`;
}

// With a coupon, checkout saves the card for a full-price subscription starting next month;
// the first month is then free, or charged once to the saved card at the discounted price.
export async function createPaymentLink(config, { user, plan, appUrl, coupon = null, now = new Date(), signal }) {
  const names = customerNames(user);
  const testSchedule = Boolean(config.mamo?.testSchedule);
  const { renewalAmount, initialAmount } = mamoCharges(plan, coupon, config);
  const fee = (charged, price) => (charged > price ? ` + ${aed(Math.round((charged - price) * 100) / 100)} fee` : "");
  // Sandbox test schedules renew within minutes; a start later today would charge at once.
  const firstRenewalDay = coupon ? dubaiDay(testSchedule ? now : addMonths(now, 1), testSchedule ? 1 : 0) : null;
  const schedule = { frequency: testSchedule ? "test" : "monthly", frequency_interval: 1,
    ...(testSchedule ? { payment_quantity: 3 } : {}) };
  const title = coupon
    ? `Klui ${plan.name} · ${coupon.percentOff === 100 ? "first month free" : `${coupon.percentOff}% off month 1`}`
    : `Klui ${plan.name}`;
  const description = coupon
    ? `${initialAmount ? `${aed(initialAmount)} now` : "Free now"}, then ${aed(renewalAmount)}/month from ${mamoDate(firstRenewalDay)}`
    : `${aed(plan.amountAed)}/month${fee(renewalAmount, plan.amountAed)}`;
  const payload = await mamoFetch(config, "/links", {
    method: "POST",
    signal,
    body: {
      // ponytail: Mamo title max 50.
      title: title.slice(0, 50),
      // ponytail: Mamo description max 75.
      description: description.slice(0, 75),
      amount: renewalAmount,
      amount_currency: "AED",
      return_url: `${appUrl}/`,
      failure_return_url: `${appUrl}/`,
      terms_and_conditions_url: "https://home.klui.ai/terms/",
      send_customer_receipt: true,
      email: user.email || undefined,
      first_name: names.first_name,
      last_name: names.last_name,
      custom_data: { userId: user.id, planId: plan.id, ...(coupon ? { coupon: coupon.code } : {}) },
      external_id: String(user.id),
      link_type: "standalone",
      capacity: 1,
      ...(coupon ? {
        save_card: "required",
        subscription: { ...schedule, start_date: mamoDate(firstRenewalDay) }
      } : { subscription: schedule })
    }
  });
  if (!payload?.payment_url) throw new HttpError(502, "Mamo did not return a payment URL.");
  return {
    paymentUrl: payload.payment_url,
    id: payload.id,
    subscriptionId: payload.subscription?.identifier || null,
    renewalAmount,
    initialAmount,
    // Access lasts through the whole first-renewal day so the renewal callback can extend it.
    firstRenewalAt: firstRenewalDay ? dubaiDay(firstRenewalDay, 1).toISOString() : null
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

// Mamo sends a date-only next payment day (Dubai calendar); keep access through that whole
// day so the renewal charge can land before access ends.
export function paidThrough(value, now = new Date()) {
  const text = String(value || "").trim();
  const date = parseNextPaymentDate(value, now);
  return /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/.test(text) ? new Date(date.getTime() + 20 * 3600_000) : date;
}

export async function applyWebhookToSubscription(payload, { db, plans, config, signal, now = new Date() }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const aliases = {
    "charge.succeeded": "payment.succeeded",
    "charge.failed": "payment.failed",
    "charge.refunded": "payment.refunded",
    "charge.card_verified": "payment.card_verified"
  };
  const eventType = aliases[String(payload.event_type || "")] || String(payload.event_type || "");
  const status = String(payload.status || "").toLowerCase();
  const nextStatus = (
    (eventType === "subscription.succeeded" || eventType === "payment.succeeded")
    && (status === "captured" || status === "succeeded")
  ) ? "active"
    : eventType === "payment.card_verified" && status === "card_verified" ? "trialing"
    : eventType === "subscription.failed" ? "past_due"
    : eventType === "payment.refunded" ? "canceled"
    : null;
  if (!nextStatus) return;

  const custom = asObject(payload.custom_data);
  const userId = String(custom.userId || payload.external_id || "").trim();
  if (!userId) return;

  const existing = await db.getLatestSubscription(userId, { signal });
  const mamoExisting = existing?.provider === "mamo" ? existing : null;
  // A failed charge cannot create paid access or revive a refunded subscription.
  if (nextStatus === "past_due" && (
    !["active", "trialing", "past_due"].includes(mamoExisting?.status)
    || !mamoExisting?.current_period_end
    || !Number.isFinite(new Date(mamoExisting.current_period_end).getTime())
  )) return;
  const planId = resolvePlanId(payload, plans, existing);
  if (!planId) return;

  const email = String(payload?.customer_details?.email || "").trim();
  const priorRaw = mamoExisting?.raw && typeof mamoExisting.raw === "object" ? mamoExisting.raw : {};
  const mamoPlanSubscriptionId = String(
    payload?.subscription_id || priorRaw.mamoPlanSubscriptionId || ""
  ).trim();
  let subscriberId = mamoPlanSubscriptionId === priorRaw.mamoPlanSubscriptionId
    ? String(priorRaw.subscriberId || "").trim() : "";
  if (mamoPlanSubscriptionId && email) {
    try {
      const match = subscriberByEmail(
        await listSubscribers(config, mamoPlanSubscriptionId, { signal }),
        email
      );
      if (match?.id) subscriberId = match.id;
    } catch {}
  }

  const currentPeriodEnd = nextStatus === "active" || nextStatus === "trialing"
    ? paidThrough(payload?.next_payment_date, now).toISOString()
    : (mamoExisting?.current_period_end || paidThrough(payload?.next_payment_date, now).toISOString());

  await db.applyMamoSubscription({
    user_id: userId,
    provider: "mamo",
    provider_subscription_id: `mamo:${userId}`,
    provider_customer_id: email || userId,
    provider_price_id: planId,
    plan_id: planId,
    status: nextStatus,
    cancel_at_period_end: nextStatus === "active" || nextStatus === "trialing" ? false : Boolean(mamoExisting?.cancel_at_period_end),
    current_period_end: currentPeriodEnd,
    raw: {
      ...priorRaw,
      ...payload,
      ...(mamoPlanSubscriptionId ? { mamoPlanSubscriptionId } : {}),
      subscriberId: subscriberId || null
    },
    updated_at: now.toISOString()
  }, { signal });
}

// Unsubscribes every active subscriber with this email (a checkout can be paid more than once).
async function unsubscribeEmail(config, subscriptionId, email, { signal }) {
  const needle = String(email || "").trim().toLowerCase();
  if (!subscriptionId || !needle) return;
  const rows = (await listSubscribers(config, subscriptionId, { signal }))
    .filter((row) => String(row?.customer?.email || "").trim().toLowerCase() === needle
      && String(row.status).toLowerCase() === "active");
  for (const row of rows) {
    try {
      await unsubscribe(config, subscriptionId, row.id, { signal });
    } catch (error) {
      if (error?.details?.status !== 404) throw error;
    }
  }
}

async function deactivateLink(config, linkId, { signal }) {
  try {
    await mamoFetch(config, `/links/${encodeURIComponent(linkId)}`, { method: "PATCH", body: { active: false }, signal });
  } catch (error) {
    if (error?.details?.status !== 404) throw error;
  }
}

// Opening a checkout closes the user's other ones, so two checkouts cannot both be paid. Runs
// after the new link is stored; when requests race, the newest link wins and the rest close.
export async function closeOtherCheckouts(db, userId, ownLinkId, { config, signal }) {
  const links = await db.listMamoPaymentLinks(userId, { signal });
  const own = links.find((link) => link.id === ownLinkId);
  const newer = (a, b) => (a.created_at === b.created_at ? a.id > b.id : Date.parse(a.created_at) > Date.parse(b.created_at));
  const superseded = own && links.some((link) => link.id !== ownLinkId && newer(link, own));
  for (const link of links) {
    if (link.id !== ownLinkId || superseded) await deactivateLink(config, link.id, { signal });
  }
  return !superseded;
}

// Unsubscribes the user from every checkout's schedule, whether or not a webhook recorded it.
export async function stopAllMamoSchedules(db, user, { config, signal }) {
  const links = await db.listMamoPaymentLinks(user.id, { signal });
  for (const id of new Set(links.map((link) => link.subscription_id).filter(Boolean))) {
    await unsubscribeEmail(config, id, user.email, { signal });
  }
}

// Account deletion and Settings must both stop billing before changing local account state.
// Every checkout's schedule is swept too, so a duplicate subscription cannot keep charging.
export async function cancelMamoRenewal(subscription, { db, user, config, signal }) {
  if (subscription?.provider !== "mamo" || subscription.cancel_at_period_end) return subscription;
  const raw = asObject(subscription.raw);
  const subscriptionId = String(raw.mamoPlanSubscriptionId || raw.subscription_id || "").trim();
  let subscriberId = String(raw.subscriberId || "").trim();
  if (!subscriberId && subscriptionId && user.email) {
    const match = subscriberByEmail(await listSubscribers(config, subscriptionId, { signal }), user.email);
    subscriberId = String(match?.id || "").trim();
  }
  if (!subscriptionId || !subscriberId) throw new HttpError(502, "Mamo subscriber was not found.");
  try {
    await unsubscribe(config, subscriptionId, subscriberId, { signal });
  } catch (error) {
    if (error?.details?.status !== 404) throw error;
  }
  await stopAllMamoSchedules(db, user, { config, signal });
  return db.cancelMamoSubscription(user.id, raw.payment_link_id, { signal });
}

// Disables a coupon checkout and stops its future-start subscription before any full-price charge.
export async function stopCouponCheckout(link, email, { config, signal }) {
  await deactivateLink(config, link.id, { signal });
  await unsubscribeEmail(config, link.subscription_id, email, { signal });
}

function couponSubscriptionEvent(payment, link, eventType) {
  return {
    ...payment,
    event_type: eventType,
    payment_link_id: link.id,
    subscription_id: link.subscription_id,
    next_payment_date: link.first_renewal_at,
    custom_data: { userId: link.user_id, planId: link.plan_id },
    external_id: link.user_id
  };
}

// The discounted first-month charge (synchronous result or its own callback; both are idempotent).
export async function settleCouponCharge(charge, link, { db, plans, config, signal }) {
  const email = charge?.customer_details?.email;
  if (["captured", "succeeded"].includes(charge?.status)) {
    await applyWebhookToSubscription(couponSubscriptionEvent(charge, link, "payment.succeeded"), { db, plans, config, signal });
    await db.advanceMamoCoupon(link.id, ["claimed", "charging"], "active", charge.id, { signal });
    return "active";
  }
  if (charge?.status === "failed") {
    // A failed first charge must not leave a full-price renewal scheduled; the coupon can be retried.
    // "failed" -> "failed" also matches, so a repeated callback retries cleanup that errored before.
    if (await db.advanceMamoCoupon(link.id, ["claimed", "charging", "failed"], "failed", charge.id, { signal })) {
      await stopCouponCheckout(link, email, { config, signal });
    }
    return "failed";
  }
  return "pending";
}

// A charge whose request may or may not have reached Mamo is re-sent only after this long.
const COUPON_CHARGE_STALE_SECONDS = 5 * 60;
const MAX_CHARGE_PAGES = 20;

function parseMamoTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? Date.UTC(match[1], match[2] - 1, match[3], match[4], match[5], match[6]) : NaN;
}

// Mamo lists charges newest first; the coupon charge is identified by its external_id. Returns
// null only after passing every charge that could be it (a day before the claim, covering any
// timezone Mamo dates use); otherwise the outcome is unknown and Mamo must redeliver later.
async function findCouponCharge(link, claim, { config, signal }) {
  const externalId = couponChargeExternalId(link.id);
  const cutoff = Date.parse(claim.created_at) - 24 * 60 * 60 * 1000;
  for (let page = 1; page <= MAX_CHARGE_PAGES; page += 1) {
    const result = await mamoFetch(config, `/charges?page=${page}&per_page=50`, { signal });
    if (!Array.isArray(result?.data)) throw new HttpError(502, "Mamo charge list was malformed.");
    const match = result.data.find((row) => row?.external_id === externalId);
    if (match) return match;
    if (!result.pagination_meta?.next_page || result.data.some((row) => parseMamoTimestamp(row?.created_date) < cutoff)) return null;
  }
  console.error("Mamo coupon charge search exhausted", link.id);
  throw new HttpError(503, "Mamo coupon charge could not be located.");
}

// Settles from the canonical payment record, as callbacks do. A lookup failure is retried by
// Mamo redelivering the callback, so it must not be acknowledged.
async function settleCouponChargeById(chargeId, link, email, { db, plans, config, signal }) {
  let charge;
  try {
    charge = await mamoFetch(config, `/payments/${encodeURIComponent(chargeId)}`, { signal });
  } catch {
    throw new HttpError(503, "Mamo coupon charge could not be read.");
  }
  if (charge?.status !== "failed" && (Number(charge?.amount) !== Number(link.initial_amount_aed)
    || charge?.amount_currency !== "AED" || charge?.external_id !== couponChargeExternalId(link.id))) {
    console.error("Mamo coupon charge did not match", link.id);
    return "pending";
  }
  return settleCouponCharge({ ...charge, customer_details: charge?.customer_details || { email } }, link,
    { db, plans, config, signal });
}

// Requests the discounted charge on the saved card. Callers hold the "charging" state.
async function chargeCoupon(claim, link, email, context) {
  const { config, signal } = context;
  let charge;
  try {
    charge = await mamoFetch(config, "/payments", {
      method: "POST",
      signal,
      body: {
        card_id: claim.card_id,
        amount: Number(link.initial_amount_aed),
        currency: "AED",
        external_id: couponChargeExternalId(link.id),
        custom_data: { userId: link.user_id, planId: link.plan_id, coupon: link.coupon_code }
      }
    });
  } catch (error) {
    const status = Number(error?.details?.status);
    // A timeout or 5xx may still have charged; never blindly retry. Its own callback settles it,
    // and a redelivered verification callback looks it up by external_id (see recoverCouponCharge).
    if (!(status >= 400 && status < 500 && status !== 408 && status !== 429)) {
      console.error("Mamo coupon charge outcome unknown", link.id, error?.message);
      throw new HttpError(503, "Mamo coupon charge outcome is unknown.");
    }
    return settleCouponCharge({ status: "failed", id: null, customer_details: { email } }, link, context);
  }
  if (!charge?.id) return "pending";
  return settleCouponChargeById(charge.id, link, email, context);
}

// A redelivered verification found the coupon mid-charge (crash, lost response or timeout).
// Settle the charge if Mamo has it. With no charge on record, only a stale claim is re-sent,
// and the database lets exactly one caller re-arm it (which also restarts the stale window).
async function recoverCouponCharge(claim, link, email, context) {
  const found = await findCouponCharge(link, claim, context);
  if (found?.id) return settleCouponChargeById(found.id, link, email, context);
  const rearmed = await context.db.rearmMamoCoupon(link.id, COUPON_CHARGE_STALE_SECONDS, { signal: context.signal });
  if (!rearmed) throw new HttpError(503, "Mamo coupon charge is still settling.");
  return chargeCoupon(rearmed, link, email, context);
}

// Card verified on a coupon checkout: start the free month, or charge the discounted month once.
export async function startCouponPeriod(payment, link, { db, plans, config, signal }) {
  const context = { db, plans, config, signal };
  const email = payment?.customer_details?.email;
  const claim = await db.claimMamoCoupon(link.id, payment?.payment_method?.card_id || null, payment.id, { signal });
  if (claim?.conflict) {
    await stopCouponCheckout(link, email, { config, signal });
    return "conflict";
  }
  if (claim?.status === "active") return "active";
  if (claim?.status === "failed") {
    // Repeated so cleanup that errored on an earlier callback is retried.
    await stopCouponCheckout(link, email, { config, signal });
    return "failed";
  }
  if (claim?.status === "charging") return recoverCouponCharge(claim, link, email, context);
  if (Number(link.initial_amount_aed) === 0) {
    await applyWebhookToSubscription(couponSubscriptionEvent(payment, link, "payment.card_verified"), context);
    await db.advanceMamoCoupon(link.id, ["claimed"], "active", null, { signal });
    return "active";
  }
  // Compare-and-set: only one callback may ever request the discounted charge.
  if (!claim?.card_id) return "pending";
  const charging = await db.advanceMamoCoupon(link.id, ["claimed"], "charging", null, { signal });
  if (!charging) return "pending";
  return chargeCoupon(charging, link, email, context);
}
