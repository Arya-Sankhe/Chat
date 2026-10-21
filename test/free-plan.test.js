import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { freeUsageDay, freeUsageResetsAt } from "../server/saas/freePlan.js";

const USER = "11111111-1111-4111-8111-000000002001";

async function dispatch(env, path, { method = "GET", body, db = {} } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, headers: {}, url: path });
  const res = { statusCode: null, body: "", setHeader() {},
    writeHead(status) { this.statusCode = status; }, end(chunk) { this.body += chunk || ""; },
    json() { return JSON.parse(this.body); } };
  await createApiHandler(loadConfig({ ACCESS_MODE: "subscription", ...env }), {
    createDb: () => ({
      async upsertProfile() { return { id: USER, role: "user" }; },
      async getLatestSubscription() { return null; },
      ...db
    }),
    createR2: () => ({ objectKey: ({ fileName }) => `users/${USER}/${fileName}`, uploadUrl: () => "https://r2.example/put", uploadHeaders: () => ({}) }),
    verifyUser: async () => ({ id: USER, email: "free@example.com", raw: {} })
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
