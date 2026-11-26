import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { freeUsageDay, freeUsageResetsAt } from "../server/saas/freePlan.js";

const USER = "11111111-1111-4111-8111-000000002001";

async function dispatch(env, path, { method = "GET", body, db = {}, user = USER } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, headers: {}, url: path });
  const res = { statusCode: null, body: "", setHeader() {},
    writeHead(status) { this.statusCode = status; }, end(chunk) { this.body += chunk || ""; },
    json() { return JSON.parse(this.body); } };
  await createApiHandler(loadConfig({ ACCESS_MODE: "subscription", ...env }), {
    createDb: () => ({
      async upsertProfile() { return { id: user, role: "user" }; },
      async getLatestSubscription() { return null; },
      ...db
    }),
    createR2: () => ({ objectKey: ({ fileName }) => `users/${USER}/${fileName}`, uploadUrl: () => "https://r2.example/put", uploadHeaders: () => ({}) }),
    verifyUser: async () => ({ id: user, email: "free@example.com", raw: {} })
  })(req, res, new URL(path, "http://test.local"));
  return res;
}

test("free accounts upload images within the daily count, open Dojo read-only, and are asked to upgrade elsewhere", async () => {
  const consumed = [];
  const db = {
    async consumeFreeUsage(params) { consumed.push(params); return { allowed: true, used: 1, limit: params.limit }; },
    async reserveAttachment(params) { return { id: "att-1", ...params }; },
    async listProjects() { return []; },
    async getFreeUsage() { return { messages: 3, images: 5 }; },
    async accountStorageUsed() { return 0; }
  };
  const presign = (body) => dispatch({}, "/api/uploads/presign", { method: "POST", db, body: { sizeBytes: 1000, ...body } });

  assert.equal((await presign({ category: "image", contentType: "image/png", fileName: "a.png" })).statusCode, 200);
  assert.deepEqual(consumed.map(({ kind, limit }) => [kind, limit]), [["images", 5]]);
  const doc = await presign({ category: "document", contentType: "application/pdf", fileName: "a.pdf" });
  assert.equal(doc.statusCode, 402);
  assert.equal(doc.json().details.code, "upgrade_required");
  assert.equal(consumed.length, 1);

  assert.equal((await dispatch({}, "/api/projects", { db })).statusCode, 200);
  for (const [path, method] of [["/api/projects", "POST"], ["/api/research", "POST"], ["/api/temporary-chat", "POST"]]) {
    const res = await dispatch({}, path, { method, db, body: {} });
    assert.equal(res.statusCode, 402, path);
    assert.equal(res.json().details.code, "upgrade_required", path);
  }

  const me = (await dispatch({}, "/api/me", { db })).json();
  assert.deepEqual(me.access, { mode: "subscription", active: false, free: true });
  assert.equal(me.plan.id, "free");
  assert.deepEqual(me.usage.free.messages, { used: 3, limit: 15, remaining: 12 });
  assert.deepEqual(me.usage.free.images, { used: 5, limit: 5, remaining: 0 });

  const off = await dispatch({ FREE_PLAN_ENABLED: "false" }, "/api/projects", { db });
  assert.equal(off.statusCode, 402);
  assert.equal(off.json().details, undefined);
});

test("the free day turns over at midnight in Dubai", () => {
  assert.equal(freeUsageDay(new Date("2026-10-21T19:59:59Z")), "2026-10-21");
  assert.equal(freeUsageDay(new Date("2026-10-21T20:00:00Z")), "2026-10-22");
  assert.equal(freeUsageResetsAt(new Date("2026-10-21T10:00:00Z")), "2026-10-21T20:00:00.000Z");
});


test("testing starts on Free, redeems TRYKLUI durably, and blocks paid checkout", async () => {
  let subscription = null;
  let writes = 0;
  const db = {
    async getApiWeeklyUsage() { return null; },
    async getLatestSubscription() { return subscription; },
    async getSubscriptionByProviderId(id) { return subscription?.provider_subscription_id === id ? subscription : null; },
    async upsertSubscription(row) { subscription = row; writes++; return row; },
    async getFreeUsage() { return {}; },
    async accountStorageUsed() { return 0; }
  };
  const env = { ACCESS_MODE: "testing" };
  let me = (await dispatch(env, "/api/me", { db })).json();
  assert.equal(me.plan.id, "free");
  assert.deepEqual(me.access, { mode: "testing", active: false, free: true });
  const restricted = await dispatch(env, "/api/projects", { method: "POST", db, body: {} });
  assert.equal(restricted.statusCode, 402);
  for (const provider of ["mamo", "stripe", "ziina"]) {
    assert.equal((await dispatch(env, `/api/payments/${provider}`, { method: "POST", db, body: { planId: "pro" } })).statusCode, 403);
  }
  const redeem = (coupon, config = env) => dispatch(config, "/api/invite/redeem", { method: "POST", db, body: { coupon } });
  assert.equal((await redeem("WRONG")).statusCode, 400);
  assert.equal(writes, 0);
  assert.equal((await redeem(" tryklui ")).statusCode, 200);
  assert.equal(subscription.provider, "invite");
  assert.equal(subscription.current_period_end, null);
  assert.equal((await redeem("TRYKLUI")).statusCode, 200);
  assert.equal(writes, 1);
  me = (await dispatch(env, "/api/me", { db })).json();
  assert.equal(me.access.active, true);
  assert.equal(me.plan.id, "pro");
  assert.equal(me.subscription.provider, "invite");
  assert.equal((await redeem("TRYKLUI", { ACCESS_MODE: "subscription" })).statusCode, 403);
  me = (await dispatch({ ACCESS_MODE: "subscription" }, "/api/me", { db })).json();
  assert.equal(me.plan.id, "free");

  subscription = { provider: "mamo", status: "active", plan_id: "pro", current_period_end: "2099-01-01T00:00:00Z" };
  me = (await dispatch(env, "/api/me", { db })).json();
  assert.equal(me.plan.id, "lite");
  assert.equal(me.plan.name, "Plus");
  assert.equal(me.subscription.provider, "mamo");
  assert.equal((await redeem("TRYKLUI")).statusCode, 409);
  assert.equal(subscription.plan_id, "pro");
  assert.equal(writes, 1);
});

function inviteDb() {
  // Rows by provider id; the latest row is the last one written.
  const rows = new Map();
  let latest = null;
  const write = (row) => { rows.set(row.provider_subscription_id, row); latest = row; return row; };
  return {
    rows,
    write,
    async getApiWeeklyUsage() { return null; },
    async getLatestSubscription() { return latest; },
    async getSubscriptionByProviderId(id) { return rows.get(id) || null; },
    async upsertSubscription(row) { await new Promise((resolve) => setTimeout(resolve, 5)); return write(row); },
    async getFreeUsage() { return {}; },
    async accountStorageUsed() { return 0; }
  };
}

// Each test uses its own account, so the redeem rate limit (5 per account) isn't shared.
function inviteAccount(n) {
  const db = inviteDb();
  const env = { ACCESS_MODE: "testing" };
  const user = `11111111-1111-4111-8111-00000000300${n}`;
  return {
    db,
    redeem: (coupon) => dispatch(env, "/api/invite/redeem", { method: "POST", db, body: { coupon }, user }),
    plan: async () => (await dispatch(env, "/api/me", { db, user })).json().plan.id,
    invite: () => db.rows.get(`invite:${user}`)
  };
}

test("KLUIUOBD is a 14-day Pro pass that ends on its date and is used once per account", async () => {
  const { db, redeem, plan, invite } = inviteAccount(1);
  const redeemed = await redeem("kluiuobd");
  assert.equal(redeemed.statusCode, 200);
  const days = (Date.parse(redeemed.json().currentPeriodEnd) - Date.now()) / 86_400_000;
  assert.ok(days > 13.99 && days <= 14);
  assert.equal(await plan(), "pro");

  // Expired, then a paid plan came and went: the pass still can't be used again.
  db.write({ ...invite(), current_period_end: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await plan(), "free");
  db.write({ provider: "mamo", provider_subscription_id: "mamo-1", status: "canceled", plan_id: "pro", current_period_end: null });
  assert.equal((await redeem("KLUIUOBD")).statusCode, 409);
  assert.equal(await plan(), "free");
});

test("TRYKLUI's open-ended Pro wins whichever order the two codes arrive in", async () => {
  for (const [n, codes] of [[2, ["TRYKLUI", "KLUIUOBD"]], [3, ["KLUIUOBD", "TRYKLUI"]]]) {
    const { redeem, plan, invite } = inviteAccount(n);
    const results = await Promise.all(codes.map(redeem));
    assert.deepEqual(results.map((r) => r.statusCode), [200, 200]);
    assert.equal(invite().current_period_end, null, codes.join(" then "));
    assert.equal(await plan(), "pro");
  }
});

test("redeeming again brings back invite Pro hidden behind a newer ended paid plan", async () => {
  const { db, redeem, plan, invite } = inviteAccount(4);
  await redeem("TRYKLUI");
  db.write({ provider: "mamo", provider_subscription_id: "mamo-2", status: "canceled", plan_id: "pro", current_period_end: null });
  assert.equal(await plan(), "free");
  assert.equal((await redeem("TRYKLUI")).statusCode, 200);
  assert.equal(await plan(), "pro");
  assert.equal(invite().raw.invite_code, "TRYKLUI");
});
