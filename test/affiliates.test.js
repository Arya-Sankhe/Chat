import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { HttpError } from "../server/http/responses.js";
import { SupabaseRest } from "../server/db/supabaseRest.js";

const USER = "11111111-1111-4111-8111-000000001001";
const CREATOR = "11111111-1111-4111-8111-000000001002";
const COUPON = "11111111-1111-4111-8111-000000001003";
const config = loadConfig({ MAMO_API_KEY: "test", MAMO_WEBHOOK_AUTH: "secret", MAMO_COUPONS: "FIRST50:50" });

async function dispatch(path, { method = "GET", body, db = {}, role = "user", signedIn = true } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, headers: {}, url: path });
  const res = { statusCode: null, body: "", setHeader() {},
    writeHead(status) { this.statusCode = status; }, end(body) { this.body += body || ""; },
    json() { return JSON.parse(this.body); } };
  await createApiHandler(config, {
    createDb: () => ({ async upsertProfile() { return { id: USER, role }; }, ...db }),
    createR2: () => ({}),
    verifyUser: async () => { if (!signedIn) throw new HttpError(401, "Unauthorized."); return { id: USER }; }
  })(req, res, new URL(path, "http://test.local"));
  return res;
}

test("creator reports require membership and scope to the signed-in account, ignoring supplied IDs", async () => {
  assert.equal((await dispatch("/api/creator/affiliate", { signedIn: false })).statusCode, 401);
  assert.equal((await dispatch("/api/creator/affiliate", {
    db: { async getAffiliateCreatorByUser() { return null; } }
  })).statusCode, 403);
  let scoped;
  const report = { creatorId: CREATOR, trialUsers: 1, paidUsers: 2, byPlan: [{ planId: "pro", paidUsers: 2 }] };
  const res = await dispatch("/api/creator/affiliate?creatorId=someone-else", { db: {
    async getAffiliateCreatorByUser(userId) { assert.equal(userId, USER); return { id: CREATOR }; },
    async affiliateReport(options) { scoped = options; return [report]; }
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { affiliate: report });
  assert.equal(scoped.creatorId, CREATOR);
  assert.equal(scoped.limit, 1);
  assert.equal((await dispatch("/api/creator/affiliate", { method: "POST" })).statusCode, 405);
});

test("only admins provision creators, manage discounts and read every creator's counts", async () => {
  for (const [path, method] of [["/api/admin/affiliates", "GET"], ["/api/admin/affiliates", "POST"],
    [`/api/admin/affiliates/${CREATOR}/coupons`, "POST"], [`/api/admin/affiliate-coupons/${COUPON}`, "PATCH"]]) {
    assert.equal((await dispatch(path, { method, body: {} })).statusCode, 403);
    assert.equal((await dispatch(path, { method, signedIn: false })).statusCode, 401);
  }
  const db = {
    async getProfile(userId) { assert.equal(userId, USER); return { id: USER }; },
    async createAffiliateCreator(row) { assert.deepEqual(row, { user_id: USER, display_name: "Creator A" }); return { id: CREATOR, ...row }; },
    async affiliateReport(options) { assert.equal(options.limit, 10); assert.equal(options.offset, 20); return []; }
  };
  assert.equal((await dispatch("/api/admin/affiliates", { role: "admin", method: "POST",
    body: { userId: USER, displayName: " Creator A " }, db })).statusCode, 201);
  assert.equal((await dispatch("/api/admin/affiliates?limit=10&offset=20", { role: "admin", db })).statusCode, 200);
  assert.equal((await dispatch("/api/admin/affiliates?limit=101", { role: "admin", db })).statusCode, 400);
  assert.equal((await dispatch("/api/admin/affiliates", { role: "admin", method: "POST",
    body: { userId: USER, displayName: "A" }, db: { async getProfile() { return null; } } })).statusCode, 404);
});

test("creator codes default to disabled and discounts can change without changing ownership", async () => {
  const path = `/api/admin/affiliates/${CREATOR}/coupons`;
  const created = await dispatch(path, { role: "admin", method: "POST", body: { code: " creator30 " }, db: {
    async createAffiliateCoupon(row) {
      assert.deepEqual(row, { creator_id: CREATOR, code: "CREATOR30", percent_off: null, enabled: false });
      return { id: COUPON, ...row };
    }
  } });
  assert.equal(created.statusCode, 201);
  for (const body of [{ code: "FIRST50" }, { code: "FIRSTFREE" }, { code: "invalid,code" },
    { code: "CREATOR", percentOff: 0 }, { code: "CREATOR", percentOff: 101 },
    { code: "CREATOR", percentOff: "30" }, { code: "CREATOR", enabled: true }, []]) {
    const res = await dispatch(path, { role: "admin", method: "POST", body });
    assert.ok([400, 409].includes(res.statusCode), JSON.stringify(body));
  }
  const updated = await dispatch(`/api/admin/affiliate-coupons/${COUPON}`, {
    role: "admin", method: "PATCH", body: { percentOff: 30, enabled: true, creator_id: USER, code: "OTHER" }, db: {
      async updateAffiliateCoupon(id, patch) {
        assert.equal(id, COUPON); assert.deepEqual(patch, { percent_off: 30, enabled: true }); return { id, ...patch };
      }
    }
  });
  assert.equal(updated.statusCode, 200);
});

test("creator coupon validation and checkout snapshot use the backend code owner and discount", async () => {
  const originalFetch = globalThis.fetch;
  let saved;
  try {
    globalThis.fetch = async () => Response.json({ id: "LINK", payment_url: "https://mamo.test/pay",
      subscription: { identifier: "SUB" } });
    const row = { id: COUPON, code: "CREATOR30", enabled: true, percent_off: 30, affiliate_creators: { user_id: CREATOR } };
    const db = { async getAffiliateCoupon(code) { assert.equal(code, "CREATOR30"); return row; },
      async getLatestSubscription() { return null; }, async getMamoCouponRedemption() { return null; },
      async createMamoPaymentLink(link) { saved = link; }, async listMamoPaymentLinks() { return []; } };
    const check = await dispatch("/api/payments/mamo/coupon", { method: "POST", body: { coupon: "creator30" }, db });
    assert.equal(check.statusCode, 200);
    assert.deepEqual(check.json().coupon, { code: "CREATOR30", percentOff: 30 });
    assert.doesNotMatch(JSON.stringify(check.json()), /affiliateCouponId|user_id|creator_id/);
    const checkout = await dispatch("/api/payments/mamo", { method: "POST",
      body: { planId: "pro", coupon: "creator30", creatorId: "forged" }, db });
    assert.equal(checkout.statusCode, 200);
    assert.equal(saved.affiliate_coupon_id, COUPON);
    assert.equal(saved.coupon_code, "CREATOR30");
    assert.equal(saved.initial_amount_aed, checkout.json().offer.initialChargeAed);
    assert.equal(checkout.json().offer.initialAmountAed, 21);
    row.enabled = false;
    assert.equal((await dispatch("/api/payments/mamo/coupon", { method: "POST", body: { coupon: "creator30" }, db })).statusCode, 400);
    row.enabled = true; row.affiliate_creators.user_id = USER;
    assert.equal((await dispatch("/api/payments/mamo/coupon", { method: "POST", body: { coupon: "creator30" }, db })).statusCode, 400);
    row.affiliate_creators.user_id = CREATOR;
    db.getLatestSubscription = async () => ({ status: "active" });
    assert.equal((await dispatch("/api/payments/mamo/coupon", { method: "POST", body: { coupon: "creator30" }, db })).statusCode, 409);
  } finally { globalThis.fetch = originalFetch; }
});

test("database requests scope creator lookups and reports rather than loading referral identities", async () => {
  const db = new SupabaseRest(loadConfig({}));
  const calls = [];
  db.request = async (path, options) => { calls.push({ path, options }); return []; };
  await db.getAffiliateCreatorByUser(USER);
  await db.getAffiliateCoupon("CREATOR30");
  await db.affiliateReport({ creatorId: CREATOR, limit: 1, offset: 0 });
  assert.equal(calls[0].options.query.user_id, `eq.${USER}`);
  assert.equal(calls[1].options.query.code, "eq.CREATOR30");
  assert.equal(calls[2].path, "rpc/klui_affiliate_report");
  assert.deepEqual(calls[2].options.body, { p_creator_id: CREATOR, p_limit: 1, p_offset: 0 });
});
