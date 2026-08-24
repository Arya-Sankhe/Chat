import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const MSG_ID = "00000000-0000-4000-8000-000000000001";

const authReadyConfig = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CROFAI_API_KEY: "crof-key",
  OPENROUTER_API_KEY: "or-key",
  SARVAM_API_KEY: "sarvam-key",
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_BUCKET: "uploads"
});

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
      async upsertProfile() { return { id: "user-1", role }; },
      ...db
    }),
    verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} })
  };
}

test("POST /api/reports snapshots the message and does not require a paid plan", async () => {
  const calls = [];
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/reports",
    body: { messageId: MSG_ID },
    overrides: stubbedDeps({
      db: {
        async getOpenContentReport() {
          calls.push("getOpenContentReport");
          return null;
        },
        async getMessage(userId, messageId) {
          calls.push("getMessage");
          assert.equal(userId, "user-1");
          assert.equal(messageId, MSG_ID);
          return {
            id: MSG_ID,
            conversation_id: "conv-1",
            content: [{ type: "text", text: "  bad  output  " }]
          };
        },
        async createContentReport(row) {
          calls.push("createContentReport");
          assert.equal(row.reporter_id, "user-1");
          assert.equal(row.reporter_email, "user@example.com");
          assert.equal(row.message_id, MSG_ID);
          assert.equal(row.conversation_id, "conv-1");
          assert.equal(row.snippet, "bad output");
          assert.equal(row.status, "open");
          return { id: "rep-1", ...row, created_at: "2026-08-24T00:00:00.000Z" };
        },
        async getLatestSubscription() {
          throw new Error("report must not check entitlements");
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().report.id, "rep-1");
  assert.deepEqual(calls, ["getOpenContentReport", "getMessage", "createContentReport"]);
});

test("POST /api/reports reuses an open ticket for the same message", async () => {
  let created = false;
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/reports",
    body: { messageId: MSG_ID },
    overrides: stubbedDeps({
      db: {
        async getOpenContentReport() {
          return { id: "rep-existing", reporter_email: "user@example.com", snippet: "bad", status: "open" };
        },
        async createContentReport() {
          created = true;
          return { id: "nope" };
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().report.id, "rep-existing");
  assert.equal(created, false);
});

test("POST /api/reports 404s when the message is missing", async () => {
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/reports",
    body: { messageId: MSG_ID },
    overrides: stubbedDeps({
      db: {
        async getOpenContentReport() { return null; },
        async getMessage() { return null; }
      }
    })
  });
  assert.equal(res.statusCode, 404);
});

test("admin can mark a report done", async () => {
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/admin/reports/rep-1/done",
    body: {},
    overrides: stubbedDeps({
      role: "admin",
      db: {
        async getContentReport(id) {
          assert.equal(id, "rep-1");
          return { id: "rep-1", status: "open", reporter_email: "user@example.com", snippet: "bad" };
        },
        async resolveContentReport(id, resolvedBy, options) {
          assert.equal(id, "rep-1");
          assert.equal(resolvedBy, "user-1");
          assert.equal(options?.status || "done", "done");
          return { id: "rep-1", status: "done", reporter_email: "user@example.com", snippet: "bad", resolved_at: "2026-08-24T00:00:00.000Z" };
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().report.status, "done");
});

test("admin reported path removes the message then marks reported", async () => {
  const calls = [];
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/admin/reports/rep-1/reported",
    body: {},
    overrides: stubbedDeps({
      role: "admin",
      db: {
        async getContentReport(id) {
          assert.equal(id, "rep-1");
          return {
            id: "rep-1",
            status: "open",
            reporter_email: "user@example.com",
            snippet: "bad",
            message_id: MSG_ID
          };
        },
        async getMessageById(messageId) {
          calls.push("getMessageById");
          assert.equal(messageId, MSG_ID);
          return { id: MSG_ID, user_id: "owner-1" };
        },
        async listMessageAttachments(userId, messageId) {
          calls.push("listMessageAttachments");
          assert.equal(userId, "owner-1");
          assert.equal(messageId, MSG_ID);
          return [];
        },
        async deleteMessage(userId, messageId) {
          calls.push("deleteMessage");
          assert.equal(userId, "owner-1");
          assert.equal(messageId, MSG_ID);
          return { id: MSG_ID };
        },
        async resolveContentReport(id, resolvedBy, options) {
          calls.push("resolveContentReport");
          assert.equal(id, "rep-1");
          assert.equal(resolvedBy, "user-1");
          assert.equal(options.status, "reported");
          return { id: "rep-1", status: "reported", reporter_email: "user@example.com", snippet: "bad", resolved_at: "2026-08-24T00:00:00.000Z" };
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().report.status, "reported");
  assert.deepEqual(calls, ["getMessageById", "listMessageAttachments", "deleteMessage", "resolveContentReport"]);
});

test("non-admin cannot resolve reports", async () => {
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/admin/reports/rep-1/done",
    body: {},
    overrides: stubbedDeps({ role: "user" })
  });
  assert.equal(res.statusCode, 403);
});

test("report UI is on messages and the admin queue; storage stays in Settings", () => {
  const app = readFileSync(resolve(here, "../public/js/app.js"), "utf8");
  const html = readFileSync(resolve(here, "../public/index.html"), "utf8");
  const admin = readFileSync(resolve(here, "../public/js/adminPanel.js"), "utf8");
  const schema = readFileSync(resolve(here, "../supabase/schema.sql"), "utf8");
  assert.match(app, /data-report-msg/);
  assert.match(admin, /data-admin-tab="reports"/);
  assert.match(admin, /data-resolve-report/);
  assert.doesNotMatch(html, /id="accountStorageList"/);
  assert.match(html, /id="settingsStorageList"/);
  assert.match(schema, /create table if not exists public\.content_reports/);
  assert.match(schema, /status text not null default 'open' check \(status in \('open', 'done', 'reported'\)\)/);
  assert.match(admin, /data-resolve-status="reported"/);
  assert.match(admin, /report\.cybertip\.org/);
});
