import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { configuredServices, loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { getCurrentEntitlement } from "../server/saas/entitlements.js";
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
    PLAN_LITE_MAMO_SUBSCRIPTION_ID: PLAN_SUB_LITE,
    PLAN_PRO_MAMO_SUBSCRIPTION_ID: "MPB-SUB-PRO",
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
    async upsertSubscription(row) {
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
    ["access", "crof", "documents", "openrouter", "r2", "research", "speech", "supabase", "weather", "websearch"]
  );
});

test("publicPlan checkout is mamo when enabled, never leaks the api key", () => {
  const plans = loadPlans({
    PLAN_LITE_ZIINA_PAYMENT_URL: "https://ziina.com/pay/lite",
    PLAN_LITE_MAMO_SUBSCRIPTION_ID: PLAN_SUB_LITE
  });
  const enabled = publicPlan(plans[0], true);
  const ziina = publicPlan(plans[0], false);
  const none = publicPlan(loadPlans({})[0], false);

  assert.equal(enabled.checkout, "mamo");
  assert.equal(ziina.checkout, "ziina");
  assert.equal(none.checkout, "none");
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

test("POST /api/payments/mamo creates a Mamo payment link with custom_data, external_id, and AED", {
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
    assert.equal(Number(body.amount), 10);
    assert.equal(body.custom_data?.userId, "user-1");
    assert.equal(body.external_id, "user-1");
    assert.equal(body.subscription_id, PLAN_SUB_LITE);
    assert.equal(body.link_type, "inline");
    assert.equal(body.send_customer_receipt, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /api/payments/mamo uses a legacy monthly subscription object when no plan subscription id is set", {
  concurrency: false
}, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ payment_url: PAYMENT_URL }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const config = loadConfig({
      ...SUPABASE_ENV,
      MAMO_API_KEY: MAMO_KEY,
      MAMO_WEBHOOK_AUTH: WEBHOOK_SECRET
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

test("POST /api/payments/mamo/webhook accepts Bearer prefix and upserts on payment.succeeded", async () => {
  const upserts = [];
  const config = loadConfig(mamoEnv());
  const overrides = stubbedDeps({
    db: webhookDb(upserts)
  });

  const res = await dispatch(config, {
    method: "POST",
    path: "/api/payments/mamo/webhook",
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: {
      event_type: "payment.succeeded",
      status: "captured",
      custom_data: { userId: "user-1", planId: "pro" },
      external_id: "ignored-if-userId-present",
      next_payment_date: "24/09/2026",
      subscription_id: "MPB-SUB-PRO"
    },
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].provider, "mamo");
  assert.equal(upserts[0].provider_subscription_id, "mamo:user-1");
  assert.equal(upserts[0].status, "active");
  assert.equal(upserts[0].user_id, "user-1");
  const end = periodEndDate(upserts[0].current_period_end);
  assert.equal(end.getUTCFullYear(), 2026);
  assert.equal(end.getUTCMonth(), 8);
  assert.equal(end.getUTCDate(), 24);
});

test("POST /api/payments/mamo/webhook reads user id from external_id and upserts subscription.succeeded", async () => {
  const upserts = [];
  const res = await dispatch(loadConfig(mamoEnv()), {
    method: "POST",
    path: "/api/payments/mamo/webhook",
    headers: { authorization: WEBHOOK_SECRET },
    body: {
      event_type: "subscription.succeeded",
      status: "captured",
      custom_data: { planId: "lite" },
      external_id: "user-1",
      next_payment_date: "01/10/2026"
    },
    overrides: stubbedDeps({ db: webhookDb(upserts) })
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].provider, "mamo");
  assert.equal(upserts[0].provider_subscription_id, "mamo:user-1");
  assert.equal(upserts[0].status, "active");
  const end = periodEndDate(upserts[0].current_period_end);
  assert.equal(end.getUTCFullYear(), 2026);
  assert.equal(end.getUTCMonth(), 9);
  assert.equal(end.getUTCDate(), 1);
});

test("POST /api/payments/mamo/webhook marks payment.refunded as canceled", async () => {
  const upserts = [];
  const res = await dispatch(loadConfig(mamoEnv()), {
    method: "POST",
    path: "/api/payments/mamo/webhook",
    headers: { authorization: `Bearer ${WEBHOOK_SECRET}` },
    body: {
      event_type: "payment.refunded",
      status: "refunded",
      custom_data: { userId: "user-1", planId: "lite" },
      external_id: "user-1"
    },
    overrides: stubbedDeps({ db: webhookDb(upserts) })
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].provider, "mamo");
  assert.equal(upserts[0].provider_subscription_id, "mamo:user-1");
  assert.equal(upserts[0].status, "canceled");
});

test("POST /api/payments/mamo/webhook returns 200 after valid auth even if user id is missing", async () => {
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
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
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
          async upsertSubscription(row) {
            upserts.push(row);
            return { ...row, cancel_at_period_end: true };
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
