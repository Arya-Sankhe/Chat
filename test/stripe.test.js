import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { loadConfig, validateRuntimeConfig } from "../server/config.js";
import {
  assertStripeSandbox,
  stripeCharges,
  stripeOffer,
  createStripeCheckout,
  syncStripeSubscription,
  processStripeEvent,
  cancelStripeRenewal,
  deleteStripeBilling,
} from "../server/saas/stripe.js";
import { hasActiveSubscription } from "../server/saas/entitlements.js";
import { handleStripeWebhook } from "../server/routes/stripe.js";
import { API_DEPENDENCIES } from "../server/routes/context.js";
import { Readable } from "node:stream";

const config = () =>
  loadConfig({
    ACCESS_MODE: "subscription",
    PAYMENT_PROVIDER: "stripe",
    SUPABASE_URL: "http://127.0.0.1:56321",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_PRO_PRICE_ID: "price_pro",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    MAMO_COUPON_IDENTITY_SECRET:
      "fixture-identity-secret-at-least-32-characters",
    APP_URL: "http://localhost:3321",
  });
const user = {
  id: "user-test",
  email: "test@example.test",
  raw: { email: "test@example.test", email_confirmed_at: "2026-01-01" },
};
const list = (data) => ({
  async *[Symbol.asyncIterator]() {
    yield* data;
  },
});
function fixture({
  status = "active",
  paid = true,
  refunded = 0,
  trial = false,
} = {}) {
  const checkout = {
    id: "checkout",
    customer_id: "cus_test",
    subscription_id: "sub_test",
    session_id: "cs_test",
    price_id: "price_pro",
    free_trial: trial,
  };
  const subscription = {
    id: "sub_test",
    livemode: false,
    customer: "cus_test",
    status,
    cancel_at_period_end: false,
    trial_end: Math.floor(Date.now() / 1000) + 86400,
    default_payment_method: "pm_test",
    items: { data: [{ price: { id: "price_pro" }, quantity: 1 }] },
  };
  const calls = [];
  const db = {
    request: async () => [checkout],
    rpc: async (name, p) => {
      calls.push({ name, p });
      return {
        provider: "stripe",
        raw: { blocked_reason: p.p_blocked_reason },
      };
    },
  };
  const invoice = {
    id: "in_test",
    livemode: false,
    currency: "aed",
    amount_paid: 3000,
    parent: { subscription_details: { subscription: "sub_test" } },
    lines: {
      data: [
        {
          pricing: { price_details: { price: "price_pro" } },
          period: { end: 1900000000 },
        },
      ],
    },
  };
  const stripe = {
    subscriptions: {
      retrieve: async () => subscription,
      cancel: async () => {
        calls.push("cancel");
        return { ...subscription, status: "canceled" };
      },
      update: async (id, p) => {
        calls.push({ update: p });
        subscription.cancel_at_period_end = p.cancel_at_period_end;
        return subscription;
      },
      list: () => list([subscription]),
    },
    invoices: {
      list: () => list(paid ? [invoice] : []),
      retrieve: async () => invoice,
    },
    invoicePayments: {
      list: () =>
        list([
          {
            invoice: "in_test",
            amount_paid: 3000,
            payment: { payment_intent: "pi_test" },
          },
        ]),
    },
    paymentIntents: {
      retrieve: async () => ({
        status: "succeeded",
        latest_charge: {
          id: "ch_test",
          amount_refunded: refunded,
          paid: true,
          captured: true,
          currency: "aed",
        },
      }),
    },
    radar: { earlyFraudWarnings: { list: async () => ({ data: [] }) } },
    paymentMethods: {
      retrieve: async () => ({ card: { fingerprint: "card_fingerprint" } }),
    },
    charges: {
      retrieve: async () => ({
        id: "ch_test",
        livemode: false,
        amount: 3000,
        amount_refunded: refunded,
        payment_intent: "pi_test",
      }),
    },
    checkout: {
      sessions: {
        list: () => list([{ id: "cs_open" }]),
        expire: async () => calls.push("expire"),
      },
    },
    refunds: { create: async () => calls.push("refund") },
  };
  return { checkout, subscription, calls, db, stripe, invoice };
}
test("Stripe sandbox fails closed for live keys and production databases", () => {
  assert.doesNotThrow(() => validateRuntimeConfig(config()));
  for (const [key, value] of [
    ["STRIPE_SECRET_KEY", "sk_live_fixture"],
    ["SUPABASE_URL", "https://production.supabase.co"],
  ]) {
    const env = {
      ACCESS_MODE: "subscription",
      PAYMENT_PROVIDER: "stripe",
      SUPABASE_URL: "http://127.0.0.1:56321",
      STRIPE_SECRET_KEY: "sk_test_fixture",
      [key]: value,
    };
    assert.throws(
      () => validateRuntimeConfig(loadConfig(env)),
      /sandbox requires/,
    );
    assert.throws(
      () => assertStripeSandbox(loadConfig(env)),
      /sandbox requires/,
    );
  }
});
test("Stripe discount reduces base before grossing up; a free trial has no fee", () => {
  const c = config(),
    plan = { amountAed: 30, id: "pro" };
  assert.deepEqual(stripeCharges(plan, { percentOff: 50 }, c), {
    renewalAmount: 30,
    initialAmount: 15,
  });
  c.stripe.fees = { percent: 3.4, fixedAed: 1, vatPercent: 5 };
  assert.deepEqual(stripeCharges(plan, { percentOff: 50 }, c), {
    renewalAmount: 32.19,
    initialAmount: 16.65,
  });
  assert.equal(
    stripeOffer(plan, { code: "FREE", percentOff: 100 }, c).initialChargeAed,
    0,
  );
});
test("Checkout binds ownership first and uses a native first-invoice discount, not a second charge", async () => {
  const c = config(),
    calls = [];
  let sessionParams, couponParams;
  const stripe = {
    prices: {
      retrieve: async () => ({
        livemode: false,
        active: true,
        currency: "aed",
        unit_amount: 3000,
        recurring: { interval: "month", interval_count: 1 },
        tax_behavior: "exclusive",
      }),
    },
    coupons: {
      create: async (p) => {
        couponParams = p;
        return { id: "coupon_native" };
      },
    },
    checkout: {
      sessions: {
        create: async (p) => {
          sessionParams = p;
          calls.push("stripe");
          return {
            livemode: false,
            id: "cs_test",
            url: "https://checkout.stripe.com/test",
          };
        },
      },
    },
  };
  const db = {
    request: async (path, args) => {
      if (path === "stripe_customers") return [{ customer_id: "cus_test" }];
      calls.push("bound");
    },
    rpc: async () => calls.push("reserved"),
  };
  const result = await createStripeCheckout({
    db,
    user,
    plan: { id: "pro", amountAed: 30 },
    coupon: { code: "FIRST50", percentOff: 50 },
    config: c,
    stripe,
  });
  assert.deepEqual(calls, ["reserved", "stripe", "bound"]);
  assert.equal(couponParams.duration, "once");
  assert.equal(couponParams.amount_off, 1500);
  assert.equal(sessionParams.mode, "subscription");
  assert.equal(sessionParams.customer, "cus_test");
  assert.deepEqual(sessionParams.discounts, [{ coupon: "coupon_native" }]);
  assert.equal(sessionParams.payment_method_types, undefined);
  assert.equal(sessionParams.customer_email, undefined);
  assert.equal(sessionParams.name, undefined);
  assert.match(sessionParams.integration_identifier, /klui-hosted-[a-z]{8}$/);
  assert.equal(result.checkout, "stripe");
});
test("Free Checkout requires a card and uses a native trial with cancellation when payment method is missing", async () => {
  const c = config();
  let params;
  const stripe = {
    prices: {
      retrieve: async () => ({
        livemode: false,
        active: true,
        currency: "aed",
        unit_amount: 3000,
        recurring: { interval: "month", interval_count: 1 },
        tax_behavior: "exclusive",
      }),
    },
    checkout: {
      sessions: {
        create: async (p) => {
          params = p;
          return {
            livemode: false,
            id: "cs_test",
            url: "https://checkout.stripe.com/test",
          };
        },
      },
    },
  };
  const db = {
    request: async (path) =>
      path === "stripe_customers" ? [{ customer_id: "cus_test" }] : [],
    rpc: async () => ({}),
  };
  await createStripeCheckout({
    db,
    user,
    plan: { id: "pro", amountAed: 30 },
    coupon: { code: "FREETRIAL", percentOff: 100, trialDays: 7 },
    config: c,
    stripe,
  });
  assert.equal(params.payment_method_collection, "always");
  assert.equal(params.discounts, undefined);
  assert.ok(params.subscription_data.trial_end > Date.now() / 1000 + 6 * 86400);
  assert.equal(
    params.subscription_data.trial_settings.end_behavior.missing_payment_method,
    "cancel",
  );
});
test("Wrong price and unconfigured Tax stop checkout before any customer or session is created", async () => {
  const c = config();
  const price = {
    livemode: false,
    active: true,
    currency: "aed",
    unit_amount: 123,
    recurring: { interval: "month", interval_count: 1 },
    tax_behavior: "exclusive",
  };
  const stripe = { prices: { retrieve: async () => price } };
  const args = {
    db: {},
    user,
    plan: { id: "pro", amountAed: 30 },
    config: c,
    stripe,
  };
  await assert.rejects(createStripeCheckout(args), /does not match/);
  price.unit_amount = 3000;
  c.stripe.automaticTax = true;
  stripe.tax = {
    settings: { retrieve: async () => ({ status: "pending" }) },
    registrations: { list: async () => ({ data: [] }) },
  };
  await assert.rejects(createStripeCheckout(args), /Confirm Stripe Tax/);
});
test("An active subscription without a paid invoice grants no paid period", async () => {
  const f = fixture({ paid: false });
  await syncStripeSubscription({
    ...f,
    config: config(),
    subscriptionId: "sub_test",
  });
  assert.equal(f.calls[0].p.p_paid_through, null);
  assert.equal(f.calls[0].p.p_invoice_id, null);
  assert.equal(
    hasActiveSubscription({
      provider: "stripe",
      status: "active",
      current_period_end: null,
    }),
    false,
  );
});
test("Renewals extend access only to verified paid invoice lines; past-due keeps the last paid timestamp", async () => {
  const f = fixture({ status: "past_due" });
  await syncStripeSubscription({
    ...f,
    config: config(),
    subscriptionId: "sub_test",
  });
  assert.equal(
    f.calls[0].p.p_paid_through,
    new Date(1900000000 * 1000).toISOString(),
  );
  assert.equal(f.calls[0].p.p_status, "past_due");
  assert.equal(f.calls[0].p.p_invoice_id, "in_test");
});
test("A card-required trial passes a hashed fingerprint for the atomic claim", async () => {
  const f = fixture({ status: "trialing", trial: true, paid: false });
  await syncStripeSubscription({
    ...f,
    config: config(),
    subscriptionId: "sub_test",
  });
  assert.match(f.calls[0].p.p_card_hash, /^[a-f0-9]{64}$/);
  assert.ok(f.calls[0].p.p_trial_end);
});
test("Full refund persists a block before cancellation; partial refund retains access", async () => {
  for (const amount of [1500, 3000]) {
    const f = fixture({ refunded: amount });
    await syncStripeSubscription({
      ...f,
      config: config(),
      subscriptionId: "sub_test",
    });
    assert.equal(
      f.calls[0].p.p_blocked_reason,
      amount === 3000 ? "full_refund" : null,
    );
    assert.equal(f.calls.includes("cancel"), amount === 3000);
  }
});
test("Refund and dispute events resolve ownership through invoice payments rather than metadata", async () => {
  const f = fixture({ refunded: 3000 });
  await processStripeEvent(
    {
      livemode: false,
      type: "charge.refunded",
      data: { object: { id: "ch_test", metadata: { userId: "attacker" } } },
    },
    { ...f, config: config() },
  );
  assert.equal(f.calls[0].p.p_subscription_id, "sub_test");
  assert.equal(f.calls[0].p.p_blocked_reason, "full_refund");
  await assert.rejects(
    processStripeEvent(
      { livemode: true, type: "invoice.paid" },
      { ...f, config: config() },
    ),
    /sandbox object/,
  );
});
test("Cancellation checks the locally bound customer before changing Stripe", async () => {
  const f = fixture();
  f.db.getLatestSubscription = async () => ({
    provider: "stripe",
    provider_subscription_id: "sub_test",
  });
  f.db.request = async (path) =>
    path === "stripe_customers" ? [{ customer_id: "cus_other" }] : [f.checkout];
  await assert.rejects(
    cancelStripeRenewal({ ...f, userId: "owner", config: config() }),
    /ownership mismatch/,
  );
  assert.equal(f.calls.length, 0);
});
test("Account deletion expires pending checkout and cancels subscriptions even before webhook delivery", async () => {
  const f = fixture();
  await deleteStripeBilling({ ...f, userId: "owner", config: config() });
  assert.deepEqual(f.calls, ["expire", "cancel"]);
  f.stripe.checkout.sessions.expire = async () => {
    throw Error("Stripe unavailable");
  };
  await assert.rejects(
    deleteStripeBilling({ ...f, userId: "owner", config: config() }),
    /Stripe unavailable/,
  );
});
test("Tampered, stale or missing webhook signatures are rejected before database access", async () => {
  const c = config();
  let touched = false;
  c[API_DEPENDENCIES] = {
    createDb: () => {
      touched = true;
      throw Error("must not access");
    },
  };
  const payload = JSON.stringify({
    id: "evt_test",
    livemode: false,
    type: "ignored",
    data: { object: {} },
  });
  const sdk = new Stripe("sk_test_fixture");
  const old = sdk.webhooks.generateTestHeaderString({
    payload,
    secret: c.stripe.webhookSecret,
    timestamp: 1,
  });
  for (const signature of [undefined, "bad", old]) {
    const req = Readable.from([Buffer.from(payload)]);
    req.method = "POST";
    req.headers = { "stripe-signature": signature };
    await assert.rejects(
      handleStripeWebhook(req, {}, c),
      /Invalid Stripe webhook signature/,
    );
  }
  assert.equal(touched, false);
});

test("An invoice marked paid outside Stripe does not unlock a paid period", async () => {
  const f = fixture();
  f.stripe.invoicePayments.list = () => list([]);
  await syncStripeSubscription({
    ...f,
    config: config(),
    subscriptionId: "sub_test",
  });
  assert.equal(f.calls[0].p.p_paid_through, null);
});
test("Fraud warnings and disputes block the owned subscription before stopping renewal", async () => {
  for (const type of [
    "charge.dispute.created",
    "radar.early_fraud_warning.created",
  ]) {
    const f = fixture();
    await processStripeEvent(
      {
        livemode: false,
        type,
        data: { object: { id: "risk_test", charge: "ch_test" } },
      },
      { ...f, config: config() },
    );
    assert.equal(
      f.calls[0].p.p_blocked_reason,
      type === "charge.dispute.created" ? "dispute" : "fraud_warning",
    );
    assert.equal(f.calls[1], "cancel");
  }
});

test("Unrelated Stripe subscriptions and client metadata cannot provision a Klui account", async () => {
  const f = fixture();
  f.db.request = async () => [];
  const result = await syncStripeSubscription({
    ...f,
    config: config(),
    subscriptionId: "sub_unrelated",
  });
  assert.equal(result, null);
  assert.equal(f.calls.length, 0);
});

test("A correctly signed irrelevant event is acknowledged without provisioning access", async () => {
  const c = config();
  let dbCalls = 0;
  c[API_DEPENDENCIES] = {
    createDb: () => ({
      rpc: () => {
        dbCalls += 1;
      },
    }),
    createR2: () => ({}),
  };
  const payload = JSON.stringify({
    id: "evt_fixture",
    livemode: false,
    type: "irrelevant.event",
    data: { object: {} },
  });
  const sdk = new Stripe("sk_test_fixture");
  const req = Readable.from([Buffer.from(payload)]);
  req.method = "POST";
  req.headers = {
    "stripe-signature": sdk.webhooks.generateTestHeaderString({
      payload,
      secret: c.stripe.webhookSecret,
    }),
  };
  let response;
  const res = {
    writeHead(status) {
      assert.equal(status, 200);
    },
    end(body) {
      response = JSON.parse(body);
    },
  };
  await handleStripeWebhook(req, res, c);
  assert.equal(response.received, true);
  assert.equal(dbCalls, 0);
});
