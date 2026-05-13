import crypto from "node:crypto";
import { HttpError } from "../http/responses.js";
import { findPlanByPriceId } from "../saas/plans.js";

function appendForm(form, key, value) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(form, `${key}[${index}]`, item));
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendForm(form, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  form.append(key, String(value));
}

function stripeBody(params) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) appendForm(form, key, value);
  return form;
}

function parseSignatureHeader(header) {
  const parsed = {};
  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    parsed[key] ||= [];
    parsed[key].push(value);
  }
  return parsed;
}

function timingSafeHexEqual(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyStripeSignature(rawBody, signatureHeader, webhookSecret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parsed = parseSignatureHeader(signatureHeader);
  const timestamp = Number.parseInt(parsed.t?.[0] || "", 10);
  const signatures = parsed.v1 || [];

  if (!Number.isInteger(timestamp) || !signatures.length) {
    throw new HttpError(400, "Stripe signature header is invalid.");
  }

  if (Math.abs(nowSeconds - timestamp) > 300) {
    throw new HttpError(400, "Stripe webhook timestamp is outside the allowed tolerance.");
  }

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  if (!signatures.some((signature) => timingSafeHexEqual(expected, signature))) {
    throw new HttpError(400, "Stripe webhook signature verification failed.");
  }
}

export class StripeClient {
  constructor(config) {
    this.secretKey = config.stripe.secretKey;
  }

  get configured() {
    return Boolean(this.secretKey);
  }

  async request(path, params, { method = "POST", signal } = {}) {
    if (!this.configured) {
      throw new HttpError(503, "Stripe is not configured.");
    }

    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: params ? stripeBody(params) : undefined,
      signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new HttpError(response.status, payload?.error?.message || "Stripe request failed.", payload);
    }

    return payload;
  }

  createCustomer({ email, userId }, { signal } = {}) {
    return this.request("customers", {
      email: email || undefined,
      metadata: { user_id: userId }
    }, { signal });
  }

  createCheckoutSession({ customerId, customerEmail, priceId, planId, userId, successUrl, cancelUrl }, { signal } = {}) {
    return this.request("checkout/sessions", {
      mode: "subscription",
      customer: customerId || undefined,
      customer_email: customerId ? undefined : customerEmail || undefined,
      client_reference_id: userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: userId, plan_id: planId },
      subscription_data: { metadata: { user_id: userId, plan_id: planId } },
      allow_promotion_codes: true
    }, { signal });
  }

  createPortalSession({ customerId, returnUrl }, { signal } = {}) {
    return this.request("billing_portal/sessions", {
      customer: customerId,
      return_url: returnUrl
    }, { signal });
  }

  retrieveSubscription(subscriptionId, { signal } = {}) {
    return this.request(`subscriptions/${subscriptionId}`, null, { method: "GET", signal });
  }
}

export function priceIdFromSubscription(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || "";
}

export function subscriptionRecordFromStripe(subscription, plans, fallbackUserId = "") {
  const priceId = priceIdFromSubscription(subscription);
  const plan = findPlanByPriceId(plans, priceId);
  const userId = subscription?.metadata?.user_id || fallbackUserId;

  if (!subscription?.id || !subscription?.customer || !userId) {
    throw new HttpError(400, "Stripe subscription payload is missing required metadata.");
  }

  return {
    user_id: userId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId || null,
    plan_id: plan?.id || subscription?.metadata?.plan_id || null,
    status: subscription.status || "unknown",
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    current_period_end: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
    raw: subscription
  };
}
