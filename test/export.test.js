import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";

const here = dirname(fileURLToPath(import.meta.url));

const authReadyConfig = loadConfig({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CROFAI_API_KEY: "crof-key",
  OPENROUTER_API_KEY: "or-key",
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

test("GET /api/me/export returns JSON without a paid plan and without file bytes", async () => {
  let usedChatAuth = false;
  const res = await dispatch(authReadyConfig, {
    path: "/api/me/export",
    overrides: stubbedDeps({
      db: {
        async getLatestSubscription() { usedChatAuth = true; },
        async exportAccountData(userId) {
          assert.equal(userId, "user-1");
          return {
            truncated: false,
            conversations: [{
              id: "conv-1",
              title: "Hello",
              project_id: null,
              model: "nitro",
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-01T00:00:01.000Z",
              deleted_at: null
            }],
            messages: [{
              id: "msg-1",
              conversation_id: "conv-1",
              role: "user",
              content: "Hi",
              model: null,
              reasoning: "",
              tool_calls: [],
              finish_reason: null,
              error: null,
              created_at: "2026-08-01T00:00:00.000Z"
            }],
            files: [{
              id: "att-1",
              file_name: "notes.pdf",
              content_type: "application/pdf",
              category: "document",
              status: "uploaded",
              size_bytes: 12,
              created_at: "2026-08-01T00:00:00.000Z",
              conversation_id: "conv-1",
              project_id: null,
              object_key: "users/user-1/secret"
            }],
            memory: { enabled: true, content: "Prefers short answers.", updated_at: "2026-08-02T00:00:00.000Z" },
            subscriptions: [{
              id: "sub-1",
              plan_id: "pro",
              status: "active",
              provider: "ziina",
              provider_customer_id: "cust",
              provider_subscription_id: "sub",
              current_period_end: "2026-09-01T00:00:00.000Z",
              cancel_at_period_end: false,
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-01T00:00:00.000Z",
              raw: { secret: true }
            }],
            payments: [{
              id: "pay-1",
              plan_id: "pro",
              amount_aed: 30,
              currency: "AED",
              provider: "ziina",
              status: "approved",
              reference_code: "ref-1",
              created_at: "2026-08-01T00:00:00.000Z",
              payment_url: "https://pay.example/secret"
            }],
            usage: [{
              plan_id: "pro",
              period_start: "2026-08-01",
              period_end: "2026-08-31",
              week_index: 1,
              week_start: "2026-08-01",
              week_end: "2026-08-07",
              api_credit_used: "0.5",
              api_credit_reserved: "0",
              api_credit_limit: "1.02"
            }],
            projects: [{
              id: "proj-1",
              name: "Thesis",
              kind: "project",
              instructions: "Be concise.",
              created_at: "2026-08-01T00:00:00.000Z",
              updated_at: "2026-08-01T00:00:00.000Z"
            }]
          };
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-disposition"], "attachment; filename=\"klui-data.json\"");
  const body = res.json();
  assert.equal(usedChatAuth, false);
  assert.equal(body.account.email, "user@example.com");
  assert.equal(body.account.name, "Ada");
  assert.equal(body.memory.content, "Prefers short answers.");
  assert.equal(body.conversations[0].messages[0].content, "Hi");
  assert.equal(body.files[0].fileName, "notes.pdf");
  assert.equal(body.files[0].object_key, undefined);
  assert.equal(body.files[0].objectKey, undefined);
  assert.equal(body.billing.subscriptions[0].raw, undefined);
  assert.equal(body.billing.payments[0].paymentUrl, undefined);
  assert.equal(body.billing.payments[0].amountAed, 30);
  assert.equal(body.billing.usage[0].used, 0.5);
  assert.equal(body.projects[0].instructions, "Be concise.");
  assert.equal(body.truncated, false);
  assert.match(body.exportedAt, /^20\d\d-/);
});

test("GET /api/me/export does not require R2", async () => {
  let deleted = false;
  const res = await dispatch(authReadyConfig, {
    path: "/api/me/export",
    overrides: {
      ...stubbedDeps({
        db: {
          async exportAccountData() {
            return {
              truncated: false,
              conversations: [],
              messages: [],
              files: [],
              memory: null,
              subscriptions: [],
              payments: [],
              usage: [],
              projects: []
            };
          }
        }
      }),
      createR2: () => ({
        async getObject() { deleted = true; }
      })
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(deleted, false);
  assert.equal(res.json().conversations.length, 0);
});

test("export UI is on Settings Account", () => {
  const app = readFileSync(resolve(here, "../public/js/app.js"), "utf8");
  const api = readFileSync(resolve(here, "../public/js/api.js"), "utf8");
  const html = readFileSync(resolve(here, "../public/index.html"), "utf8");
  assert.match(html, /id="exportAccountButton"/);
  assert.match(html, /Download my data/);
  assert.match(api, /\/api\/me\/export/);
  assert.match(app, /downloadAccountDataAndSave/);
  assert.doesNotMatch(api, /Maileroo|content-reports|study_notes/);
});
