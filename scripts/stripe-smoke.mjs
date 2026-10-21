// Real Stripe TEST API + isolated local Supabase. Creates disposable fixtures, then cleans them.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadConfig, validateRuntimeConfig } from "../server/config.js";
import { SupabaseRest } from "../server/db/supabaseRest.js";
import {
  stripeClient,
  syncStripeSubscription,
  cancelStripeRenewal,
  deleteStripeBilling,
  reconcileStripe,
} from "../server/saas/stripe.js";
import { couponAccountHashes } from "../server/saas/mamo.js";

const config = validateRuntimeConfig(loadConfig()),
  db = new SupabaseRest(config),
  stripe = stripeClient(config);
const sb = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});
const fixtures = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clockAdvance(clock, time) {
  await stripe.testHelpers.testClocks.advance(clock, { frozen_time: time });
  for (let i = 0; i < 90; i++) {
    const c = await stripe.testHelpers.testClocks.retrieve(clock);
    if (c.status === "ready") return;
    await sleep(1000);
  }
  throw Error("Test clock did not become ready in 90 seconds");
}
async function fixture({ trial = false, discount = false } = {}) {
  const password = randomBytes(24).toString("hex"),
    email = `stripe-smoke-${randomUUID()}@example.test`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const user = { id: data.user.id, email, raw: data.user };
  await db.upsertProfile(user);
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: "Klui disposable billing test",
  });
  const customer = await stripe.customers.create({
    email,
    test_clock: clock.id,
  });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });
  await db.request("stripe_customers", {
    method: "POST",
    body: { user_id: user.id, customer_id: customer.id },
  });
  const token = randomUUID();
  await db.rpc("klui_reserve_stripe_checkout", {
    p_checkout: {
      id: token,
      user_id: user.id,
      customer_id: customer.id,
      plan_id: "pro",
      price_id: config.stripe.prices.pro,
      coupon_code: trial ? "FIRSTFREE" : discount ? "FIRST50" : null,
      account_hashes:
        trial || discount ? couponAccountHashes(config, user) : [],
      free_trial: trial,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  const coupon = discount
    ? await stripe.coupons.create({
        duration: "once",
        amount_off: 1500,
        currency: "aed",
      })
    : null;
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: config.stripe.prices.pro }],
    default_payment_method: pm.id,
    ...(trial ? { trial_end: clock.frozen_time + 7 * 86400 } : {}),
    ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
    payment_behavior: "error_if_incomplete",
  });
  await db.request("stripe_checkouts", {
    method: "PATCH",
    query: { id: `eq.${token}` },
    body: { subscription_id: sub.id },
  });
  const f = { user, clock, customer, sub, coupon, token };
  fixtures.push(f);
  return f;
}
async function sync(f) {
  await syncStripeSubscription({
    db,
    config,
    stripe,
    subscriptionId: f.sub.id,
  });
  return db.getLatestSubscription(f.user.id);
}
async function checkHostedCheckouts() {
  const password = randomBytes(24).toString("hex"),
    email = `stripe-hosted-${randomUUID()}@example.test`;
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const login = await sb.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const headers = {
    authorization: `Bearer ${login.data.session.access_token}`,
    "content-type": "application/json",
  };
  const post = async (path, body) => {
    const r = await fetch(config.appUrl + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    const invalid = await post("/api/payments/stripe/coupon", {
      coupon: "INVALID",
    });
    assert.equal(invalid.status, 400);
    const offer = await post("/api/payments/stripe/coupon", {
      coupon: "FIRST50",
    });
    assert.equal(offer.status, 200);
    assert.equal(
      offer.body.offers.find((x) => x.planId === "pro").initialChargeAed,
      15,
    );
    let previous = null;
    for (const [planId, code, amount] of [
      ["lite", "FIRST50", 750],
      ["pro", "FIRST50", 1500],
      ["pro", "FIRSTFREE", 0],
      ["pro", "", 3000],
    ]) {
      const payload = { planId, coupon: code };
      const created = await post("/api/payments/stripe", payload);
      assert.equal(created.status, 200, JSON.stringify(created.body));
      const csId = created.body.paymentUrl.match(/cs_test_[A-Za-z0-9]+/)[0];
      const cs = await stripe.checkout.sessions.retrieve(csId);
      assert.equal(cs.amount_total, amount);
      assert.equal(cs.currency, "aed");
      assert.equal(cs.adaptive_pricing.enabled, false);
      assert.ok(cs.customer_details?.name == null);
      assert.equal(cs.customer_email, null);
      const again = await post("/api/payments/stripe", payload);
      assert.equal(again.status, 200);
      assert.equal(again.body.paymentUrl, created.body.paymentUrl);
      if (previous)
        assert.equal(
          (await stripe.checkout.sessions.retrieve(previous)).status,
          "expired",
        );
      previous = csId;
    }
    const portal = await post("/api/payments/stripe/portal", {});
    assert.equal(portal.status, 200);
    assert.ok(portal.body.url.startsWith("https://billing.stripe.com/"));
    console.log(
      "PASS real authenticated Checkout: Plus/Pro discounts, zero trial total, AED-only totals, no name prefill, resume, plan/code switch, and Customer Portal.",
    );
  } finally {
    await deleteStripeBilling({ db, userId: data.user.id, config, stripe });
    const rows = await db.request("stripe_checkouts", {
      query: { user_id: `eq.${data.user.id}` },
    });
    for (const row of rows)
      await db.request("stripe_coupon_ledger", {
        method: "DELETE",
        query: { checkout_id: `eq.${row.id}` },
      });
    await sb.auth.admin.deleteUser(data.user.id);
  }
}

try {
  await checkHostedCheckouts();
  const f = await fixture({ discount: true });
  let row = await sync(f);
  assert.equal(row.status, "active");
  let invoices = await stripe.invoices.list({
    subscription: f.sub.id,
    limit: 100,
  });
  assert.equal(invoices.data[0].amount_paid, 1500);
  const initialInvoice = invoices.data[0];
  console.log(
    "PASS real first invoice: AED 15; authoritative reconciliation unlocked Pro.",
  );
  let sub = await stripe.subscriptions.retrieve(f.sub.id);
  await clockAdvance(f.clock.id, sub.items.data[0].current_period_end + 3600);
  await stripe.invoices.list({ subscription: sub.id, limit: 100 });
  // A clock can be ready before all async invoice finalization has settled.
  for (let i = 0; i < 45; i++) {
    invoices = await stripe.invoices.list({ subscription: sub.id, limit: 100 });
    if (invoices.data.some((x) => x.amount_paid === 3000)) break;
    await sleep(1000);
  }
  assert.ok(
    invoices.data.some((x) => x.amount_paid === 3000),
    "normal recurring invoice was not automatically paid",
  );
  row = await sync(f);
  assert.ok(
    Date.parse(row.current_period_end) >
      Date.parse(
        new Date(initialInvoice.lines.data[0].period.end * 1000).toISOString(),
      ),
  );
  console.log(
    "PASS test-clock renewal: native 50% coupon expired; Stripe automatically charged AED 30 and extended access.",
  );
  const latest = invoices.data.find((x) => x.amount_paid === 3000);
  const payment = (
    await stripe.invoicePayments.list({
      invoice: latest.id,
      status: "paid",
      limit: 100,
    })
  ).data[0];
  const pi =
    typeof payment.payment.payment_intent === "string"
      ? payment.payment.payment_intent
      : payment.payment.payment_intent.id;
  await stripe.refunds.create({ payment_intent: pi, amount: 1000 });
  row = await sync(f);
  assert.equal(row.status, "active");
  await stripe.refunds.create({ payment_intent: pi, amount: 2000 });
  row = await sync(f);
  assert.equal(row.status, "canceled");
  assert.equal(row.current_period_end, null);
  await sync(f);
  assert.equal(
    (await stripe.subscriptions.retrieve(sub.id)).status,
    "canceled",
  );
  console.log(
    "PASS partial refund retains access; cumulative full refund revokes access, stops renewal, and survives replay.",
  );
  const trial = await fixture({ trial: true });
  row = await sync(trial);
  assert.equal(row.status, "trialing");
  assert.equal(
    (await stripe.invoices.list({ subscription: trial.sub.id, limit: 10 }))
      .data[0].amount_paid,
    0,
  );
  const repeat = await fixture({ trial: true });
  const rejected = await sync(repeat);
  assert.equal(rejected.status, "canceled");
  assert.equal(rejected.raw.blocked_reason, "trial_card_conflict");
  console.log(
    "PASS same Stripe card fingerprint on another account is refused and canceled.",
  );
  await clockAdvance(trial.clock.id, trial.sub.trial_end + 3600);
  for (let i = 0; i < 45; i++) {
    invoices = await stripe.invoices.list({
      subscription: trial.sub.id,
      limit: 100,
    });
    if (invoices.data.some((x) => x.amount_paid === 3000)) break;
    await sleep(1000);
  }
  assert.ok(invoices.data.some((x) => x.amount_paid === 3000));
  row = await sync(trial);
  assert.equal(row.status, "active");
  console.log(
    "PASS free trial: zero charge, saved-card claim, then automatic AED 30 paid conversion.",
  );
  const paidEnd = row.current_period_end;
  const failPm = await stripe.paymentMethods.attach(
    "pm_card_chargeCustomerFail",
    { customer: trial.customer.id },
  );
  await stripe.subscriptions.update(trial.sub.id, {
    default_payment_method: failPm.id,
  });
  sub = await stripe.subscriptions.retrieve(trial.sub.id);
  await clockAdvance(
    trial.clock.id,
    sub.items.data[0].current_period_end + 3600,
  );
  for (let i = 0; i < 45; i++) {
    sub = await stripe.subscriptions.retrieve(trial.sub.id);
    if (sub.status === "past_due") break;
    await sleep(1000);
  }
  row = await sync(trial);
  assert.equal(sub.status, "past_due");
  assert.equal(row.current_period_end, paidEnd);
  console.log("PASS failed renewal: paid-through access was not extended.");
  await cancelStripeRenewal({ db, userId: trial.user.id, config, stripe });
  assert.equal(
    (await stripe.subscriptions.retrieve(trial.sub.id)).cancel_at_period_end,
    true,
  );
  await deleteStripeBilling({ db, userId: trial.user.id, config, stripe });
  assert.equal(
    (await stripe.subscriptions.retrieve(trial.sub.id)).status,
    "canceled",
  );
  console.log("PASS owned cancellation and account-deletion cleanup.");
  await reconcileStripe({ db, config, stripe });
  console.log("PASS missed-event recovery sweep.");
} finally {
  for (const f of fixtures.reverse()) {
    try {
      await deleteStripeBilling({ db, userId: f.user.id, config, stripe });
      await stripe.testHelpers.testClocks.del(f.clock.id);
      await db.request("stripe_coupon_ledger", {
        method: "DELETE",
        query: { checkout_id: `eq.${f.token}` },
      });
      await sb.auth.admin.deleteUser(f.user.id);
      if (f.coupon) await stripe.coupons.del(f.coupon.id);
    } catch {
      console.error("A disposable Stripe fixture needs cleanup.");
    }
  }
}
