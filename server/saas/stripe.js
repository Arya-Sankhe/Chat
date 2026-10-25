import Stripe from "stripe";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import { HttpError } from "../http/responses.js";
import { withProcessingFee, couponAccountHashes } from "./mamo.js";

export const STRIPE_API_VERSION = "2026-09-30.endive";
export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
];
const id = (object) => (typeof object === "string" ? object : object?.id);
const iso = (seconds) =>
  seconds ? new Date(seconds * 1000).toISOString() : null;

export function assertStripeSandbox(config) {
  const key = config.stripe?.secretKey || "";
  const host = new URL(config.supabase?.url || "http://invalid").hostname;
  if (
    !/^(sk|rk)_test_/.test(key) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(host)
  ) {
    throw new HttpError(
      503,
      "Stripe sandbox requires a test key and an isolated local Supabase database.",
    );
  }
}
export function stripeClient(config) {
  assertStripeSandbox(config);
  return new Stripe(config.stripe.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
  });
}
function testObject(object) {
  if (object?.livemode !== false)
    throw new HttpError(502, "Expected a Stripe sandbox object.");
  return object;
}
export function stripeCharges(plan, coupon, config) {
  const base = Math.round(plan.amountAed * 100);
  const initial = Math.round((base * (100 - (coupon?.percentOff || 0))) / 100);
  return {
    renewalAmount: withProcessingFee(base / 100, config.stripe.fees),
    initialAmount: initial
      ? withProcessingFee(initial / 100, config.stripe.fees)
      : 0,
  };
}
export function stripeOffer(plan, coupon, config) {
  const amounts = stripeCharges(plan, coupon, config);
  return {
    code: coupon.code,
    percentOff: coupon.percentOff,
    ...(coupon.trialDays ? { trialDays: coupon.trialDays } : {}),
    planId: plan.id,
    initialAmountAed:
      Math.round(plan.amountAed * (100 - coupon.percentOff)) / 100,
    renewalAmountAed: plan.amountAed,
    initialChargeAed: amounts.initialAmount,
    renewalChargeAed: amounts.renewalAmount,
  };
}
export async function stripeCustomer(db, user, stripe) {
  const existing = (
    await db.request("stripe_customers", {
      query: { user_id: `eq.${user.id}`, limit: 1 },
    })
  )[0];
  if (existing) return existing.customer_id;
  // No cardholder-name prefill. Idempotency protects a retried customer creation.
  const customer = testObject(
    await stripe.customers.create(
      { email: user.email },
      { idempotencyKey: `klui-customer-${user.id}` },
    ),
  );
  await db.request("stripe_customers", {
    method: "POST",
    query: { on_conflict: "user_id" },
    body: { user_id: user.id, customer_id: customer.id },
    prefer: "resolution=ignore-duplicates",
  });
  return customer.id;
}
export async function createStripeCheckout({
  db,
  user,
  plan,
  coupon,
  config,
  stripe = stripeClient(config),
}) {
  const priceId = config.stripe.prices[plan.id];
  if (!priceId)
    throw new HttpError(503, "Stripe price is not configured for this plan.");
  const price = testObject(await stripe.prices.retrieve(priceId));
  const { renewalAmount, initialAmount } = stripeCharges(plan, coupon, config);
  if (
    !price.active ||
    price.currency !== "aed" ||
    price.unit_amount !== Math.round(renewalAmount * 100) ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.tax_behavior !== "exclusive"
  ) {
    throw new HttpError(
      503,
      "Stripe price does not match the configured monthly plan.",
    );
  }
  if (config.stripe.automaticTax) {
    const [settings, registrations] = await Promise.all([
      stripe.tax.settings.retrieve(),
      stripe.tax.registrations.list({ status: "active", limit: 100 }),
    ]);
    if (
      settings.status !== "active" ||
      !registrations.data.length ||
      !config.stripe.taxCode
    ) {
      throw new HttpError(
        503,
        "Confirm Stripe Tax settings, product classification and registrations before enabling collection.",
      );
    }
    const product = await stripe.products.retrieve(id(price.product));
    if (id(product.tax_code) !== config.stripe.taxCode)
      throw new HttpError(
        503,
        "Stripe product tax classification does not match configuration.",
      );
  }
  const customer = await stripeCustomer(db, user, stripe);
  const token = randomUUID();
  const expires = Math.floor(Date.now() / 1000) + 3600;
  await db.rpc("klui_reserve_stripe_checkout", {
    p_checkout: {
      id: token,
      user_id: user.id,
      customer_id: customer,
      plan_id: plan.id,
      price_id: priceId,
      coupon_code: coupon?.code || null,
      affiliate_coupon_id: coupon?.affiliateCouponId || null,
      account_hashes: coupon ? couponAccountHashes(config, user) : [],
      free_trial: coupon?.percentOff === 100,
      expires_at: iso(expires),
    },
  });
  // No raw card fields and no manual renewal charges. Stripe Billing owns the schedule.
  const subscriptionData = {};
  let discounts;
  if (coupon?.percentOff === 100) {
    const trialEnd = new Date();
    if (coupon.trialDays)
      trialEnd.setUTCDate(trialEnd.getUTCDate() + coupon.trialDays);
    else {
      const day = trialEnd.getUTCDate();
      trialEnd.setUTCMonth(trialEnd.getUTCMonth() + 1);
      if (trialEnd.getUTCDate() !== day) trialEnd.setUTCDate(0);
    }
    subscriptionData.trial_end = Math.floor(trialEnd.getTime() / 1000);
    subscriptionData.trial_settings = {
      end_behavior: { missing_payment_method: "cancel" },
    };
  } else if (coupon) {
    const amountOff = Math.round((renewalAmount - initialAmount) * 100);
    const nativeCoupon = await stripe.coupons.create(
      {
        duration: "once",
        currency: "aed",
        amount_off: amountOff,
        name: `${coupon.code} · ${coupon.percentOff}% off month 1`,
      },
      { idempotencyKey: `klui-coupon-${token}` },
    );
    discounts = [{ coupon: nativeCoupon.id }];
  }
  const session = testObject(
    await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer,
        adaptive_pricing: { enabled: false },
        client_reference_id: token,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: subscriptionData,
        ...(discounts ? { discounts } : {}),
        payment_method_collection: "always",
        expires_at: expires,
        automatic_tax: { enabled: config.stripe.automaticTax },
        ...(config.stripe.automaticTax
          ? {
              billing_address_collection: "required",
              customer_update: { address: "auto" },
              tax_id_collection: { enabled: true },
            }
          : {}),
        success_url: `${config.appUrl}/?stripe=success`,
        cancel_url: `${config.appUrl}/?stripe=cancelled`,
        integration_identifier: `klui-hosted-${randomBytes(8).toString("hex").replace(/[0-9]/g, "a").slice(0, 8)}`,
      },
      { idempotencyKey: `klui-checkout-${token}` },
    ),
  );
  await db.request("stripe_checkouts", {
    method: "PATCH",
    query: { id: `eq.${token}` },
    body: { session_id: session.id },
  });
  return {
    paymentUrl: session.url,
    checkout: "stripe",
    ...(coupon ? { offer: stripeOffer(plan, coupon, config) } : {}),
  };
}

async function checkoutForSubscription(db, stripe, sub) {
  const rows = await db.request("stripe_checkouts", {
    query: {
      customer_id: `eq.${id(sub.customer)}`,
      select: "*",
      order: "created_at.desc",
    },
  });
  for (const row of rows) {
    if (row.subscription_id === sub.id) return row;
    if (row.subscription_id) continue;
    const session = row.session_id
      ? testObject(await stripe.checkout.sessions.retrieve(row.session_id))
      : await findCheckoutSession(stripe, row);
    if (!session) continue;
    if (
      id(session.subscription) === sub.id &&
      id(session.customer) === row.customer_id &&
      session.status === "complete"
    )
      return row;
  }
  return null;
}
async function findCheckoutSession(stripe, checkout) {
  for await (const session of stripe.checkout.sessions.list({
    customer: checkout.customer_id,
    limit: 100,
  })) {
    testObject(session);
    if (session.client_reference_id === checkout.id) return session;
  }
  return null;
}

// Reopening an unchanged checkout is safe; changing plan/code first expires the old
// payable session. Do not release its claim until Stripe confirms it cannot be paid.
export async function resumeStripeCheckout({
  db,
  user,
  plan,
  code,
  config,
  stripe = stripeClient(config),
}) {
  const rows = await db.request("stripe_checkouts", {
    query: {
      user_id: `eq.${user.id}`,
      completed: "eq.false",
      expires_at: `gt.${new Date().toISOString()}`,
    },
  });
  for (const row of rows) {
    const session = row.session_id
      ? testObject(await stripe.checkout.sessions.retrieve(row.session_id))
      : await findCheckoutSession(stripe, row);
    if (!session)
      throw new HttpError(
        409,
        "Your previous checkout is still being prepared. Please try again shortly.",
      );
    if (session.status === "complete") {
      if (id(session.subscription))
        await syncStripeSubscription({
          db,
          config,
          stripe,
          subscriptionId: id(session.subscription),
        });
      throw new HttpError(
        409,
        "Your subscription is being confirmed. Refresh your account before opening another checkout.",
      );
    }
    if (
      session.status === "open" &&
      row.plan_id === plan.id &&
      (row.coupon_code || "") === code
    ) {
      return { paymentUrl: session.url, checkout: "stripe" };
    }
    if (session.status === "open")
      await stripe.checkout.sessions.expire(session.id);
    await db.rpc("klui_expire_stripe_checkout", { p_checkout_id: row.id });
  }
  return null;
}
function invoiceSubscription(invoice) {
  return id(invoice.parent?.subscription_details?.subscription);
}
export async function invoiceForCharge(stripe, charge) {
  if (!id(charge.payment_intent)) return [];
  const invoices = [];
  for await (const payment of stripe.invoicePayments.list({
    payment: {
      type: "payment_intent",
      payment_intent: id(charge.payment_intent),
    },
    status: "paid",
    limit: 100,
  })) {
    invoices.push(
      testObject(await stripe.invoices.retrieve(id(payment.invoice))),
    );
  }
  return invoices;
}

export async function syncStripeSubscription({
  db,
  config,
  subscriptionId,
  stripe = stripeClient(config),
  block = null,
  refundInvoice = null,
}) {
  const observedAt = new Date().toISOString();
  let sub = testObject(await stripe.subscriptions.retrieve(subscriptionId));
  const checkout = await checkoutForSubscription(db, stripe, sub);
  if (!checkout) return null; // Unrelated Stripe products/accounts never provision Klui.
  if (
    sub.items.data.length !== 1 ||
    sub.items.data[0].price.id !== checkout.price_id ||
    sub.items.data[0].quantity !== 1
  ) {
    block = "unexpected_price";
  }
  let paidThrough = null,
    paidInvoice = null;
  // Recover missed invoice/refund events too, rather than trusting only the latest invoice.
  for await (const invoice of stripe.invoices.list({
    subscription: sub.id,
    status: "paid",
    limit: 100,
  })) {
    testObject(invoice);
    if (invoice.currency !== "aed" || invoice.amount_paid <= 0) continue;
    let refunded = 0,
      captured = 0;
    for await (const payment of stripe.invoicePayments.list({
      invoice: invoice.id,
      status: "paid",
      limit: 100,
    })) {
      const piId = id(payment.payment?.payment_intent);
      if (!piId) continue;
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ["latest_charge"],
      });
      const charge = pi.latest_charge;
      if (!charge || typeof charge === "string") continue;
      if (
        pi.status !== "succeeded" ||
        !charge.paid ||
        !charge.captured ||
        charge.currency !== "aed"
      )
        continue;
      captured += payment.amount_paid || 0;
      refunded += charge.amount_refunded || 0;
      if (charge.disputed) block ||= "dispute";
      const warnings = await stripe.radar.earlyFraudWarnings.list({
        charge: charge.id,
        limit: 1,
      });
      if (warnings.data.length) block ||= "fraud_warning";
    }
    // An invoice marked paid out of band is not a successful Stripe charge.
    if (captured < invoice.amount_paid) continue;
    if (refunded >= invoice.amount_paid) {
      block ||= "full_refund";
      refundInvoice ||= invoice.id;
    }
    const lines = invoice.lines.has_more
      ? await stripe.invoices
          .listLineItems(invoice.id, { limit: 100 })
          .autoPagingToArray({ limit: 1000 })
      : invoice.lines.data;
    for (const line of lines) {
      if (line.pricing?.price_details?.price !== checkout.price_id) continue;
      const end = iso(line.period?.end);
      if (end && (!paidThrough || end > paidThrough)) paidThrough = end;
    }
    // Oldest paid invoice establishes the original paid referral, regardless of delivery order.
    paidInvoice = invoice.id;
  }
  let cardHash = null;
  if (sub.status === "trialing" && checkout.free_trial) {
    let pm = sub.default_payment_method;
    if (!pm) {
      const customer = await stripe.customers.retrieve(checkout.customer_id);
      pm = customer.invoice_settings?.default_payment_method;
    }
    if (id(pm)) {
      const method = await stripe.paymentMethods.retrieve(id(pm));
      const fingerprint = method.card?.fingerprint;
      if (fingerprint)
        cardHash = createHmac("sha256", config.mamo.couponIdentitySecret)
          .update(`stripe-card:v1:${fingerprint}`)
          .digest("hex");
    }
  }
  const result = await db.rpc("klui_apply_stripe_subscription", {
    p_checkout_id: checkout.id,
    p_subscription_id: sub.id,
    p_status: sub.status,
    p_cancel: Boolean(sub.cancel_at_period_end),
    p_paid_through: paidThrough,
    p_trial_end: iso(sub.trial_end),
    p_invoice_id: paidInvoice,
    p_refund_invoice_id: refundInvoice,
    p_card_hash: cardHash,
    p_blocked_reason: block,
    p_observed_at: observedAt,
  });
  const blocked = result?.raw?.blocked_reason || result?.blocked_reason;
  if (blocked) {
    // Persist the access block BEFORE contacting Stripe; retries finish stopping renewal.
    if (sub.status !== "canceled")
      sub = testObject(
        await stripe.subscriptions.cancel(sub.id, {
          prorate: false,
          invoice_now: false,
        }),
      );
    // A coupon race must never leave a customer charged for access we refused.
    if (["coupon_identity_conflict", "trial_card_conflict"].includes(blocked)) {
      for await (const invoice of stripe.invoices.list({
        subscription: sub.id,
        status: "paid",
        limit: 100,
      })) {
        for await (const payment of stripe.invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 100,
        })) {
          const pi = id(payment.payment?.payment_intent);
          if (pi)
            await stripe.refunds.create(
              { payment_intent: pi },
              { idempotencyKey: `klui-rejected-${checkout.id}-${pi}` },
            );
        }
      }
    }
  }
  return result;
}

export async function processStripeEvent(
  event,
  { db, config, stripe = stripeClient(config) },
) {
  testObject(event);
  if (!STRIPE_EVENTS.includes(event.type)) return;
  const object = event.data.object;
  const ids = new Set();
  let block = null,
    refundInvoice = null;
  if (event.type.startsWith("customer.subscription.")) ids.add(object.id);
  else if (event.type.startsWith("checkout.session.")) {
    if (id(object.subscription)) ids.add(id(object.subscription));
  } else if (event.type.startsWith("invoice.")) {
    const invoice = testObject(await stripe.invoices.retrieve(object.id));
    if (invoiceSubscription(invoice)) ids.add(invoiceSubscription(invoice));
  } else {
    const charge = testObject(
      await stripe.charges.retrieve(
        event.type === "charge.refunded" ? object.id : id(object.charge),
      ),
    );
    if (
      event.type === "charge.refunded" &&
      charge.amount_refunded < charge.amount
    )
      return;
    block =
      event.type === "charge.refunded"
        ? "full_refund"
        : event.type === "charge.dispute.created"
          ? "dispute"
          : "fraud_warning";
    for (const invoice of await invoiceForCharge(stripe, charge)) {
      if (invoiceSubscription(invoice)) ids.add(invoiceSubscription(invoice));
      if (block === "full_refund") refundInvoice = invoice.id;
    }
  }
  for (const subscriptionId of ids)
    await syncStripeSubscription({
      db,
      config,
      stripe,
      subscriptionId,
      block,
      refundInvoice,
    });
}

export async function cancelStripeRenewal({
  db,
  userId,
  config,
  stripe = stripeClient(config),
}) {
  const subscription = await db.getLatestSubscription(userId);
  if (subscription?.provider !== "stripe")
    throw new HttpError(400, "No Stripe subscription was found.");
  const binding = (
    await db.request("stripe_customers", {
      query: { user_id: `eq.${userId}`, limit: 1 },
    })
  )[0];
  const sub = testObject(
    await stripe.subscriptions.retrieve(subscription.provider_subscription_id),
  );
  if (id(sub.customer) !== binding?.customer_id)
    throw new HttpError(403, "Subscription ownership mismatch.");
  if (sub.status !== "canceled")
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  return syncStripeSubscription({ db, config, stripe, subscriptionId: sub.id });
}
export async function deleteStripeBilling({
  db,
  userId,
  config,
  stripe = stripeClient(config),
}) {
  const rows = await db.request("stripe_customers", {
    query: { user_id: `eq.${userId}`, limit: 1 },
  });
  if (!rows.length) return;
  const customer = rows[0].customer_id;
  for await (const session of stripe.checkout.sessions.list({
    customer,
    status: "open",
    limit: 100,
  }))
    await stripe.checkout.sessions.expire(session.id);
  // Include subscriptions whose webhook was lost. A failure prevents account deletion.
  for await (const sub of stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 100,
  })) {
    if (!["canceled", "incomplete_expired"].includes(sub.status))
      await stripe.subscriptions.cancel(sub.id, {
        prorate: false,
        invoice_now: false,
      });
  }
}
export async function reconcileStripe({
  db,
  config,
  stripe = stripeClient(config),
}) {
  let cursor = null,
    failures = 0;
  for (;;) {
    const rows = await db.request("stripe_customers", {
      query: {
        select: "user_id,customer_id",
        order: "user_id.asc",
        limit: 1000,
        ...(cursor ? { user_id: `gt.${cursor}` } : {}),
      },
    });
    for (const row of rows) {
      try {
        for await (const sub of stripe.subscriptions.list({
          customer: row.customer_id,
          status: "all",
          limit: 100,
        })) {
          try {
            await syncStripeSubscription({
              db,
              config,
              stripe,
              subscriptionId: sub.id,
            });
          } catch {
            failures += 1;
          }
        }
      } catch {
        failures += 1;
      }
    }
    if (rows.length < 1000) break;
    cursor = rows.at(-1).user_id;
  }
  if (failures)
    throw new HttpError(
      503,
      "Some Stripe accounts could not be reconciled; the next sweep will retry them.",
    );
}
