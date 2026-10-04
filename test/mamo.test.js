import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { configuredServices, loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { getCurrentEntitlement } from "../server/saas/entitlements.js";
import { withProcessingFee } from "../server/saas/mamo.js";
import { loadPlans, publicPlan } from "../server/saas/plans.js";

const SUPABASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
};

const SANDBOX_BASE = "https://sandbox.dev.business.mamopay.com/manage_api/v1";
const LIVE_BASE = "https://business.mamopay.com/manage_api/v1";
const WEBHOOK_SECRET = "mamo-webhook-secret";
const MAMO_KEY = "mamo-test-key";
const PLAN_SUB_LITE = "MPB-SUB-LITE";
const SUBSCRIBER_ID = "MPB-SUBSCRIBER-TEST";
const PAYMENT_URL = "https://sandbox.dev.business.mamopay.com/pay/klui-lite";

function mamoEnv(extra = {}) {
  return {
    ...SUPABASE_ENV,
    MAMO_API_KEY: MAMO_KEY,
    MAMO_WEBHOOK_AUTH: WEBHOOK_SECRET,
    ...extra
  };
}

function makeReq({ method = "GET", path = "/api/health", headers = {}, body = null } = {}) {
  const chunks = body == null
    ? []
    : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = { host: "test.local", ...headers };
  req.aborted = false;
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    headersSent: false,
    writableEnded: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers || {})) {
        this.headers[String(name).toLowerCase()] = value;
      }
      this.headersSent = true;
      return this;
    },
    write(chunk) {
      this.body += String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
      this.writableEnded = true;
      return this;
    },
    on() {},
    json() {
      return JSON.parse(this.body);
    }
  };
}

async function dispatch(config, { method = "GET", path, headers, body, overrides } = {}) {
  const req = makeReq({ method, path, headers, body });
  const res = makeRes();
  await createApiHandler(config, overrides)(req, res, new URL(path, "http://test.local"));
  return res;
}

function stubbedDeps({ role = "user", db = {} } = {}) {
  return {
    createDb: () => ({
      async listMamoPaymentLinks() { return []; },
      async getLatestSubscription() { return null; },
      async createMamoPaymentLink() {},
      async upsertProfile() { return { id: "user-1", role, created_at: "2026-01-01T00:00:00.000Z" }; },
      ...db
    }),
    verifyUser: async () => ({
      id: "user-1",
      email: "user@example.com",
      raw: { user_metadata: { full_name: "Ada" } }
    })
  };
}

function webhookDb(upserts) {
  return {
    async getLatestSubscription() { return null; },
    async applyMamoSubscription(row) {
      upserts.push(row);
      return row;
    }
  };
}

function requestHeader(options, name) {
  const headers = options?.headers;
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found ? String(found[1]) : "";
}

function jsonBody(options) {
  const raw = options?.body;
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") return JSON.parse(raw);
  if (Buffer.isBuffer(raw)) return JSON.parse(raw.toString("utf8"));
  return raw;
}

function periodEndDate(value) {
  const date = new Date(value);
  assert.equal(Number.isNaN(date.getTime()), false, `current_period_end is not a date: ${value}`);
  return date;
}

async function loadMamoModule() {
  try {
    return await import("../server/saas/mamo.js");
  } catch {
    return null;
  }
}

test("loadConfig exposes mamo and disables when MAMO_API_KEY is empty", () => {
  const disabled = loadConfig({});
  assert.ok(disabled.mamo);
  assert.equal(disabled.mamo.apiKey, "");
  assert.equal(disabled.mamo.baseUrl, LIVE_BASE);
  assert.equal(disabled.mamo.webhookAuth, "");

  const sandbox = loadConfig({ MAMO_API_KEY: MAMO_KEY, MAMO_SANDBOX: "true" });
  assert.equal(sandbox.mamo.apiKey, MAMO_KEY);
  assert.equal(sandbox.mamo.baseUrl, SANDBOX_BASE);

  const live = loadConfig({ MAMO_API_KEY: MAMO_KEY });
  assert.equal(live.mamo.baseUrl, LIVE_BASE);

  const override = loadConfig({
    MAMO_API_KEY: MAMO_KEY,
    MAMO_SANDBOX: "true",
    MAMO_API_BASE: "https://custom.mamo.test/manage_api/v1/"
  });
  assert.equal(override.mamo.baseUrl, "https://custom.mamo.test/manage_api/v1");

  const sliced = loadConfig({ MAMO_WEBHOOK_AUTH: `${"w".repeat(60)}extra` });
  assert.equal(sliced.mamo.webhookAuth, "w".repeat(50));
});

test("configuredServices does not grow a mamo key", () => {
  const services = configuredServices(loadConfig(mamoEnv()));
  assert.equal("mamo" in services, false);
  assert.deepEqual(
    Object.keys(services).sort(),
    ["access", "documents", "openrouter", "r2", "research", "speech", "supabase", "weather", "websearch"]
  );
});

test("publicPlan checkout is mamo when enabled, never leaks the api key", () => {
  const plans = loadPlans({
    PLAN_LITE_ZIINA_PAYMENT_URL: "https://ziina.com/pay/lite"
  });
  const enabled = publicPlan(plans[0], true);
  const ziina = publicPlan(plans[0], false);
  const none = publicPlan(loadPlans({})[0], false);

  assert.equal(enabled.checkout, "mamo");
  assert.equal(ziina.checkout, "ziina");
  assert.equal(none.checkout, "none");
  assert.equal(publicPlan(plans[0], true, loadConfig({}).mamo.fees).chargeAed, 11.46);
  assert.equal(ziina.chargeAed, 10);
  assert.equal("apiKey" in enabled, false);
  assert.equal("mamoApiKey" in enabled, false);
  assert.doesNotMatch(JSON.stringify(enabled), /mamo-test-key|apiKey/);
});

test("GET /api/plans uses mamo checkout when MAMO_API_KEY is set even if Ziina URLs exist", async () => {
  const withMamo = await dispatch(loadConfig({
    ...mamoEnv(),
    PLAN_LITE_ZIINA_PAYMENT_URL: "https://ziina.com/pay/lite"
  }), { path: "/api/plans" });
  assert.equal(withMamo.statusCode, 200);
  const lite = withMamo.json().plans.find((plan) => plan.id === "lite");
  assert.equal(lite.checkout, "mamo");
  assert.doesNotMatch(JSON.stringify(withMamo.json()), /mamo-test-key/);

  const ziinaOnly = await dispatch(loadConfig({
    PLAN_LITE_ZIINA_PAYMENT_URL: "https://ziina.com/pay/lite"
  }), { path: "/api/plans" });
  assert.equal(ziinaOnly.json().plans.find((plan) => plan.id === "lite").checkout, "ziina");
});

test("mamo entitlement expires at current_period_end; ziina prepaid does not", async () => {
  const plans = loadPlans();
  const future = "2099-01-01T00:00:00.000Z";
  const past = "2020-01-01T00:00:00.000Z";

  const entitlementFor = (subscription) => getCurrentEntitlement({
    db: { async getLatestSubscription() { return subscription; } },
    userId: "user-1",
    plans,
    access: { mode: "subscription" }
  });

  const mamoActive = await entitlementFor({
    provider: "mamo",
    status: "active",
    plan_id: "lite",
    current_period_end: future
  });
  assert.equal(mamoActive.active, true);

  const mamoTrialing = await entitlementFor({
    provider: "mamo",
    status: "trialing",
    plan_id: "lite",
    current_period_end: future
  });
  assert.equal(mamoTrialing.active, true);

  const mamoPastDue = await entitlementFor({
    provider: "mamo",
    status: "past_due",
    plan_id: "lite",
    current_period_end: future
  });
  assert.equal(mamoPastDue.active, true);

  const mamoExpired = await entitlementFor({
    provider: "mamo",
    status: "active",
    plan_id: "lite",
    current_period_end: past
  });
  assert.equal(mamoExpired.active, false);

  const ziinaPrepaid = await entitlementFor({
    provider: "ziina",
    status: "active",
    plan_id: "lite",
    current_period_end: past
  });
  assert.equal(ziinaPrepaid.active, true);
});

test("parseNextPaymentDate reads Mamo DD/MM/YYYY when exported", async () => {
  const mod = await loadMamoModule();
  if (typeof mod?.parseNextPaymentDate !== "function") return;
  const parsed = mod.parseNextPaymentDate("24/09/2026");
  const date = periodEndDate(parsed);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 8);
  assert.equal(date.getUTCDate(), 24);
});

test("POST /api/payments/mamo is 503 when Mamo is not configured", async () => {
  const res = await dispatch(loadConfig(SUPABASE_ENV), {
    method: "POST",
    path: "/api/payments/mamo",
    body: { planId: "lite" },
    overrides: stubbedDeps()
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "Mamo is not configured.");
});

test("POST /api/payments/mamo creates a monthly Mamo link that adds the processing fee", {
  concurrency: false
}, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({
      id: "MB-LINK-TEST",
      payment_url: PAYMENT_URL,
      amount_currency: "AED"
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const config = loadConfig({ ...mamoEnv(), MAMO_SANDBOX: "true" });
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/payments/mamo",
      body: { planId: "lite" },
      overrides: stubbedDeps()
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 201);
    assert.equal(res.json().paymentUrl, PAYMENT_URL);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SANDBOX_BASE}/links`);
    assert.equal(String(calls[0].options.method || "POST").toUpperCase(), "POST");
    assert.match(requestHeader(calls[0].options, "authorization"), new RegExp(`^Bearer\\s+${MAMO_KEY}$`, "i"));
    const body = jsonBody(calls[0].options);
    assert.equal(body.amount_currency, "AED");
    // 10 + 3.4% + AED 1 + 5% VAT on the fee nets Klui exactly AED 10.
    assert.equal(Number(body.amount), 11.46);
    assert.equal(body.description, "AED 10/month + AED 1.46 fee");
    assert.equal(body.custom_data?.userId, "user-1");
    assert.equal(body.external_id, "user-1");
    assert.equal(body.subscription?.frequency, "monthly");
    assert.equal(body.link_type, "standalone");
    assert.equal(body.send_customer_receipt, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/payments/mamo charges the plan price when processing fees are set to zero", {
  concurrency: false
}, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: "MB-LINK-TEST", payment_url: PAYMENT_URL }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const config = loadConfig({
      ...SUPABASE_ENV,
      MAMO_API_KEY: MAMO_KEY,
      MAMO_WEBHOOK_AUTH: WEBHOOK_SECRET,
      MAMO_FEE_PERCENT: "0",
      MAMO_FEE_FIXED_AED: "0"
    });
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/payments/mamo",
      body: { planId: "pro" },
      overrides: stubbedDeps()
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 201);
    const body = jsonBody(calls[0].options);
    assert.equal(body.custom_data?.userId, "user-1");
    assert.equal(body.external_id, "user-1");
    assert.equal(body.amount_currency, "AED");
    assert.equal(Number(body.amount), 30);
    assert.equal(body.subscription_id, undefined);
    assert.equal(body.subscription?.frequency, "monthly");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/payments/mamo/webhook is 503 when Mamo is not configured", async () => {
  const res = await dispatch(loadConfig({}), {
    method: "POST",
    path: "/api/payments/mamo/webhook",
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: { event_type: "payment.succeeded" }
  });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "Mamo is not configured.");
});

test("POST /api/payments/mamo/webhook rejects missing or wrong Authorization", async () => {
  const config = loadConfig(mamoEnv());
  const path = "/api/payments/mamo/webhook";
  const body = { event_type: "payment.succeeded", custom_data: { userId: "user-1" } };

  const missing = await dispatch(config, { method: "POST", path, body });
  assert.equal(missing.statusCode, 401);

  const wrong = await dispatch(config, {
    method: "POST",
    path,
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}x` },
    body
  });
  assert.equal(wrong.statusCode, 401);

  const sameLength = await dispatch(config, {
    method: "POST",
    path,
    headers: { authorization: `Bearer ${"x".repeat(WEBHOOK_SECRET.length)}` },
    body
  });
  assert.equal(sameLength.statusCode, 401);
});

test("webhooks use verified provider state and immutable checkout ownership", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv());
  try {
    for (const scenario of ["success", "renewal", "refund", "partial", "tampered", "unmapped"]) {
      const upserts = [];
      const payment = {
        id: "PAY-TEST", payment_link_id: "MB-LINK-TEST", status: "captured",
        amount: scenario === "tampered" ? 1 : 30, amount_currency: "AED",
        subscription_id: "MPB-SUB-PRO", created_date: "2026-10-04-00-00-00",
        refund_amount: scenario === "refund" ? 30 : scenario === "partial" ? 5 : 0,
        next_payment_date: "04/11/2026", custom_data: {}, external_id: null
      };
      globalThis.fetch = async (url) => {
        assert.equal(String(url), `${LIVE_BASE}/payments/PAY-TEST`);
        return Response.json(payment);
      };
      const res = await dispatch(config, {
        method: "POST", path: "/api/payments/mamo/webhook",
        headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
        body: { id: "PAY-TEST", event_type: scenario === "renewal" ? "subscription.succeeded"
          : ["refund","partial"].includes(scenario) ? "payment.refunded" : "payment.succeeded",
          custom_data: { userId: "attacker", planId: "max" } },
        overrides: stubbedDeps({ db: {
          ...webhookDb(upserts),
          async getMamoPaymentLink(id) {
            assert.equal(id, "MB-LINK-TEST");
            return scenario === "unmapped" ? null : { user_id: "user-1", plan_id: "pro", amount_aed: 30, subscription_id: "MPB-SUB-PRO" };
          }
        } })
      });
      if (["tampered", "unmapped"].includes(scenario)) {
        assert.equal(res.statusCode, scenario === "tampered" ? 400 : 409);
        assert.equal(upserts.length, 0);
      } else {
        assert.equal(res.statusCode, 200);
        assert.equal(upserts.length, 1);
        assert.equal(upserts[0].user_id, "user-1");
        assert.equal(upserts[0].plan_id, "pro");
        assert.equal(upserts[0].status, scenario === "refund" ? "canceled" : "active");
        // Access lasts through the whole Dubai renewal day (ends 20:00 UTC).
        assert.equal(upserts[0].current_period_end, "2026-11-04T20:00:00.000Z");
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("failed Mamo subscriptions cannot create, extend, or revive paid access", async () => {
  const { applyWebhookToSubscription } = await import("../server/saas/mamo.js");
  const now = new Date("2026-10-04T00:00:00Z");
  const end = "2026-11-01T00:00:00.000Z";
  for (const existing of [
    null,
    { provider: "ziina", status: "active", plan_id: "lite", current_period_end: end },
    { provider: "mamo", status: "canceled", plan_id: "lite", current_period_end: end },
    { provider: "mamo", status: "active", plan_id: "lite", current_period_end: null },
    { provider: "mamo", status: "active", plan_id: "lite", current_period_end: end }
  ]) {
    const upserts = [];
    await applyWebhookToSubscription({
      event_type: "subscription.failed", status: "failed",
      custom_data: { userId: "user-1", planId: "lite" },
      next_payment_date: "01/12/2026"
    }, {
      config: loadConfig(mamoEnv()), plans: loadPlans({}), now,
      db: { ...webhookDb(upserts), async getLatestSubscription() { return existing; } }
    });
    if (existing?.provider === "mamo" && existing.status === "active" && existing.current_period_end) {
      assert.equal(upserts.length, 1);
      assert.equal(upserts[0].status, "past_due");
      assert.equal(upserts[0].current_period_end, end);
    } else assert.equal(upserts.length, 0);
  }
});

test("Mamo access requires a valid future paid-period end", async () => {
  const { hasActiveSubscription } = await import("../server/saas/entitlements.js");
  const now = new Date("2026-10-04T00:00:00Z");
  for (const current_period_end of [null, "invalid", "2026-10-03T00:00:00Z"]) {
    assert.equal(hasActiveSubscription({ provider: "mamo", status: "active", current_period_end }, now), false);
  }
  assert.equal(hasActiveSubscription({ provider: "mamo", status: "active", current_period_end: "2026-11-01T00:00:00Z" }, now), true);
});

test("cancellation chooses the active subscriber after a user resubscribes", async () => {
  const { subscriberByEmail } = await import("../server/saas/mamo.js");
  const rows = [
    { id: "old", status: "Unsubscribed", customer: { email: "user@example.com" } },
    { id: "current", status: "Active", customer: { email: "USER@example.com" } }
  ];
  assert.equal(subscriberByEmail(rows, "user@example.com").id, "current");
});

test("expired or refunded plans must stop renewal before starting another checkout", async () => {
  for (const status of ["active", "past_due", "canceled"]) {
    const res = await dispatch(loadConfig(mamoEnv()), {
      method: "POST", path: "/api/payments/mamo", body: { planId: "pro" },
      overrides: stubbedDeps({ db: { async getLatestSubscription() {
        return { provider: "mamo", status, current_period_end: "2020-01-01", cancel_at_period_end: false };
      } } })
    });
    assert.equal(res.statusCode, 409);
  }
  const res = await dispatch(loadConfig(mamoEnv({ MAMO_WEBHOOK_AUTH: "" })), {
    method: "POST", path: "/api/payments/mamo", body: { planId: "pro" }, overrides: stubbedDeps()
  });
  assert.equal(res.statusCode, 503);
});

test("account deletion stops Mamo billing first and keeps the account if unsubscribe fails", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const failed of [false, true]) {
      const order = [];
      globalThis.fetch = async (url, options) => {
        const link = String(url).includes("/links/");
        assert.equal(options.method, link ? "PATCH" : "DELETE");
        if (link) assert.equal(jsonBody(options).active, false);
        order.push(link ? "link" : "provider");
        return Response.json({}, { status: failed && !link ? 503 : 200 });
      };
      const dependencies = stubbedDeps({ db: {
        async listMamoPaymentLinks() { return [{ id: "LINK-1" }]; },
        async getLatestSubscription() { return { provider: "mamo", status: "canceled", cancel_at_period_end: false,
          raw: { subscription_id: PLAN_SUB_LITE, subscriberId: SUBSCRIBER_ID, payment_link_id: "LINK-1" } }; },
        async cancelMamoSubscription(userId, linkId) { assert.equal(linkId, "LINK-1"); order.push("db"); return {}; },
        async deleteAuthUser() { order.push("auth"); }
      } });
      dependencies.createR2 = () => ({ async deletePrefix() { order.push("storage"); } });
      const res = await dispatch(loadConfig(mamoEnv()), { method: "DELETE", path: "/api/me", overrides: dependencies });
      assert.equal(res.statusCode, failed ? 502 : 200);
      assert.deepEqual(order, failed ? ["link", "provider"] : ["link", "provider", "db", "storage", "auth"]);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("POST /api/payments/mamo/webhook rejects callbacks without a payment ID", async () => {
  let upserted = false;
  const res = await dispatch(loadConfig(mamoEnv()), {
    method: "POST",
    path: "/api/payments/mamo/webhook",
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: {
      event_type: "payment.succeeded",
      custom_data: { planId: "lite" },
      next_payment_date: "24/09/2026"
    },
    overrides: stubbedDeps({
      db: {
        async upsertSubscription() {
          upserted = true;
          return {};
        }
      }
    })
  });
  assert.equal(res.statusCode, 400);
  assert.equal(upserted, false);
});

test("POST /api/me/subscription/cancel unsubscribes the Mamo subscriber and sets cancel_at_period_end", {
  concurrency: false
}, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const upserts = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = String(options.method || "GET").toUpperCase();
    calls.push({ url: href, method, options });
    if (method === "GET" && href.includes("/subscribers")) {
      return new Response(JSON.stringify([{
        id: SUBSCRIBER_ID,
        status: "Active",
        customer: { email: "user@example.com" }
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "DELETE") {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const config = loadConfig({ ...mamoEnv(), MAMO_SANDBOX: "true" });
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/me/subscription/cancel",
      body: {},
      overrides: stubbedDeps({
        db: {
          async getLatestSubscription() {
            return {
              id: "sub-1",
              user_id: "user-1",
              provider: "mamo",
              provider_subscription_id: "mamo:user-1",
              provider_customer_id: SUBSCRIBER_ID,
              plan_id: "lite",
              status: "active",
              cancel_at_period_end: false,
              current_period_end: "2099-01-01T00:00:00.000Z",
              raw: {
                subscriberId: SUBSCRIBER_ID,
                mamoPlanSubscriptionId: PLAN_SUB_LITE,
                subscription_id: PLAN_SUB_LITE
              }
            };
          },
          async cancelMamoSubscription(userId, paymentId) {
            const row = { user_id: userId, status: "active", provider: "mamo", cancel_at_period_end: true };
            upserts.push(row);
            return row;
          }
        }
      })
    });
    assert.ok(res.statusCode === 200 || res.statusCode === 201);
    const del = calls.find((call) => call.method === "DELETE");
    assert.ok(del, "cancel must DELETE the Mamo subscriber");
    assert.equal(del.url, `${SANDBOX_BASE}/subscriptions/${PLAN_SUB_LITE}/subscribers/${SUBSCRIBER_ID}`);
    assert.match(requestHeader(del.options, "authorization"), new RegExp(`^Bearer\\s+${MAMO_KEY}$`, "i"));
    assert.ok(upserts.some((row) => row.cancel_at_period_end === true));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function couponDb({ subscription = null, redemption = null, link } = {}) {
  const state = { subscription, redemption, upserts: [], links: [] };
  return {
    state,
    db: {
      async getLatestSubscription() { return state.subscription; },
      async getMamoCouponRedemption() { return state.redemption; },
      async createMamoPaymentLink(row) { state.links.push(row); },
      async getMamoPaymentLink() { return link; },
      async applyMamoSubscription(row) { state.upserts.push(row); state.subscription = row; return row; },
      async claimMamoCoupon(linkId, cardId, verificationId) {
        if (state.redemption && state.redemption.payment_link_id !== linkId && state.redemption.status !== "failed") {
          return { ...state.redemption, conflict: true };
        }
        if (!state.redemption || state.redemption.payment_link_id !== linkId) {
          state.redemption = { payment_link_id: linkId, card_id: cardId, verification_payment_id: verificationId, status: "claimed" };
        }
        return { ...state.redemption, conflict: false };
      },
      async rearmMamoCoupon(linkId, staleSeconds) {
        const claim = state.redemption;
        if (claim?.payment_link_id !== linkId || claim.status !== "charging"
          || !(Date.now() - Date.parse(claim.updated_at) >= staleSeconds * 1000)) return null;
        state.redemption = { ...claim, updated_at: new Date().toISOString() };
        return state.redemption;
      },
      async advanceMamoCoupon(linkId, from, to, initialPaymentId) {
        if (state.redemption?.payment_link_id !== linkId || !from.includes(state.redemption.status)) return null;
        state.redemption = { ...state.redemption, status: to, initial_payment_id: initialPaymentId || state.redemption.initial_payment_id };
        return state.redemption;
      }
    }
  };
}

const COUPON_LINK = {
  id: "MB-LINK-COUPON", user_id: "user-1", plan_id: "pro", amount_aed: 30, subscription_id: "MPB-SUB-COUPON",
  coupon_code: "FIRST50", initial_amount_aed: 15, first_renewal_at: "2026-11-04T20:00:00.000Z"
};
const VERIFIED = {
  id: "PAY-VERIFY", status: "card_verified", amount: 30, amount_currency: "AED", payment_link_id: "MB-LINK-COUPON",
  subscription_id: "MPB-SUB-COUPON", created_date: "2026-10-04-10-00-00",
  customer_details: { email: "user@example.com" }, payment_method: { card_id: "CARD-1" }
};
const MIT = {
  id: "PAY-MIT", status: "captured", amount: 15, amount_currency: "AED", payment_link_id: "MB-LINK-COUPON",
  subscription_id: "MPB-SUB-COUPON", created_date: "2026-10-04-10-00-05", external_id: "klui-coupon:MB-LINK-COUPON",
  customer_details: { email: "user@example.com" }
};

// Routes fake Mamo API calls and records what was requested.
function mamoStub(calls, { charge = () => Response.json(MIT), payments = {}, charges = [], chargePage, unsubscribe } = {}) {
  return async (url, options = {}) => {
    const path = String(url).replace(LIVE_BASE, "");
    const method = options.method || "GET";
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "/payments") return charge(jsonBody(options));
    if (method === "GET" && path.startsWith("/payments/")) return Response.json(payments[path.slice(10)]);
    if (method === "GET" && path.startsWith("/charges?")) {
      if (chargePage) return chargePage(Number(new URL(path, LIVE_BASE).searchParams.get("page")));
      return Response.json({ data: charges, pagination_meta: { page: 1, next_page: null } });
    }
    if (method === "DELETE" && unsubscribe) return unsubscribe();
    if (path.endsWith("/subscribers") && method === "GET") {
      return Response.json([{ id: "SUBSCRIBER-1", status: "Active", customer: { email: "user@example.com" } }]);
    }
    return Response.json({ ok: true });
  };
}

async function sendCouponWebhook(config, db, id, event = "payment.card_verified") {
  return dispatch(config, {
    method: "POST", path: "/api/payments/mamo/webhook",
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: { id, event_type: event },
    overrides: stubbedDeps({ db })
  });
}

test("processing fee gross-up nets the plan price after Mamo's fee and VAT", () => {
  const { fees } = loadConfig({}).mamo;
  // Sandbox settlements: 30 -> fee 2.02 + VAT 0.10; 10 -> 1.34 + 0.07 (3.4% + AED 1, 5% VAT).
  const net = (total) => {
    const fee = Math.round(total * 3.4 + 100);
    return (Math.round(total * 100) - fee - Math.round(fee * 0.05)) / 100;
  };
  for (const [price, charged] of [[10, 11.46], [30, 32.19], [50, 52.94], [5, 6.27], [15, 16.65], [25, 27.02]]) {
    assert.equal(withProcessingFee(price, fees), charged);
    assert.ok(net(charged) >= price && net(charged - 0.01) < price);
  }
  // A free first month only verifies the card: nothing is captured, so there is no fee.
  assert.equal(withProcessingFee(0, fees), 0);
});

test("MAMO_COUPONS parses first-month percentages and ignores malformed entries", () => {
  const { coupons } = loadConfig(mamoEnv({ MAMO_COUPONS: "first50:50, FIRSTFREE:100,BAD:0,NOPE,X:150" })).mamo;
  assert.deepEqual([...coupons.keys()], ["FIRST50", "FIRSTFREE"]);
  assert.equal(coupons.get("FIRSTFREE").percentOff, 100);
});

test("coupon checkout saves the card for a full-price subscription starting next month", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  let sent;
  try {
    globalThis.fetch = async (url, options) => {
      sent = jsonBody(options);
      return Response.json({ id: "MB-LINK-NEW", payment_url: PAYMENT_URL, subscription: { identifier: "MPB-SUB-NEW" } });
    };
    const { state, db } = couponDb();
    const res = await dispatch(config, {
      method: "POST", path: "/api/payments/mamo", headers: { authorization: "Bearer token" },
      body: { planId: "pro", coupon: "first50" }, overrides: stubbedDeps({ db })
    });
    assert.equal(res.statusCode, 200);
    // The discount applies to the plan price; the fee is added to what is actually charged.
    assert.equal(res.json().offer.initialAmountAed, 15);
    assert.equal(res.json().offer.initialChargeAed, 16.65);
    assert.equal(res.json().offer.renewalChargeAed, 32.19);
    assert.equal(sent.amount, 32.19);
    assert.equal(sent.save_card, "required");
    assert.equal(sent.subscription_id, undefined);
    assert.match(sent.subscription.start_date, /^\d{4}\/\d{2}\/\d{2}$/);
    assert.ok(sent.description.length <= 75);
    assert.equal(state.links[0].coupon_code, "FIRST50");
    assert.equal(state.links[0].initial_amount_aed, 16.65);
    assert.equal(state.links[0].amount_aed, 32.19);
    assert.equal(state.links[0].subscription_id, "MPB-SUB-NEW");

    for (const [db2, status] of [
      [couponDb({ subscription: { provider: "mamo", status: "canceled" } }).db, 409],
      [couponDb({ redemption: { status: "active", payment_link_id: "OLD" } }).db, 409]
    ]) {
      const denied = await dispatch(config, {
        method: "POST", path: "/api/payments/mamo", headers: { authorization: "Bearer token" },
        body: { planId: "pro", coupon: "FIRST50" }, overrides: stubbedDeps({ db: db2 })
      });
      assert.equal(denied.statusCode, status);
    }
    const invalid = await dispatch(config, {
      method: "POST", path: "/api/payments/mamo/coupon", headers: { authorization: "Bearer token" },
      body: { coupon: "FIRSTFREE" }, overrides: stubbedDeps({ db: couponDb().db })
    });
    assert.equal(invalid.statusCode, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test("FIRSTFREE card verification starts a trial without charging", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRSTFREE:100" }));
  const calls = [];
  try {
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED } });
    const { state, db } = couponDb({ link: { ...COUPON_LINK, coupon_code: "FIRSTFREE", initial_amount_aed: 0 } });
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 200);
    assert.equal(state.upserts.at(-1).status, "trialing");
    assert.equal(state.upserts.at(-1).current_period_end, "2026-11-04T20:00:00.000Z");
    assert.equal(state.redemption.status, "active");
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("FIRST50 charges the saved card once, even when verification callbacks repeat", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  const charges = [];
  try {
    globalThis.fetch = mamoStub(calls, {
      payments: { "PAY-VERIFY": VERIFIED, "PAY-MIT": MIT },
      charge: (body) => { charges.push(body); return Response.json(MIT); }
    });
    const { state, db } = couponDb({ link: COUPON_LINK });
    await Promise.all([1, 2, 3].map(() => sendCouponWebhook(config, db, "PAY-VERIFY")));
    await sendCouponWebhook(config, db, "PAY-MIT", "payment.succeeded");
    assert.equal(charges.length, 1);
    assert.deepEqual([charges[0].card_id, charges[0].amount, charges[0].external_id], ["CARD-1", 15, "klui-coupon:MB-LINK-COUPON"]);
    assert.equal(state.redemption.status, "active");
    assert.equal(state.subscription.status, "active");
    assert.equal(state.subscription.current_period_end, "2026-11-04T20:00:00.000Z");
    assert.equal(state.subscription.raw.payment_link_id, "MB-LINK-COUPON");
  } finally { globalThis.fetch = originalFetch; }
});

test("a declined FIRST50 charge stops the full-price renewal and releases the coupon", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  try {
    globalThis.fetch = mamoStub(calls, {
      payments: { "PAY-VERIFY": VERIFIED },
      charge: () => Response.json({ messages: ["Card declined"] }, { status: 422 })
    });
    const { state, db } = couponDb({ link: COUPON_LINK });
    await sendCouponWebhook(config, db, "PAY-VERIFY");
    assert.equal(state.redemption.status, "failed");
    assert.equal(state.upserts.length, 0);
    assert.ok(calls.includes("PATCH /links/MB-LINK-COUPON"));
    assert.ok(calls.includes("DELETE /subscriptions/MPB-SUB-COUPON/subscribers/SUBSCRIBER-1"));
  } finally { globalThis.fetch = originalFetch; }
});

test("an uncertain FIRST50 charge is never retried; its own callback settles it", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  let charges = 0;
  try {
    globalThis.fetch = mamoStub(calls, {
      payments: { "PAY-VERIFY": VERIFIED, "PAY-MIT": MIT },
      charge: () => { charges += 1; throw new TypeError("socket hang up"); }
    });
    const { state, db } = couponDb({ link: COUPON_LINK });
    await sendCouponWebhook(config, db, "PAY-VERIFY");
    await sendCouponWebhook(config, db, "PAY-VERIFY");
    assert.equal(charges, 1);
    assert.equal(state.redemption.status, "charging");
    assert.equal(state.upserts.length, 0);
    await sendCouponWebhook(config, db, "PAY-MIT", "payment.succeeded");
    assert.equal(state.redemption.status, "active");
    assert.equal(state.subscription.status, "active");
  } finally { globalThis.fetch = originalFetch; }
});

test("a second coupon checkout cannot redeem again and is stopped before renewal", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  try {
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED } });
    const { state, db } = couponDb({ link: COUPON_LINK, redemption: { payment_link_id: "MB-LINK-OTHER", status: "active" } });
    await sendCouponWebhook(config, db, "PAY-VERIFY");
    assert.equal(state.upserts.length, 0);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);
    assert.ok(calls.includes("DELETE /subscriptions/MPB-SUB-COUPON/subscribers/SUBSCRIBER-1"));
  } finally { globalThis.fetch = originalFetch; }
});

test("a failed FIRST50 cleanup is retried when Mamo redelivers the callback", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  let unsubscribeOk = false;
  try {
    globalThis.fetch = mamoStub(calls, {
      payments: { "PAY-VERIFY": VERIFIED },
      charge: () => Response.json({ messages: ["Card declined"] }, { status: 422 }),
      unsubscribe: () => (unsubscribeOk ? Response.json({ ok: true }) : Response.json({ messages: ["down"] }, { status: 500 }))
    });
    const { state, db } = couponDb({ link: COUPON_LINK });
    assert.notEqual((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 200);
    assert.equal(state.redemption.status, "failed");
    unsubscribeOk = true;
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 200);
    assert.equal(calls.filter((call) => call.startsWith("DELETE /subscriptions/MPB-SUB-COUPON/")).length, 2);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("a FIRST50 charge stuck mid-request is recovered by external_id, or sent once it is stale", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const stuck = (updatedAt) => couponDb({
    link: COUPON_LINK,
    redemption: {
      payment_link_id: "MB-LINK-COUPON", card_id: "CARD-1", status: "charging", updated_at: updatedAt, created_at: updatedAt
    }
  });
  try {
    // Mamo has the charge: settle it without charging again.
    let calls = [];
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED, "PAY-MIT": MIT }, charges: [MIT] });
    let { state, db } = stuck(new Date().toISOString());
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 200);
    assert.equal(state.redemption.status, "active");
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);

    // No charge yet and the request is recent: it may still land, so ask Mamo to redeliver.
    calls = [];
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED, "PAY-MIT": MIT } });
    ({ state, db } = stuck(new Date().toISOString()));
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 503);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);

    // No charge long after the request: it never reached Mamo, so send it now.
    ({ state, db } = stuck(new Date(Date.now() - 10 * 60 * 1000).toISOString()));
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 200);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 1);
    assert.equal(state.redemption.status, "active");

    // Concurrent redeliveries of a stale claim re-send the charge once.
    calls = [];
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED, "PAY-MIT": MIT } });
    ({ state, db } = stuck(new Date(Date.now() - 10 * 60 * 1000).toISOString()));
    const statuses = (await Promise.all([1, 2, 3].map(() => sendCouponWebhook(config, db, "PAY-VERIFY"))))
      .map((res) => res.statusCode);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 1);
    assert.ok(statuses.includes(200));

    // A charge Mamo has but cannot return right now is not acknowledged.
    calls = [];
    globalThis.fetch = mamoStub(calls, { payments: { "PAY-VERIFY": VERIFIED }, charges: [MIT] });
    const base = globalThis.fetch;
    globalThis.fetch = async (url, options) => (String(url).endsWith("/payments/PAY-MIT")
      ? Response.json({ messages: ["busy"] }, { status: 503 }) : base(url, options));
    ({ state, db } = stuck(new Date(Date.now() - 10 * 60 * 1000).toISOString()));
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 503);
    assert.equal(state.redemption.status, "charging");
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("a coupon charge search that cannot reach the claim's date never re-sends the charge", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv({ MAMO_COUPONS: "FIRST50:50" }));
  const calls = [];
  const recent = { ...MIT, id: "PAY-OTHER", external_id: "other", created_date: "2099-01-01-00-00-00" };
  try {
    globalThis.fetch = mamoStub(calls, {
      payments: { "PAY-VERIFY": VERIFIED },
      chargePage: (page) => Response.json({ data: [recent], pagination_meta: { page, next_page: page + 1 } })
    });
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { state, db } = couponDb({
      link: COUPON_LINK,
      redemption: { payment_link_id: "MB-LINK-COUPON", card_id: "CARD-1", status: "charging", updated_at: stale, created_at: stale }
    });
    assert.equal((await sendCouponWebhook(config, db, "PAY-VERIFY")).statusCode, 503);
    assert.equal(calls.filter((call) => call === "POST /payments").length, 0);
    assert.equal(state.redemption.status, "charging");
  } finally { globalThis.fetch = originalFetch; }
});

function linkStore(initial) {
  const links = initial.map((link) => ({ ...link }));
  return {
    links,
    db: {
      async listMamoPaymentLinks() { return links.map((link) => ({ ...link })); },
      async createMamoPaymentLink(row) {
        await new Promise((resolve) => setImmediate(resolve));
        links.push({ id: row.id, subscription_id: row.subscription_id, created_at: new Date().toISOString() });
      }
    }
  };
}

function checkoutFetch(calls) {
  let created = 0;
  return async (url, options = {}) => {
    const path = String(url).replace(LIVE_BASE, "");
    const method = options.method || "GET";
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "/links") {
      created += 1;
      return Response.json({ id: `LINK-NEW-${created}`, payment_url: PAYMENT_URL, subscription: { identifier: `SUB-NEW-${created}` } });
    }
    if (method === "GET" && path.endsWith("/subscribers")) {
      return Response.json([{ id: `SUBSCRIBER-${path.split("/")[2]}`, status: "Active", customer: { email: "user@example.com" } }]);
    }
    return Response.json({ ok: true });
  };
}

const EARLIER_LINKS = [
  { id: "LINK-A", subscription_id: "SUB-A", created_at: "2026-10-01T00:00:00.000Z" },
  { id: "LINK-B", subscription_id: "SUB-B", created_at: "2026-10-02T00:00:00.000Z" }
];

test("a new checkout closes earlier ones, and cancelling stops every paid checkout's schedule", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv());
  const calls = [];
  try {
    globalThis.fetch = checkoutFetch(calls);
    const { db } = linkStore(EARLIER_LINKS);
    const opened = await dispatch(config, {
      method: "POST", path: "/api/payments/mamo", headers: { authorization: "Bearer token" },
      body: { planId: "pro" }, overrides: stubbedDeps({ db })
    });
    assert.equal(opened.statusCode, 200);
    assert.ok(calls.includes("PATCH /links/LINK-A") && calls.includes("PATCH /links/LINK-B"));
    assert.ok(!calls.includes("PATCH /links/LINK-NEW-1"));

    calls.length = 0;
    const cancelled = await dispatch(config, {
      method: "POST", path: "/api/me/subscription/cancel", headers: { authorization: "Bearer token" }, body: {},
      overrides: stubbedDeps({ db: {
        async listMamoPaymentLinks() { return EARLIER_LINKS; },
        async getLatestSubscription() {
          return { provider: "mamo", status: "active", cancel_at_period_end: false,
            raw: { subscription_id: "SUB-B", subscriberId: "SUBSCRIBER-SUB-B", payment_link_id: "LINK-B" } };
        },
        async cancelMamoSubscription() { return { provider: "mamo", status: "active", cancel_at_period_end: true }; }
      } })
    });
    assert.equal(cancelled.statusCode, 200);
    assert.ok(calls.includes("DELETE /subscriptions/SUB-A/subscribers/SUBSCRIBER-SUB-A"));
    assert.ok(calls.includes("DELETE /subscriptions/SUB-B/subscribers/SUBSCRIBER-SUB-B"));
  } finally { globalThis.fetch = originalFetch; }
});

test("concurrent checkouts leave exactly one payable link", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv());
  const calls = [];
  try {
    globalThis.fetch = checkoutFetch(calls);
    const { links, db } = linkStore([]);
    const results = await Promise.all([1, 2].map(() => dispatch(config, {
      method: "POST", path: "/api/payments/mamo", headers: { authorization: "Bearer token" },
      body: { planId: "pro" }, overrides: stubbedDeps({ db })
    })));
    const open = links.filter((link) => !calls.includes(`PATCH /links/${link.id}`));
    assert.equal(links.length, 2);
    assert.equal(open.length, 1);
    // Whichever request lists last closes the older link (and answers 409 if its own is older).
    assert.ok(results.some((res) => res.statusCode === 200));
  } finally { globalThis.fetch = originalFetch; }
});

test("deleting an account before the payment webhook still stops the checkout's schedule", async () => {
  const originalFetch = globalThis.fetch;
  const config = loadConfig(mamoEnv());
  const calls = [];
  try {
    globalThis.fetch = checkoutFetch(calls);
    const res = await dispatch(config, {
      method: "DELETE", path: "/api/me", headers: { authorization: "Bearer token" },
      overrides: stubbedDeps({ db: {
        async listMamoPaymentLinks() { return [EARLIER_LINKS[0]]; },
        async getLatestSubscription() { return null; },
        async deleteAccount() {}
      } })
    });
    assert.ok(calls.includes("PATCH /links/LINK-A"));
    assert.ok(calls.includes("DELETE /subscriptions/SUB-A/subscribers/SUBSCRIBER-SUB-A"), `status ${res.statusCode}`);
  } finally { globalThis.fetch = originalFetch; }
});
