import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { loadPlans, publicPlan } from "../server/saas/plans.js";
import { mapStorageRpcError, storageUsage } from "../server/saas/storageQuota.js";
import { R2Client } from "../server/storage/r2.js";

const here = dirname(fileURLToPath(import.meta.url));
const PRO_BYTES = 2684354560;
const MAX_BYTES = 5 * 1024 * 1024 * 1024;
const LITE_BYTES = 750 * 1024 * 1024;

const SUPABASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CROFAI_API_KEY: "crof-key",
  OPENROUTER_API_KEY: "or-key",
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_BUCKET: "uploads"
};

const authReadyConfig = loadConfig(SUPABASE_ENV);

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

function stubbedDeps({ db = {}, r2 = {} } = {}) {
  return {
    createDb: () => ({
      async upsertProfile() { return { id: "user-1", role: "user" }; },
      ...db
    }),
    createR2: () => ({
      objectKey: () => "users/user-1/x.png",
      uploadUrl: () => "https://upload.example/x",
      uploadHeaders: () => ({ "content-type": "image/png", "x-amz-content-sha256": "UNSIGNED-PAYLOAD" }),
      async deleteObjects() {},
      ...r2
    }),
    verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} })
  };
}

function r2Client() {
  return new R2Client({
    r2: {
      endpoint: "https://account.r2.cloudflarestorage.com",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      bucket: "klui-chat",
      uploadExpiresSeconds: 300,
      readExpiresSeconds: 900
    }
  });
}

test("plan storage caps stay bigint-safe and override from env", () => {
  const plans = Object.fromEntries(loadPlans({}).map((plan) => [plan.id, plan]));
  assert.equal(plans.lite.maxStorageBytes, LITE_BYTES);
  assert.equal(plans.pro.maxStorageBytes, PRO_BYTES);
  assert.equal(plans.max.maxStorageBytes, MAX_BYTES);
  assert.equal(publicPlan(plans.pro).maxStorageBytes, PRO_BYTES);
  const overridden = loadPlans({ PLAN_LITE_MAX_STORAGE_BYTES: "100" });
  assert.equal(overridden[0].maxStorageBytes, 100);
});

test("browser PUT signs content-length and content-type; relay PUT does not", () => {
  const r2 = r2Client();
  const browser = new URL(r2.uploadUrl("users/user_1/image.png", 300, {
    contentLength: 12,
    contentType: "image/png"
  }));
  assert.equal(browser.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host;x-amz-content-sha256");
  const relay = new URL(r2.uploadUrl("users/user_1/image.png"));
  assert.equal(relay.searchParams.get("X-Amz-SignedHeaders"), "host;x-amz-content-sha256");
});

test("quota RPC errors map to 413 storage_exhausted", () => {
  assert.deepEqual(storageUsage(LITE_BYTES, LITE_BYTES), {
    usedBytes: LITE_BYTES,
    maxBytes: LITE_BYTES,
    percent: 100
  });
  try {
    mapStorageRpcError(new Error("account_storage_limit_exceeded"));
    assert.fail("expected throw");
  } catch (error) {
    assert.equal(error.status, 413);
    assert.equal(error.details.code, "storage_exhausted");
    assert.match(error.message, /Delete files to free up space/);
  }
});

test("presign returns 413 when reserve hits the account cap", async () => {
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/uploads/presign",
    body: { category: "image", contentType: "image/png", fileName: "x.png", sizeBytes: 10 },
    overrides: stubbedDeps({
      db: {
        async reserveAttachment() {
          throw new Error("account_storage_limit_exceeded");
        }
      }
    })
  });
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().details.code, "storage_exhausted");
});

test("complete HEAD size mismatch deletes R2 then the pending row", async () => {
  const events = [];
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides: stubbedDeps({
      db: {
        async getAttachment() {
          return {
            id: "upload-1",
            user_id: "user-1",
            category: "image",
            object_key: "users/user-1/x.png",
            file_name: "x.png",
            content_type: "image/png",
            size_bytes: 10,
            status: "pending"
          };
        },
        async completeReservedAttachment() {
          assert.fail("complete must not run after a size mismatch");
        },
        async deleteAttachment() {
          events.push("db");
        }
      },
      r2: {
        async headObject() { return { sizeBytes: 99, etag: "etag-1" }; },
        async deleteObjects(keys) {
          events.push("r2");
          assert.deepEqual(keys, ["users/user-1/x.png"]);
        }
      }
    })
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(events, ["r2", "db"]);
});

test("complete keeps the pending row when R2 rollback fails", async () => {
  let deletedRow = false;
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides: stubbedDeps({
      db: {
        async getAttachment() {
          return {
            id: "upload-1",
            user_id: "user-1",
            category: "image",
            object_key: "users/user-1/x.png",
            file_name: "x.png",
            content_type: "image/png",
            size_bytes: 10,
            status: "pending"
          };
        },
        async deleteAttachment() { deletedRow = true; }
      },
      r2: {
        async headObject() { return { sizeBytes: 99, etag: "etag-1" }; },
        async deleteObjects() { throw new Error("R2 unavailable"); }
      }
    })
  });
  assert.equal(res.statusCode, 400);
  assert.equal(deletedRow, false);
});

test("complete does not roll back an already-uploaded document", async () => {
  let deleted = false;
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides: stubbedDeps({
      db: {
        async getAttachment() {
          return {
            id: "upload-1",
            user_id: "user-1",
            category: "document",
            object_key: "users/user-1/file.pdf",
            file_name: "file.pdf",
            content_type: "application/pdf",
            size_bytes: 1234,
            status: "uploaded"
          };
        },
        async deleteAttachment() { deleted = true; }
      },
      r2: {
        async headObject() { throw new Error("HEAD failed"); },
        async deleteObjects() { deleted = true; }
      }
    })
  });
  assert.equal(res.statusCode, 500);
  assert.equal(deleted, false);
});

test("storage list counts pending plus uploaded and reports the hidden remainder", async () => {
  const res = await dispatch(authReadyConfig, {
    path: "/api/storage",
    overrides: stubbedDeps({
      db: {
        async accountStorageUsed() { return 1500; },
        async listUserStorageAttachments() {
          return [
            {
              id: "a1",
              file_name: "big.png",
              status: "uploaded",
              size_bytes: 600,
              created_at: "2026-08-01T00:00:00Z",
              conversations: { id: "conv-1", title: "Budget" }
            },
            { id: "a2", file_name: "pending.png", status: "pending", size_bytes: 400, created_at: "2026-08-02T00:00:00Z", project_id: "p1", projects: { id: "p1", name: "Launch" } }
          ];
        },
        async listConversationStorageTotals() {
          return [{ conversation_id: "conv-1", count: 2, bytes: 900 }];
        }
      }
    })
  });
  const body = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(body.usedBytes, 1500);
  assert.equal(body.maxBytes, PRO_BYTES);
  assert.equal(body.listedBytes, 1000);
  assert.equal(body.hiddenBytes, 500);
  assert.equal(body.listedBytes + body.hiddenBytes, body.usedBytes);
  assert.deepEqual(body.items.map((item) => item.status), ["uploaded", "pending"]);
  assert.equal(body.items[0].canDelete, false);
  assert.equal(body.items[0].siblingCount, 2);
  assert.equal(body.items[0].siblingBytes, 900);
  assert.equal(body.items[1].canDelete, true);
  assert.equal(body.items[1].projectName, "Launch");
});

test("chat-linked attachment deletes stay 409", async () => {
  let deleted = false;
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/attachments/att-1",
    overrides: stubbedDeps({
      db: {
        async getAttachment() {
          return { id: "att-1", conversation_id: "conv-1", status: "uploaded", object_key: "users/user-1/x.png" };
        },
        async deleteAttachment() { deleted = true; }
      },
      r2: {
        async deleteObjects() { assert.fail("chat-linked files must not delete R2 here"); }
      }
    })
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /deleting the message or chat/);
  assert.equal(deleted, false);
});

test("/api/me exposes usage.storage", async () => {
  const res = await dispatch(authReadyConfig, {
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async getApiWeeklyUsage() { return { api_credit_used: 0, api_credit_limit: 10 }; },
        async accountStorageUsed() { return 2048; }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().usage.storage.usedBytes, 2048);
  assert.equal(res.json().usage.storage.maxBytes, PRO_BYTES);
  assert.equal(res.json().user.name, "");
});

test("/api/me loads usage and storage concurrently", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const pending = dispatch(authReadyConfig, {
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async getApiWeeklyUsage() {
          started.push("usage");
          await gate;
          return { api_credit_used: 0, api_credit_limit: 10 };
        },
        async accountStorageUsed() {
          started.push("storage");
          await gate;
          return 2048;
        }
      }
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["storage", "usage"]);
  release();
  assert.equal((await pending).statusCode, 200);
});

test("lite document completion caps extract pages at the plan limit", async () => {
  const calls = [];
  const liteConfig = loadConfig({ ...SUPABASE_ENV, TEST_PLAN_ID: "lite" });
  const attachment = {
    id: "upload-1",
    user_id: "user-1",
    category: "document",
    object_key: "users/user-1/file.pdf",
    file_name: "file.pdf",
    content_type: "application/pdf",
    size_bytes: 1234,
    status: "pending"
  };
  const res = await dispatch(liteConfig, {
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides: stubbedDeps({
      db: {
        async getAttachment() { return attachment; },
        async completeDocumentUpload(params) {
          calls.push(params);
          return {
            attachment: { ...attachment, status: "uploaded" },
            document_file: { id: "doc-1", kind: "pdf", processing_status: "pending" }
          };
        }
      },
      r2: {
        async headObject() { return { sizeBytes: 1234, etag: "etag-1" }; }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].limits.max_pdf_pages, 50);
  assert.equal(calls[0].accountMaxBytes, LITE_BYTES);
});

test("quota SQL locks the profile and sums pending plus uploaded", () => {
  const sql = readFileSync(resolve(here, "../supabase/migrations/20260820071431_per_user_storage_quota.sql"), "utf8");
  assert.match(sql, /returns bigint/);
  assert.match(sql, /p_max_bytes bigint/);
  assert.match(sql, /p_account_max_bytes bigint/);
  assert.match(sql, /status in \('pending', 'uploaded'\)/);
  assert.match(sql, /klui_conversation_storage_totals/);
  assert.match(sql, /attachment_owner_mismatch/);
  assert.match(sql, /attachment_not_pending/);
  assert.match(sql, /klui_account_storage_used\(p_user_id, p_attachment_id\)/);
  assert.match(sql, /klui_account_storage_used\(p_user_id, v_attachment\.id\)/);
  assert.match(sql, /drop function if exists public\.klui_complete_document_upload\(uuid, uuid, integer, text, text, jsonb, uuid, bigint\)/);
  assert.match(sql, /klui_complete_document_upload[\s\S]*invalid_attachment_size/);
  assert.equal((sql.match(/perform 1 from public\.profiles where id = p_user_id for update/g) || []).length, 3);
});

test("account UI hides storage management while Settings keeps the usage meter", () => {
  const app = readFileSync(resolve(here, "../public/js/app.js"), "utf8");
  const api = readFileSync(resolve(here, "../public/js/api.js"), "utf8");
  const html = readFileSync(resolve(here, "../public/index.html"), "utf8");
  const uploads = readFileSync(resolve(here, "../server/routes/uploads.js"), "utf8");
  const storageUi = app.slice(app.indexOf("function openStorageDrawer"), app.indexOf("/* ─── Projects"));
  assert.doesNotMatch(html, /id="accountStorageList"/);
  assert.match(html, /id="settingsStorageList"/);
  assert.match(html, /class="profile-menu-item hidden"[^>]+id="profileMenuStorage"/);
  assert.match(html, /id="settingsStorageSection"/);
  assert.match(html, /role="progressbar"[^>]+aria-label="Storage used"/);
  assert.doesNotMatch(storageUi, /account-usage-label">Files/);
  assert.match(storageUi, /10 \* 1024 \* 1024 \* 1024 \? 0 : 1\)\} GB/);
  assert.match(storageUi, /Incomplete upload/);
  assert.match(storageUi, /other file/);
  assert.match(app, /void refreshAccountStorage\(\)/);
  assert.match(app, /deleteAttachment\([\s\S]*?refreshAccountStorage/);
  assert.match(uploads, /projectId: doc\.project_id \|\| attachment\.project_id/);
  assert.match(uploads, /attachment\.status !== "pending"/);
  assert.doesNotMatch(app, /state\.conversations\.unshift\(\{ id: item\.conversationId/);
  assert.match(app, /fetchStorage\(state\.session\)/);
  assert.doesNotMatch(storageUi, /R2|\bdisk\b|Study Hub/i);
  assert.match(api, /headers: \{ \.\.\.\(upload\.headers \|\| \{\}\) \}/);
  assert.doesNotMatch(api, /["']content-length["']/);
  assert.match(app, /function renderSettingsStorage\(\)/);
});

test("DELETE /api/me removes R2 objects then deletes the auth user", async () => {
  const order = [];
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async listAccountObjectKeys() {
          order.push("keys");
          return ["users/user-1/a.png", "users/user-1/doc/pages/page-0001.jpg"];
        },
        async deleteAuthUser() { order.push("auth"); }
      },
      r2: {
        async deleteObjects(keys) {
          order.push("r2");
          assert.deepEqual(keys, ["users/user-1/a.png", "users/user-1/doc/pages/page-0001.jpg"]);
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { deleted: true });
  assert.deepEqual(order, ["keys", "r2", "auth"]);
});

test("DELETE /api/me still deletes the auth user when there are no files", async () => {
  let deletedAuth = false;
  let deletedR2 = false;
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async listAccountObjectKeys() { return []; },
        async deleteAuthUser() { deletedAuth = true; }
      },
      r2: {
        async deleteObjects() { deletedR2 = true; }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(deletedAuth, true);
  assert.equal(deletedR2, false);
});

test("DELETE /api/me uses the R2 account prefix when available", async () => {
  const order = [];
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async listAccountObjectKeysBatch() { throw new Error("database listing should be skipped"); },
        async deleteAuthUser() { order.push("auth"); }
      },
      r2: {
        async deletePrefix(prefix) {
          order.push(prefix);
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(order, ["users/user-1/", "auth"]);
});

test("DELETE /api/me keeps the account if R2 delete fails", async () => {
  let deletedAuth = false;
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async listAccountObjectKeys() { return ["users/user-1/a.png"]; },
        async deleteAuthUser() { deletedAuth = true; }
      },
      r2: {
        async deleteObjects() { throw new Error("R2 unavailable"); }
      }
    })
  });
  assert.equal(res.statusCode, 500);
  assert.equal(deletedAuth, false);
});

test("DELETE /api/me deletes storage in bounded batches before auth for large accounts", async () => {
  let remaining = 5201;
  let batches = 0;
  let deletedObjects = 0;
  let authDeleted = false;
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/me",
    overrides: stubbedDeps({
      db: {
        async listAccountObjectKeysBatch() {
          batches += 1;
          const count = Math.min(200, remaining);
          remaining -= count;
          return {
            keys: Array.from({ length: count }, (_, index) => `users/user-1/${batches}-${index}`),
            cursors: { attachments: String(batches) },
            hasMore: remaining > 0
          };
        },
        async deleteAuthUser() { authDeleted = true; }
      },
      r2: {
        async deleteObjects(keys) {
          assert.ok(keys.length <= 200);
          deletedObjects += keys.length;
        }
      }
    })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(remaining, 0);
  assert.equal(batches, 27);
  assert.equal(deletedObjects, 5201);
  assert.equal(authDeleted, true);
});
