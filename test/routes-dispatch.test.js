import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { loadConfig } from "../server/config.js";
import { createApiHandler, handleApiRequest } from "../server/routes.js";

/*
 * Phase-0 characterization tests for the API dispatcher.
 *
 * These pin the externally observable HTTP contract of
 * `handleApiRequest`: the route inventory, per-route method
 * enforcement, the auth boundary (503 when Supabase is unconfigured,
 * 401 without a bearer token), the /api/chat 410, the 404 fallback,
 * problem-JSON shapes, and CORS preflight. Phase 1 must not change
 * any expectation in this file.
 *
 * Requests are driven through `createApiHandler`, the minimal
 * dependency seam. The "seam preserves behavior" suite proves the
 * default path is identical to calling `handleApiRequest` directly.
 */

function makeReq({ method = "GET", path = "/api/health", headers = {}, body = null } = {}) {
  const chunks = body == null
    ? []
    : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
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
    destroyed: false,
    events: {},
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
    on(event, fn) {
      (this.events[event] ||= []).push(fn);
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

async function dispatch(config, { method = "GET", path, headers, body, overrides = null } = {}) {
  const req = makeReq({ method, path, headers, body });
  const res = makeRes();
  const url = new URL(path, "http://test.local");
  const handler = overrides ? createApiHandler(config, overrides) : createApiHandler(config);
  await handler(req, res, url);
  return res;
}

const SUPABASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key"
};

/* Nothing configured: no Supabase, no model keys. */
const bareConfig = loadConfig({});
/* Supabase + model keys configured, so requests fail on the token check. */
const authReadyConfig = loadConfig({ ...SUPABASE_ENV, CROFAI_API_KEY: "crof-key", OPENROUTER_API_KEY: "or-key" });
const documentReadyConfig = loadConfig({
  ...SUPABASE_ENV,
  CROFAI_API_KEY: "crof-key",
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_BUCKET: "uploads"
});

function stubbedDeps({ role = "user", db = {} } = {}) {
  const user = { id: "user-1", email: "user@example.com", raw: {} };
  const defaultDb = {
    async upsertProfile() {
      return { id: user.id, role };
    }
  };
  return {
    createDb: () => ({ ...defaultDb, ...db }),
    createR2: () => ({
      async deleteObjects() {}
    }),
    verifyUser: async () => user
  };
}

/*
 * Frozen route inventory. `authKind` describes the first auth-related
 * check the handler performs; `preGate` lists checks that fire before
 * auth. Order in this table mirrors the dispatcher if-ladder.
 */
const ROUTES = [
  { path: "/api/health", method: "GET", public: true },
  { path: "/api/config", method: "GET", public: true },
  { path: "/api/plans", method: "GET", public: true },
  { path: "/api/payments/ziina", method: "POST", authKind: "user" },
  { path: "/api/payments/ziina", method: "GET", authKind: "user" },
  { path: "/api/me", method: "GET", authKind: "user" },
  {
    path: "/api/models", method: "GET", authKind: "chat",
    preGate: { status: 503, error: "Klui model API key is not configured on the server." }
  },
  { path: "/api/uploads/presign", method: "POST", authKind: "chat" },
  { path: "/api/uploads/upload-1/content", method: "PUT", authKind: "chat" },
  { path: "/api/uploads/complete", method: "POST", authKind: "chat" },
  { path: "/api/documents/jobs/job-1/status", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/documents/att-1/status", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/attachments/att-1/download", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/attachments/att-1/view", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/attachments/att-1", method: "DELETE", authKind: "chat" },
  { path: "/api/conversations", method: "GET", authKind: "chat" },
  { path: "/api/conversations", method: "POST", authKind: "chat" },
  { path: "/api/projects", method: "GET", authKind: "chat" },
  { path: "/api/projects", method: "POST", authKind: "chat" },
  { path: "/api/projects/project-1", method: "GET", authKind: "chat" },
  { path: "/api/research", method: "POST", authKind: "chat" },
  { path: "/api/research/run-1/status", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/research/run-1/cancel", method: "POST", authKind: "chat", enforced405: "GET" },
  { path: "/api/research/run-1/report", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/conversations/conv-1", method: "GET", authKind: "chat" },
  { path: "/api/conversations/conv-1/messages", method: "POST", authKind: "chat", enforced405: "GET" },
  {
    path: "/api/conversations/conv-1/turns/00000000-0000-4000-8000-000000000001/cancel",
    method: "POST",
    authKind: "chat",
    enforced405: "GET"
  },
  {
    path: "/api/temporary-chat", method: "POST", authKind: "chat", enforced405: "GET",
    preGate: { status: 503, error: "Klui model API key is not configured on the server." }
  },
  { path: "/api/messages/msg-1", method: "DELETE", authKind: "chat", enforced405: "GET" },
  { path: "/api/admin/summary", method: "GET", authKind: "admin" },
  { path: "/api/admin/settings", method: "GET", authKind: "admin" },
  { path: "/api/admin/payments", method: "GET", authKind: "admin" },
  { path: "/api/admin/payments/pay-1/approve", method: "POST", authKind: "admin" }
];

test("public routes respond 200 without auth or configured services", async () => {
  const health = await dispatch(bareConfig, { path: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["content-type"], "application/json; charset=utf-8");
  const healthBody = health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.app, "klui-chat");
  assert.deepEqual(
    Object.keys(healthBody.services).sort(),
    ["access", "crof", "documents", "openrouter", "r2", "research", "supabase", "websearch"]
  );

  const configRes = await dispatch(bareConfig, { path: "/api/config" });
  assert.equal(configRes.statusCode, 200);
  const configBody = configRes.json();
  for (const key of ["app", "supabaseUrl", "supabaseAnonKey", "auth", "defaultBaseUrl", "services", "providers"]) {
    assert.ok(key in configBody, `config payload exposes ${key}`);
  }
  assert.deepEqual(configBody.providers, { klui: false, openrouter: false });

  const plans = await dispatch(bareConfig, { path: "/api/plans" });
  assert.equal(plans.statusCode, 200);
  const planIds = plans.json().plans.map((plan) => plan.id);
  assert.deepEqual(planIds, ["lite", "essential", "pro"]);
});

test("every auth-requiring route returns 503 problem JSON when Supabase is unconfigured", async () => {
  for (const route of ROUTES.filter((entry) => !entry.public)) {
    const res = await dispatch(bareConfig, { method: route.method, path: route.path });
    const expected = route.preGate || { status: 503, error: "Supabase is not configured." };
    assert.equal(res.statusCode, expected.status, `${route.method} ${route.path}`);
    assert.equal(res.json().error, expected.error, `${route.method} ${route.path}`);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  }
});

test("every auth-requiring route returns 401 without a bearer token once Supabase is configured", async () => {
  for (const route of ROUTES.filter((entry) => !entry.public)) {
    const res = await dispatch(authReadyConfig, { method: route.method, path: route.path });
    assert.equal(res.statusCode, 401, `${route.method} ${route.path}`);
    assert.equal(res.json().error, "Sign in to continue.", `${route.method} ${route.path}`);
  }
});

test("handler-level method enforcement wins over auth (405 before any auth check)", async () => {
  for (const route of ROUTES.filter((entry) => entry.enforced405)) {
    const res = await dispatch(bareConfig, { method: route.enforced405, path: route.path });
    assert.equal(res.statusCode, 405, `${route.enforced405} ${route.path}`);
    assert.equal(res.json().error, "Method not allowed.", `${route.enforced405} ${route.path}`);
  }
});

test("routes that enforce methods after auth still return 405 for unknown methods", async () => {
  const overrides = stubbedDeps({
    db: {
      async listConversations() { return []; },
      async getConversation() { return { id: "conv-1", title: "T" }; }
    }
  });
  const res = await dispatch(authReadyConfig, { method: "PUT", path: "/api/conversations", overrides });
  assert.equal(res.statusCode, 405);
  assert.equal(res.json().error, "Method not allowed.");

  const adminOverrides = stubbedDeps({ role: "admin" });
  const settings = await dispatch(authReadyConfig, { method: "PUT", path: "/api/admin/settings", overrides: adminOverrides });
  assert.equal(settings.statusCode, 405);
  assert.equal(settings.json().error, "Method not allowed.");
});

test("admin routes reject non-admin users with 403", async () => {
  const overrides = stubbedDeps({ role: "user" });
  for (const path of ["/api/admin/summary", "/api/admin/settings", "/api/admin/payments"]) {
    const res = await dispatch(authReadyConfig, { path, overrides });
    assert.equal(res.statusCode, 403, path);
    assert.equal(res.json().error, "Admin access is required.", path);
  }
});

test("resource 404s surface as problem JSON after auth", async () => {
  const overrides = stubbedDeps({
    db: {
      async getConversation() { return null; },
      async listMessageAttachments() { return []; },
      async deleteMessage() { return null; }
    }
  });

  const conversation = await dispatch(authReadyConfig, { path: "/api/conversations/missing", overrides });
  assert.equal(conversation.statusCode, 404);
  assert.equal(conversation.json().error, "Conversation not found.");

  const message = await dispatch(authReadyConfig, { method: "DELETE", path: "/api/messages/missing", overrides });
  assert.equal(message.statusCode, 404);
  assert.equal(message.json().error, "Message not found.");
});

test("authenticated happy path works through stubbed dependencies", async () => {
  const overrides = stubbedDeps({
    db: {
      async listConversations() { return [{ id: "conv-1", title: "Hello" }]; }
    }
  });
  const res = await dispatch(authReadyConfig, { path: "/api/conversations", overrides });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { conversations: [{ id: "conv-1", title: "Hello" }] });
});

test("project detail reports source-byte capacity and scoped resources", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "project-1", name: "Launch" }; },
      async listProjectAttachments() {
        return [
          { id: "a1", status: "uploaded", size_bytes: 1024 },
          { id: "a2", status: "pending", size_bytes: 4096 }
        ];
      },
      async listProjectDocuments() { return [{ id: "doc-1", project_id: "project-1" }]; },
      async listProjectConversations() { return [{ id: "conv-1", project_id: "project-1" }]; }
    }
  });
  const res = await dispatch(authReadyConfig, {
    path: "/api/projects/project-1",
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().usage.usedBytes, 1024);
  assert.equal(res.json().usage.maxBytes, 100 * 1024 * 1024);
  assert.deepEqual(res.json().documents, [{ id: "doc-1", project_id: "project-1" }]);
  assert.deepEqual(res.json().conversations, [{ id: "conv-1", project_id: "project-1" }]);
});

test("project ownership is accepted only for document uploads", async () => {
  let created = false;
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "project-1", name: "Launch" }; },
      async createAttachment() { created = true; return { id: "upload-1" }; }
    }
  });
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/uploads/presign",
    body: {
      projectId: "project-1",
      category: "image",
      contentType: "image/png",
      fileName: "photo.png",
      sizeBytes: 10
    },
    overrides
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Only documents can be added to project knowledge.");
  assert.equal(created, false);
});

test("document upload completion queues extraction through one atomic RPC", async () => {
  const calls = [];
  const attachment = {
    id: "upload-1",
    user_id: "user-1",
    category: "document",
    object_key: "users/user-1/file.pdf",
    file_name: "file.pdf",
    content_type: "application/pdf",
    size_bytes: 1234,
    status: "uploaded",
    etag: "old-etag"
  };
  const overrides = stubbedDeps({
    db: {
      async getAttachment() { return attachment; },
      async completeDocumentUpload(params) {
        calls.push(params);
        return {
          attachment: { ...attachment, etag: "new-etag" },
          document_file: { id: "doc-1", kind: "pdf", processing_status: "pending" },
          job: { id: "job-1", status: "queued" }
        };
      }
    }
  });
  overrides.createR2 = () => ({
    async headObject() { return { sizeBytes: 1234, etag: "new-etag" }; }
  });

  const res = await dispatch(documentReadyConfig, {
    method: "POST",
    path: "/api/uploads/complete",
    body: { uploadId: "upload-1" },
    overrides
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "pdf");
  assert.equal(calls[0].attachmentId, "upload-1");
  assert.equal(res.json().document.id, "doc-1");
});

test("XLSX view returns extracted sheets without creating a PDF preview", async () => {
  let previewJobCreated = false;
  const overrides = stubbedDeps({
    db: {
      async getAttachment() {
        return {
          id: "sheet-1",
          status: "uploaded",
          file_name: "budget.xlsx",
          content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
      },
      async getDocumentFileByAttachment() {
        return { id: "doc-1", kind: "xlsx", text_ready_at: "2026-07-13T00:00:00Z" };
      },
      async listDocumentChunks() {
        return [{ source_label: "Budget", text: "Item\tCost\nHosting\t20" }];
      },
      async createDocumentJob() {
        previewJobCreated = true;
        return { id: "job-1" };
      }
    }
  });

  const res = await dispatch(documentReadyConfig, {
    path: "/api/attachments/sheet-1/view",
    overrides
  });

  assert.equal(res.statusCode, 200);
  assert.equal(previewJobCreated, false);
  assert.deepEqual(res.json().sheets, [{
    name: "Budget",
    rows: [["Item", "Cost"], ["Hosting", "20"]]
  }]);
});

test("generated prose document view returns its editable source", async () => {
  const overrides = stubbedDeps({
    db: {
      async getAttachment() {
        return { id: "doc-attachment", status: "uploaded", file_name: "report.pdf", content_type: "application/pdf" };
      },
      async getDocumentFileByAttachment() {
        return {
          id: "doc-1",
          kind: "pdf",
          metadata: { editable: true, editor_markdown: "# Report\n\nBody", editor_revision: 3 }
        };
      }
    }
  });

  const res = await dispatch(documentReadyConfig, {
    path: "/api/attachments/doc-attachment/view",
    overrides
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().kind, "editable");
  assert.equal(res.json().markdown, "# Report\n\nBody");
  assert.equal(res.json().revision, 3);
});

test("editable document saves canonical markdown into existing metadata", async () => {
  let savedPatch = null;
  const overrides = stubbedDeps({
    db: {
      async getDocumentFileByAttachment() {
        return {
          id: "doc-1",
          metadata: { editable: true, editor_markdown: "# Before", editor_revision: 1 }
        };
      },
      async updateDocumentFile(_userId, _documentId, patch) {
        savedPatch = patch;
        return { id: "doc-1" };
      }
    }
  });

  const res = await dispatch(documentReadyConfig, {
    method: "PATCH",
    path: "/api/attachments/doc-attachment/editor",
    body: { markdown: "# After", revision: 1 },
    overrides
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().revision, 2);
  assert.equal(savedPatch.metadata.editor_markdown, "# After");
  assert.equal(savedPatch.metadata.editor_revision, 2);
});

test("authenticated routes dispatch to their resource-specific handlers", async () => {
  const cases = [
    { method: "GET", path: "/api/payments/ziina", dbMethod: "listPaymentRequests", result: [] },
    {
      method: "GET",
      path: "/api/models",
      dbMethod: "getModelCache",
      result: { fetched_at: new Date().toISOString(), payload: { data: [] } }
    },
    {
      method: "POST",
      path: "/api/uploads/presign",
      body: { category: "image", contentType: "image/png", fileName: "x.png", sizeBytes: 10 },
      dbMethod: "createAttachment",
      result: { id: "upload-1" }
    },
    { method: "PUT", path: "/api/uploads/upload-1/content", dbMethod: "getAttachment", result: null },
    { method: "POST", path: "/api/uploads/complete", body: { uploadId: "upload-1" }, dbMethod: "getAttachment", result: null },
    { method: "GET", path: "/api/documents/jobs/job-1/status", dbMethod: "getDocumentJob", result: null },
    { method: "GET", path: "/api/documents/att-1/status", dbMethod: "getDocumentFileByAttachment", result: null },
    { method: "GET", path: "/api/attachments/att-1/download", dbMethod: "getAttachment", result: null },
    { method: "GET", path: "/api/attachments/att-1/view", dbMethod: "getAttachment", result: null },
    { method: "DELETE", path: "/api/attachments/att-1", dbMethod: "getAttachment", result: null },
    { method: "POST", path: "/api/conversations", body: { title: "T" }, dbMethod: "createConversation", result: { id: "conv-1", title: "T" } },
    { method: "GET", path: "/api/projects", dbMethod: "listProjects", result: [] },
    { method: "GET", path: "/api/research/run-1/status", dbMethod: "getResearchRun", result: null },
    { method: "GET", path: "/api/conversations/conv-1", dbMethod: "getConversation", result: null },
    { method: "DELETE", path: "/api/messages/msg-1", dbMethod: "listMessageAttachments", result: [] }
  ];

  for (const route of cases) {
    const calls = [];
    const overrides = stubbedDeps({
      db: {
        async getModelCache() { return null; },
        async upsertModelCache() { return {}; },
        async [route.dbMethod]() {
          calls.push(route.dbMethod);
          return route.result;
        }
      }
    });
    overrides.createR2 = () => ({
      objectKey: () => "users/user-1/x.png",
      uploadUrl: () => "https://upload.example/x",
      uploadHeaders: () => ({ "content-type": "image/png" }),
      async deleteObjects() {}
    });

    await dispatch(authReadyConfig, { ...route, overrides });
    assert.deepEqual(calls, [route.dbMethod], `${route.method} ${route.path}`);
  }
});

test("admin routes dispatch to their resource-specific handlers", async () => {
  const cases = [
    { method: "GET", path: "/api/admin/summary", dbMethod: "adminSummary", result: { profiles: [], subscriptions: [], usage: [], paymentRequests: [] } },
    { method: "GET", path: "/api/admin/settings", dbMethod: "getAppSetting", result: null },
    { method: "GET", path: "/api/admin/payments", dbMethod: "listPendingPaymentRequests", result: [] },
    { method: "POST", path: "/api/admin/payments/pay-1/approve", body: {}, dbMethod: "getPaymentRequest", result: null }
  ];

  for (const route of cases) {
    const calls = [];
    const overrides = stubbedDeps({
      role: "admin",
      db: {
        async [route.dbMethod]() {
          calls.push(route.dbMethod);
          return route.result;
        }
      }
    });
    await dispatch(authReadyConfig, { ...route, overrides });
    assert.deepEqual(calls, [route.dbMethod], `${route.method} ${route.path}`);
  }
});

test("dependency seam ignores unsupported and non-function overrides", async () => {
  const overrides = {
    ...stubbedDeps({ db: { async listConversations() { return []; } } }),
    createR2: null,
    unrelated: () => { throw new Error("must not be installed"); }
  };
  const res = await dispatch(authReadyConfig, { path: "/api/conversations", overrides });
  assert.equal(res.statusCode, 200);
});

test("body parsing happens after auth: invalid JSON with no token is 401, with auth it is 400", async () => {
  const noAuth = await dispatch(authReadyConfig, {
    method: "POST", path: "/api/payments/ziina", body: "not json"
  });
  assert.equal(noAuth.statusCode, 401);

  const withAuth = await dispatch(authReadyConfig, {
    method: "POST", path: "/api/payments/ziina", body: "not json", overrides: stubbedDeps()
  });
  assert.equal(withAuth.statusCode, 400);
  assert.equal(withAuth.json().error, "Request body must be valid JSON.");
});

test("research create is gated on config before auth", async () => {
  const disabled = loadConfig({ ...SUPABASE_ENV, RESEARCH_ENABLED: "false" });
  const res = await dispatch(disabled, { method: "POST", path: "/api/research" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, "Deep Research is not enabled.");
});

test("/api/chat is permanently gone (410) for any method", async () => {
  for (const method of ["GET", "POST"]) {
    const res = await dispatch(bareConfig, { method, path: "/api/chat" });
    assert.equal(res.statusCode, 410);
    assert.equal(res.json().error, "Use /api/conversations/:id/messages for managed Klui chat.");
  }
});

test("unknown API paths return 404 problem JSON", async () => {
  const res = await dispatch(bareConfig, { path: "/api/does-not-exist" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: "API route not found." });

  /* GET on the DELETE-only attachment path falls through the dispatcher. */
  const attachment = await dispatch(bareConfig, { method: "GET", path: "/api/attachments/att-1" });
  assert.equal(attachment.statusCode, 404);
  assert.equal(attachment.json().error, "API route not found.");
});

test("CORS preflight: 204 for allowed origins, 403 for others, 204 without an origin", async () => {
  const allowed = await dispatch(bareConfig, {
    method: "OPTIONS", path: "/api/me", headers: { origin: "https://klui.tech" }
  });
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://klui.tech");

  const denied = await dispatch(bareConfig, {
    method: "OPTIONS", path: "/api/me", headers: { origin: "https://evil.example" }
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body, "Origin not allowed");

  const bare = await dispatch(bareConfig, { method: "OPTIONS", path: "/api/me" });
  assert.equal(bare.statusCode, 204);
});

test("allowed origins receive CORS headers on normal requests", async () => {
  const res = await dispatch(bareConfig, { path: "/api/health", headers: { origin: "https://klui.tech" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "https://klui.tech");
  assert.equal(res.headers["vary"], "Origin");
});

/* ── Seam behavior-preservation ── */

test("seam: createApiHandler(config) with no overrides matches handleApiRequest exactly", async () => {
  const cases = [
    { path: "/api/health", method: "GET" },
    { path: "/api/me", method: "GET" },
    { path: "/api/does-not-exist", method: "GET" },
    { path: "/api/chat", method: "POST" }
  ];
  for (const testCase of cases) {
    const direct = makeRes();
    await handleApiRequest(
      makeReq(testCase),
      direct,
      new URL(testCase.path, "http://test.local"),
      bareConfig
    );
    const viaFactory = await dispatch(bareConfig, testCase);
    assert.equal(viaFactory.statusCode, direct.statusCode, `${testCase.method} ${testCase.path}`);
    assert.equal(viaFactory.body, direct.body, `${testCase.method} ${testCase.path}`);
  }
});

test("seam: overrides are used by the scoped handler only and never leak into the shared config", async () => {
  let verifyCalls = 0;
  const overrides = {
    ...stubbedDeps({ db: { async listConversations() { return []; } } }),
  };
  const originalVerify = overrides.verifyUser;
  overrides.verifyUser = async (req, config) => {
    verifyCalls += 1;
    return originalVerify(req, config);
  };

  const scoped = await dispatch(authReadyConfig, { path: "/api/conversations", overrides });
  assert.equal(scoped.statusCode, 200);
  assert.equal(verifyCalls, 1);

  /* The same config object, used without overrides, still runs the default
     auth path (401 on the missing bearer token — no stub involved). */
  const direct = makeRes();
  await handleApiRequest(
    makeReq({ path: "/api/conversations" }),
    direct,
    new URL("/api/conversations", "http://test.local"),
    authReadyConfig
  );
  assert.equal(direct.statusCode, 401);
  assert.equal(verifyCalls, 1, "stubbed verifyUser must not be called by the default handler");
});
