import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { loadConfig } from "../server/config.js";
import { createApiHandler, handleApiRequest } from "../server/routes.js";
import { settleSpeechUsage, speechUsage, STT_CREDITS_PER_SECOND, STT_RESERVATION_CREDITS } from "../server/routes/speech.js";

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
    off(event, fn) {
      this.events[event] = (this.events[event] || []).filter((entry) => entry !== fn);
    },
    removeListener(event, fn) {
      this.off(event, fn);
    },
    emit(event) {
      for (const fn of [...(this.events[event] || [])]) fn();
    },
    emitClose() {
      this.destroyed = true;
      this.emit("close");
    },
    json() {
      return JSON.parse(this.body);
    },
    sseEvents() {
      return this.body
        .split("\n\n")
        .map((block) => block.trim())
        .filter((block) => block.startsWith("data: "))
        .map((block) => block.slice("data: ".length))
        .filter((data) => data !== "[DONE]")
        .map((data) => JSON.parse(data));
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

async function dispatchPending(config, { method = "GET", path, headers, body, overrides = null } = {}) {
  const req = makeReq({ method, path, headers, body });
  const res = makeRes();
  const url = new URL(path, "http://test.local");
  const handler = overrides ? createApiHandler(config, overrides) : createApiHandler(config);
  const done = handler(req, res, url);
  return { req, res, done };
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

function webmWithDuration(seconds) {
  const audio = Buffer.alloc(32);
  audio.set([0x2a, 0xd7, 0xb1, 0x84], 0);
  audio.writeUInt32BE(1_000_000, 4);
  audio.set([0x44, 0x89, 0x88], 8);
  audio.writeDoubleBE(seconds * 1_000, 11);
  return audio;
}

/*
 * Frozen route inventory. `authKind` describes the first auth-related
 * check the handler performs; `preGate` lists checks that fire before
 * auth. Order in this table mirrors the dispatcher if-ladder.
 */
const ROUTES = [
  { path: "/api/health", method: "GET", public: true },
  { path: "/api/build", method: "GET", public: true },
  { path: "/api/config", method: "GET", public: true },
  { path: "/api/plans", method: "GET", public: true },
  { path: "/api/payments/ziina", method: "POST", authKind: "user" },
  { path: "/api/payments/ziina", method: "GET", authKind: "user" },
  { path: "/api/payments/mamo", method: "POST", authKind: "user" },
  { path: "/api/payments/mamo/webhook", method: "POST", public: true, enforced405: "GET" },
  { path: "/api/me", method: "GET", authKind: "user" },
  { path: "/api/me", method: "DELETE", authKind: "user" },
  { path: "/api/me/export", method: "GET", authKind: "user", enforced405: "POST" },
  { path: "/api/me/subscription/cancel", method: "POST", authKind: "user", enforced405: "GET" },
  { path: "/api/reports", method: "POST", authKind: "user", enforced405: "GET" },
  { path: "/api/storage", method: "GET", authKind: "chat" },
  {
    path: "/api/models", method: "GET", authKind: "chat",
    preGate: { status: 503, error: "Klui model API key is not configured on the server." }
  },
  { path: "/api/clarifications", method: "POST", authKind: "chat" },
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
  { path: "/api/conversations/search", method: "GET", authKind: "chat" },
  { path: "/api/projects", method: "GET", authKind: "chat" },
  { path: "/api/projects", method: "POST", authKind: "chat" },
  { path: "/api/projects/project-1", method: "GET", authKind: "chat" },
  { path: "/api/study/courses/course-1/materials", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/study/courses/course-1/materials", method: "DELETE", authKind: "chat" },
  { path: "/api/study/courses/course-1/generate", method: "POST", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/courses/course-1/practice", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/study/courses/course-1/decks", method: "PATCH", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/courses/course-1/decks", method: "DELETE", authKind: "chat" },
  { path: "/api/study/courses/course-1/queue", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/study/courses/course-1/cards", method: "POST", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/cards/card-1", method: "PATCH", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/cards/card-1", method: "DELETE", authKind: "chat" },
  { path: "/api/study/quizzes/quiz-1/attempts", method: "POST", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/quizzes/quiz-1", method: "GET", authKind: "chat", enforced405: "POST" },
  { path: "/api/study/quizzes/quiz-1", method: "PATCH", authKind: "chat" },
  { path: "/api/study/quizzes/quiz-1", method: "DELETE", authKind: "chat" },
  { path: "/api/study/notes/note-1/export", method: "POST", authKind: "chat", enforced405: "GET" },
  { path: "/api/study/notes/note-1", method: "DELETE", authKind: "chat", enforced405: "GET" },
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
  { path: "/api/email/revise", method: "POST", authKind: "chat", enforced405: "GET" },
  {
    path: "/api/speech-to-text", method: "POST", authKind: "chat", enforced405: "GET",
    preGate: { status: 503, error: "Speech transcription is not configured on the server." }
  },
  { path: "/api/messages/msg-1", method: "DELETE", authKind: "chat", enforced405: "GET" },
  { path: "/api/admin/summary", method: "GET", authKind: "admin" },
  { path: "/api/admin/settings", method: "GET", authKind: "admin" },
  { path: "/api/admin/payments", method: "GET", authKind: "admin" },
  { path: "/api/admin/payments/pay-1/approve", method: "POST", authKind: "admin" },
  { path: "/api/admin/reports/rep-1/done", method: "POST", authKind: "admin" },
  { path: "/api/admin/reports/rep-1/reported", method: "POST", authKind: "admin" }
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
    ["access", "crof", "documents", "openrouter", "r2", "research", "speech", "supabase", "weather", "websearch"]
  );

  const build = await dispatch(bareConfig, { path: "/api/build" });
  assert.equal(build.statusCode, 200);
  assert.equal(build.headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.equal(build.headers.pragma, "no-cache");
  assert.deepEqual(build.json(), { buildId: "dev" });

  const configRes = await dispatch(bareConfig, { path: "/api/config" });
  assert.equal(configRes.statusCode, 200);
  const configBody = configRes.json();
  for (const key of ["app", "buildId", "supabaseUrl", "supabaseAnonKey", "auth", "defaultBaseUrl", "services", "providers", "roles", "skills"]) {
    assert.ok(key in configBody, `config payload exposes ${key}`);
  }
  const humanizer = configBody.skills.find((skill) => skill.id === "humanizer");
  assert.ok(humanizer);
  assert.equal(humanizer.name, "Humanize");
  assert.equal(humanizer.description, "Cleaner, more natural phrasing, not a detector bypass");
  assert.equal("body" in humanizer, false);
  assert.equal("content" in humanizer, false);
  assert.equal("path" in humanizer, false);
  assert.doesNotMatch(JSON.stringify(configBody.skills), /klui_composer_skill|# Humanizer/);
  assert.equal(configBody.skills.some((skill) => skill.id === "illustration"), false);
  assert.doesNotMatch(JSON.stringify(configBody.skills), /"execution"|injectPrompt/);
  assert.deepEqual(configBody.providers, { klui: false, openrouter: false });
  assert.deepEqual(configBody.roles.map((role) => role.id), ["nitro", "think", "pro", "compare", "council"]);
  const rolesJson = JSON.stringify(configBody.roles);
  assert.doesNotMatch(rolesJson, /openrouter|deepseek\/|openai\/|inclusionai\/|xiaomi\/|tencent\//);

  const plans = await dispatch(bareConfig, { path: "/api/plans" });
  assert.equal(plans.statusCode, 200);
  const planIds = plans.json().plans.map((plan) => plan.id);
  assert.deepEqual(planIds, ["lite", "pro", "max"]);
});

test("stale web API builds are rejected before route effects", async () => {
  const config = loadConfig(SUPABASE_ENV);
  config.buildId = "current-build";
  let verifyCalls = 0;
  const overrides = {
    ...stubbedDeps(),
    verifyUser: async () => {
      verifyCalls += 1;
      return { id: "user-1", email: "user@example.com", raw: {} };
    }
  };

  const stale = await dispatch(config, {
    method: "POST",
    path: "/api/reports",
    headers: { "x-klui-build-id": "old-build" },
    overrides
  });
  assert.equal(stale.statusCode, 426);
  assert.equal(stale.headers["cache-control"], "no-store, no-cache, must-revalidate");
  assert.equal(stale.json().code, "stale_client_build");
  assert.equal(verifyCalls, 0);

  const current = await dispatch(config, {
    method: "POST", path: "/api/reports", headers: { "x-klui-build-id": "current-build" }, overrides
  });
  assert.equal(current.statusCode, 400);
  assert.equal(verifyCalls, 1);

  const legacy = await dispatch(config, { method: "POST", path: "/api/reports", overrides });
  assert.equal(legacy.statusCode, 400);
  assert.equal(verifyCalls, 2);
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
      async listMessages() { return []; },
      async listPendingDocumentTurns() { return []; },
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

test("conversation search returns stubbed matches and skips short queries", async () => {
  const calls = [];
  const results = [{
    conversation_id: "conv-1",
    title: "Hello",
    snippet: "hello there",
    matched_at: "2026-08-17T00:00:00Z"
  }];
  const overrides = stubbedDeps({
    db: {
      async searchMessages(userId, query, options) {
        calls.push({ userId, query, limit: options?.limit });
        return results;
      }
    }
  });

  const found = await dispatch(authReadyConfig, { path: "/api/conversations/search?q=hello", overrides });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(found.json(), { results });
  assert.deepEqual(calls, [{ userId: "user-1", query: "hello", limit: 30 }]);

  calls.length = 0;
  const short = await dispatch(authReadyConfig, { path: "/api/conversations/search?q=h", overrides });
  assert.equal(short.statusCode, 200);
  assert.deepEqual(short.json(), { results: [] });
  assert.deepEqual(calls, []);
});

test("speech route forwards Grok STT through OpenRouter and returns the transcript", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const audio = webmWithDuration(1);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ text: "hello from speech" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/speech-to-text",
      headers: { "content-type": "audio/webm" },
      body: audio,
      overrides: stubbedDeps({ db: {
        async reserveApiUsage() { return { allowed: true }; },
        async markApiUsageSubmitted() {},
        async settleApiUsage() {}
      } })
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { transcript: "hello from speech" });
    assert.equal(request.url, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.equal(request.options.headers.authorization, "Bearer or-key");
    const body = JSON.parse(request.options.body);
    assert.equal(body.model, "x-ai/grok-stt-1.0");
    assert.equal(body.input_audio.format, "webm");
    assert.equal(body.input_audio.data, audio.toString("base64"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("speech usage estimates missing provider cost from the validated duration", () => {
  const usage = speechUsage({ usage: { seconds: 600 } }, 600);
  assert.equal(usage.estimated, true);
  assert.equal(usage.durationSeconds, 600);
  assert.equal(usage.credits, 600 * STT_CREDITS_PER_SECOND);
  assert.ok(usage.credits < STT_RESERVATION_CREDITS);

  const zeroCost = speechUsage({ usage: { seconds: 600, cost: 0 } }, 600);
  assert.equal(zeroCost.estimated, false);
  assert.equal(zeroCost.credits, 0);

  const missingCost = speechUsage({ usage: { seconds: 600, cost: null } }, 600);
  assert.equal(missingCost.estimated, true);
  assert.equal(missingCost.credits, 600 * STT_CREDITS_PER_SECOND);
});

test("speech settlement preserves provider cost and freezes accounts only on a real overrun", async () => {
  const settled = [];
  const settings = [];
  const context = {
    user: { id: "user-1" },
    db: {
      async settleApiUsage(params) { settled.push(params); },
      async upsertAppSetting(...args) { settings.push(args); }
    }
  };

  await settleSpeechUsage(context, {
    requestId: "00000000-0000-4000-8000-000000000010",
    durationSeconds: 600,
    payload: { usage: { seconds: 600 } },
    ok: true
  });
  assert.equal(settled[0].estimated, true);
  assert.equal(settled[0].costCredits, 600 * STT_CREDITS_PER_SECOND);
  assert.equal(settings.length, 0);

  await settleSpeechUsage(context, {
    requestId: "00000000-0000-4000-8000-000000000011",
    durationSeconds: 1,
    payload: { usage: { seconds: 1, cost: STT_RESERVATION_CREDITS + 0.01 } },
    ok: true
  });
  assert.equal(settled[1].estimated, false);
  assert.equal(settled[1].costCredits, STT_RESERVATION_CREDITS + 0.01);
  assert.equal(settings.length, 1);
  assert.equal(settings[0][0], "funded_inference_disabled:user-1");
  assert.equal(settings[0][1].reason, "stt_reservation_ceiling");
});

test("enforced speech records but does not bill a provider attempt that fails", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network lost"); };
  const events = [];
  const dataBytes = 16_000 * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  const config = loadConfig({
    ...SUPABASE_ENV,
    OPENROUTER_API_KEY: "or-key",
    API_USAGE_METERING_MODE: "enforce",
    DESKTOP_CHAT_RESERVATION_CREDITS: "0.25"
  });
  const overrides = stubbedDeps({ db: {
    async reserveApiUsage() { events.push("reserve"); return { allowed: true }; },
    async markApiUsageSubmitted() { events.push("submitted"); },
    async settleApiUsage(params) { events.push(["settled", params]); },
    async releaseApiUsage() { events.push("released"); }
  } });
  try {
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/speech-to-text",
      headers: { "content-type": "audio/wav" },
      body: wav,
      overrides
    });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(events.map((event) => Array.isArray(event) ? event[0] : event), ["reserve", "submitted", "settled"]);
    assert.equal(events[2][1].estimated, true);
    assert.equal(events[2][1].costCredits, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("enforced speech accepts bounded browser blobs and retries OpenRouter STT", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const audio = webmWithDuration(4.2);
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) return new Response("busy", { status: 503 });
    return new Response(JSON.stringify({
      text: "long recording",
      usage: { seconds: 4.2, cost: 0.42 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const events = [];
  const config = loadConfig({
    ...SUPABASE_ENV,
    OPENROUTER_API_KEY: "or-key",
    API_USAGE_METERING_MODE: "enforce",
    DESKTOP_CHAT_RESERVATION_CREDITS: "0.25"
  });
  const overrides = stubbedDeps({ db: {
    async reserveApiUsage(params) { events.push(["reserve", params]); return { allowed: true }; },
    async markApiUsageSubmitted() { events.push(["submitted"]); },
    async settleApiUsage(params) { events.push(["settled", params]); }
  } });
  try {
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/speech-to-text",
      headers: { "content-type": "audio/webm" },
      body: audio,
      overrides
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { transcript: "long recording" });
    assert.equal(attempts, 2);
    assert.equal(events[0][1].reservedCredits, 0.02);
    assert.equal(events[0][1].provider, "openrouter");
    assert.equal(events[0][1].model, "x-ai/grok-stt-1.0");
    assert.equal(events[2][1].usage.duration_seconds, 4.2);
    assert.ok(Math.abs(events[2][1].costCredits - 0.42) < Number.EPSILON * 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("desktop logout revokes the OAuth client grant and current session", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options?.method]);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const config = loadConfig({
    ...SUPABASE_ENV,
    DESKTOP_OAUTH_ENABLED: "true",
    SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID: "provider-client"
  });
  const overrides = {
    ...stubbedDeps({ db: {
      async getAccountIdentity() { return { account_id: "user-1" }; },
      async getProfile() { return { id: "user-1", role: "user" }; }
    } }),
    verifyDesktopUser: async () => ({
      id: "user-1",
      email: "user@example.com",
      identityProvider: "supabase",
      oauthClientId: "klui-desktop-windows",
      providerClientId: "provider-client",
      surface: "desktop_windows"
    })
  };
  try {
    const res = await dispatch(config, {
      method: "POST",
      path: "/api/desktop/v1/logout",
      headers: {
        authorization: "Bearer desktop-token",
        "x-klui-client-version": "0.1.0"
      },
      overrides
    });
    assert.equal(res.statusCode, 200);
    assert.ok(calls.some(([url, method]) => method === "DELETE" && url.includes("/user/oauth/grants?client_id=provider-client")));
    assert.ok(calls.some(([url, method]) => method === "POST" && url.includes("/logout?scope=local")));
  } finally {
    globalThis.fetch = originalFetch;
  }
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
      async createAttachment() { created = true; return { id: "upload-1" }; },
      async reserveAttachment() { created = true; return { id: "upload-1" }; }
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

test("document presign enforces the current plan's single-file limit", async () => {
  const config = loadConfig({
    ...SUPABASE_ENV,
    R2_ACCOUNT_ID: "account-1",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET: "uploads",
    DOCUMENT_MAX_FILE_BYTES: String(100 * 1024 * 1024),
    TEST_PLAN_ID: "lite"
  });
  const res = await dispatch(config, {
    method: "POST",
    path: "/api/uploads/presign",
    body: {
      category: "document",
      contentType: "application/pdf",
      fileName: "large.pdf",
      sizeBytes: 50 * 1024 * 1024 + 1
    },
    overrides: stubbedDeps()
  });

  assert.equal(res.statusCode, 413);
  assert.match(res.json().error, /50MB or smaller/);
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
  assert.equal(calls[0].accountMaxBytes, documentReadyConfig.plans.find((plan) => plan.id === "pro")?.maxStorageBytes
    || documentReadyConfig.plans[0].maxStorageBytes);
  assert.equal(res.json().document.id, "doc-1");
});

test("XLSX view never enters the PDF preview queue and keeps extracted sheets as fallback", async () => {
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
      async listDocumentChunks(_userId, _documentId, options) {
        if (options.sourceType !== "sheet_range") return [];
        return [
          {
            source_type: "sheet_range",
            source_label: "Budget — A1:B2",
            text: "Item\tCost\nHosting\t20",
            metadata: { sheet: "Budget", row_numbers: [1, 2], column_start: 1 }
          },
          {
            source_type: "sheet_range",
            source_label: "Budget — A3:B3",
            text: "Item\tCost\nStorage\t10",
            metadata: { sheet: "Budget", row_numbers: [3], column_start: 1, header_repeated: true }
          },
          {
            source_type: "sheet_range",
            source_label: "Budget — C1:C3",
            text: "Owner\nOps\nFinance",
            metadata: { sheet: "Budget", row_numbers: [1, 2, 3], column_start: 3 }
          }
        ];
      },
      async getReadyPdfPreviewForDocument() { return null; },
      async getActivePdfPreviewJob() { return null; },
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
  assert.equal(res.json().kind, "xlsx");

  const fallback = await dispatch(documentReadyConfig, {
    path: "/api/attachments/sheet-1/view?fallback=sheet",
    overrides
  });
  assert.equal(fallback.statusCode, 200);
  assert.deepEqual(fallback.json().sheets, [{
    name: "Budget",
    rows: [
      ["Item", "Cost", "Owner"],
      ["Hosting", "20", "Ops"],
      ["Storage", "10", "Finance"]
    ]
  }]);
});

test("XLSX view returns a signed read-only ONLYOFFICE session when configured", async () => {
  const config = loadConfig({
    ...SUPABASE_ENV,
    R2_ACCOUNT_ID: "account-1",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET: "uploads",
    ONLYOFFICE_PUBLIC_URL: "https://office.example.com",
    ONLYOFFICE_JWT_SECRET: "test-secret"
  });
  const overrides = stubbedDeps({
    db: {
      async getAttachment() {
        return {
          id: "sheet-1",
          status: "uploaded",
          object_key: "users/user-1/budget.xlsx",
          etag: "v1",
          file_name: "budget.xlsx",
          content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        };
      },
      async getDocumentFileByAttachment() {
        return { id: "doc-1", kind: "xlsx", text_ready_at: "2026-07-13T00:00:00Z" };
      }
    }
  });
  overrides.createR2 = () => ({ readUrl: () => "https://signed.example/budget.xlsx" });

  const res = await dispatch(config, {
    path: "/api/attachments/sheet-1/view",
    overrides
  });
  const payload = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(payload.kind, "office");
  assert.equal(payload.officeUrl, "https://office.example.com");
  assert.equal(payload.officeConfig.documentType, "cell");
  assert.equal(payload.officeConfig.editorConfig.mode, "view");
  assert.equal(payload.officeConfig.editorConfig.user.id, "user-1");
  assert.equal(payload.officeConfig.document.permissions.edit, false);
  assert.match(payload.officeConfig.token, /^[^.]+\.[^.]+\.[^.]+$/);
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

test("editable document revise returns replacement markdown without a chat message", async () => {
  const originalFetch = globalThis.fetch;
  let chatCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      chatCalls += 1;
      const body = JSON.parse(String(init.body || "{}"));
      assert.equal(body.model, "deepseek/deepseek-v4-flash-0731");
      assert.match(body.messages?.[1]?.content || "", /Selected portion to revise/);
      assert.match(body.messages?.[1]?.content || "", /Make it warmer/);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        async json() {
          return {
            id: "gen-1",
            choices: [{ message: { content: "```markdown\nWarmer world\n```" } }],
            usage: { cost: 0.0001 }
          };
        },
        async text() {
          return "";
        }
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const config = loadConfig({
      ...SUPABASE_ENV,
      OPENROUTER_API_KEY: "or-key",
      R2_ACCOUNT_ID: "account-1",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      R2_BUCKET: "uploads"
    });
    const overrides = stubbedDeps({
      db: {
        async getDocumentFileByAttachment() {
          return {
            id: "doc-1",
            metadata: { editable: true, editor_markdown: "# Hello\n\nWorld", editor_revision: 1 }
          };
        },
        async checkApiBudget() {
          return { allowed: true };
        },
        async recordApiUsageCost() {
          return {};
        }
      }
    });

    const res = await dispatch(config, {
      method: "POST",
      path: "/api/attachments/doc-attachment/editor/revise",
      body: {
        markdown: "# Hello\n\nWorld",
        selection: "World",
        instruction: "Make it warmer",
        model: "poolside/laguna-xs-2.1"
      },
      overrides
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().replacement, "Warmer world");
    assert.equal(chatCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email revise returns a fenced draft without a chat message", async () => {
  const originalFetch = globalThis.fetch;
  let chatCalls = 0;
  let saved = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      chatCalls += 1;
      const body = JSON.parse(String(init.body || "{}"));
      assert.match(body.messages?.[1]?.content || "", /Come up with a good excuse/);
      assert.match(body.messages?.[1]?.content || "", /Current draft:/);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        async json() {
          return {
            id: "gen-email",
            choices: [{ message: { content: "```email\nTo:\nSubject: Extension\nDear [Name],\n\nHi.\n```" } }],
            usage: { cost: 0.0001 }
          };
        },
        async text() {
          return "";
        }
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const config = loadConfig({
      ...SUPABASE_ENV,
      OPENROUTER_API_KEY: "or-key"
    });
    const overrides = stubbedDeps({
      db: {
        async checkApiBudget() {
          return { allowed: true };
        },
        async recordApiUsageCost() {
          return {};
        },
        async getMessage() {
          return {
            id: "msg-1",
            role: "assistant",
            content: [
              { type: "text", text: "Here is the draft." },
              { type: "text", text: "```email\nTo:\nSubject: Old\nHi\n```" }
            ]
          };
        },
        async updateMessage(_userId, id, patch) {
          saved = { id, patch };
          return { id, ...patch };
        }
      }
    });

    const res = await dispatch(config, {
      method: "POST",
      path: "/api/email/revise",
      body: {
        draft: "Subject: Old\n\nHi",
        instruction: "Come up with a good excuse",
        messageId: "msg-1"
      },
      overrides
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.json().source, /Subject: Extension/);
    assert.equal(chatCalls, 1);
    assert.equal(saved.id, "msg-1");
    assert.equal(saved.patch.content[0].text, "Here is the draft.");
    assert.match(saved.patch.content[1].text, /Subject: Extension/);
    assert.equal(saved.patch.content.filter((part) => /```email\b/.test(part.text)).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editable document revise stops a hung provider request", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const keepAlive = setTimeout(() => {}, 100);
  AbortSignal.timeout = () => originalTimeout(1);
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  try {
    const config = loadConfig({
      ...SUPABASE_ENV,
      OPENROUTER_API_KEY: "or-key",
      R2_ACCOUNT_ID: "account-1",
      R2_ACCESS_KEY_ID: "r2-key",
      R2_SECRET_ACCESS_KEY: "r2-secret",
      R2_BUCKET: "uploads"
    });
    const overrides = stubbedDeps({
      db: {
        async getDocumentFileByAttachment() {
          return { id: "doc-1", metadata: { editable: true, editor_markdown: "# Hello", editor_revision: 1 } };
        },
        async checkApiBudget() {
          return { allowed: true };
        }
      }
    });

    const res = await dispatch(config, {
      method: "POST",
      path: "/api/attachments/doc-attachment/editor/revise",
      body: { markdown: "# Hello", selection: "Hello", instruction: "Improve it" },
      overrides
    });

    assert.equal(res.statusCode, 504);
    assert.equal(res.json().error, "Document revision timed out. Try again.");
  } finally {
    clearTimeout(keepAlive);
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
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
      dbMethod: "reserveAttachment",
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
    { method: "POST", path: "/api/admin/payments/pay-1/approve", body: {}, dbMethod: "getPaymentRequest", result: null },
    { method: "POST", path: "/api/admin/reports/rep-1/done", body: {}, dbMethod: "getContentReport", result: null },
    { method: "POST", path: "/api/admin/reports/rep-1/reported", body: {}, dbMethod: "getContentReport", result: null }
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

test("study materials expose Rapid/Deep flashcard modes", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return {
          id: "course-1",
          kind: "course",
          name: "CMP 321",
          meta: { flashcardModes: { "doc:doc-2": "deep" }, hiddenDocumentIds: ["doc-3"] }
        };
      },
      async listProjectDocuments() { return [{ id: "doc-1" }, { id: "doc-2" }, { id: "doc-3" }]; },
      async listStudyNotes() { return []; },
      async listStudyCards() {
        return [
          { document_file_id: "doc-1", note_id: null },
          { document_file_id: "doc-2", note_id: null }
        ];
      }
    }
  });
  const res = await dispatch(authReadyConfig, { path: "/api/study/courses/course-1/materials", overrides });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().flashcardModes, { "doc:doc-1": "rapid", "doc:doc-2": "deep" });
  assert.deepEqual(res.json().documents.map((doc) => doc.id), ["doc-1", "doc-2"]);
});

test("deleting a study file hides it, frees quota, and keeps the document id", async () => {
  const patches = [];
  const sizePatches = [];
  const deletedKeys = [];
  let deletedAttachment = false;
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return { id: "course-1", kind: "course", name: "CMP 321", meta: { term: "Fall" } };
      },
      async getDocumentFile() {
        return { id: "doc-1", project_id: "course-1", attachment_id: "att-1" };
      },
      async getAttachment() {
        return {
          id: "att-1",
          object_key: "users/user-1/ch4.pdf",
          category: "document",
          size_bytes: 4096
        };
      },
      async getDocumentFileByAttachment() {
        return {
          id: "doc-1",
          kind: "pdf",
          page_count: 1,
          extraction_key: "users/user-1/extract.json",
          preview_key: "users/user-1/preview.json"
        };
      },
      async listDocumentPages() {
        return [{ image_key: "users/user-1/documents/doc-1/pages/page-0001.jpg" }];
      },
      async updateAttachment(_userId, id, patch) {
        sizePatches.push({ id, patch });
        return { id, ...patch };
      },
      async deleteAttachment() { deletedAttachment = true; },
      async updateProject(_userId, projectId, patch) {
        patches.push(patch);
        return { id: projectId, kind: "course", meta: patch.meta };
      }
    }
  });
  overrides.createR2 = () => ({
    async deleteObjects(keys) {
      deletedKeys.push(...keys);
      return keys.length;
    }
  });
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/courses/course-1/materials",
    body: { documentFileId: "doc-1" },
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(patches[0].meta.hiddenDocumentIds, ["doc-1"]);
  assert.equal(patches[0].meta.term, "Fall");
  assert.equal(deletedAttachment, false);
  assert.deepEqual(sizePatches, [{ id: "att-1", patch: { size_bytes: 0 } }]);
  assert.equal(deletedKeys.includes("users/user-1/ch4.pdf"), true);
  assert.equal(deletedKeys.includes("users/user-1/extract.json"), true);
  assert.equal(deletedKeys.includes("users/user-1/preview.json"), true);
  assert.equal(deletedKeys.includes("users/user-1/documents/doc-1/pages/page-0001.jpg"), true);
});

test("flashcard generate rejects a second Rapid and a missing mode", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return {
          id: "course-1",
          kind: "course",
          name: "CMP 321",
          meta: { flashcardModes: { "doc:doc-1": "rapid" } }
        };
      },
      async getDocumentFile() {
        return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z" };
      },
      async listStudyCards() {
        return [{ document_file_id: "doc-1", note_id: null, front: "What is a parse tree?" }];
      }
    }
  });
  const again = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "flashcards", documentFileId: "doc-1", mode: "rapid" },
    overrides
  });
  assert.equal(again.statusCode, 409);
  assert.match(again.json().error, /Rapid already created/);

  const missing = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "flashcards", documentFileId: "doc-1" },
    overrides
  });
  assert.equal(missing.statusCode, 400);
  assert.match(missing.json().error, /mode must be rapid or deep/);
});

test("flashcard generate serializes Rapid and Deep for one material", async () => {
  const realFetch = globalThis.fetch;
  let releaseHang;
  const hang = new Promise((resolve) => { releaseHang = resolve; });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/chat/completions")) {
      await hang;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321", meta: {} }; },
        async getDocumentFile() {
          return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        },
        async listStudyCards() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles() {
          return [{ text: "Photosynthesis converts light to chemical energy." }];
        },
        async createStudyCards() { return []; }
      }
    });
    const first = await dispatchPending(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "flashcards", documentFileId: "doc-1", mode: "rapid" },
      overrides
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(first.res.statusCode, 200);
    assert.match(first.res.headers["content-type"], /text\/event-stream/);

    const second = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "flashcards", documentFileId: "doc-1", mode: "deep" },
      overrides
    });
    assert.equal(second.statusCode, 409);
    assert.match(second.json().error, /already in progress/);

    first.res.emitClose();
    releaseHang();
    await first.done;
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("study generate rejects more than five files and notes from a combo", async () => {
  const files = Array.from({ length: 6 }, (_, i) => `doc-${i + 1}`);
  const tooMany = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "quiz", documentFileIds: files, count: 10 },
    overrides: stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; }
      }
    })
  });
  assert.equal(tooMany.statusCode, 400);
  assert.match(tooMany.json().error, /up to 5/);

  const notes = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "notes", documentFileIds: ["doc-1", "doc-2"], mode: "summary" },
    overrides: stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; },
        async getDocumentFile(_userId, id) {
          return { id, project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        }
      }
    })
  });
  assert.equal(notes.statusCode, 400);
  assert.match(notes.json().error, /Notes can only be generated from a file/);
});

test("combo flashcard generate stamps deck_key and skips Your cards", async () => {
  const realFetch = globalThis.fetch;
  const created = [];
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/generation")) {
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.endsWith("/chat/completions")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "gen-combo-1",
            choices: [{ delta: { content: '{"cards":[{"front":"Q","back":"A"}]}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 }
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321", meta: {} }; },
        async getDocumentFile(_userId, id) {
          return {
            id,
            project_id: "course-1",
            text_ready_at: "2026-01-01T00:00:00Z",
            kind: "txt",
            file_name: id === "doc-1" ? "Ch1.pdf" : "Ch2.pdf"
          };
        },
        async listStudyCards() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles(_userId, ids) {
          return ids.map((id) => ({ document_file_id: id, text: `${id} syntax.` }));
        },
        async createStudyCards(_userId, cards) {
          created.push(cards);
          return cards.map((card, index) => ({ id: `card-${index}`, ...card }));
        },
        async updateProject(_userId, _id, patch) {
          patches.push(patch);
          return { id: "course-1", kind: "course", meta: patch.meta };
        },
        async recordApiUsageCost() { return null; }
      }
    });
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "flashcards", documentFileIds: ["doc-1", "doc-2"], mode: "rapid" },
      overrides
    });
    assert.equal(res.statusCode, 200);
    const complete = res.sseEvents().find((event) => event.type === "complete");
    assert.ok(complete);
    assert.equal(complete.result.type, "flashcards");
    assert.equal(complete.result.count, 1);
    assert.equal(created[0][0].document_file_id, null);
    assert.equal(created[0][0].note_id, null);
    assert.match(created[0][0].deck_key, /^combo_[0-9a-f-]{36}$/i);
    const key = created[0][0].deck_key;
    assert.equal(patches[0].meta.deckTitles[key], "Ch1.pdf, Ch2.pdf");
    assert.equal(patches[0].meta.flashcardModes[key], "rapid");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("empty deep flashcard output errors without stamping flashcardModes", async () => {
  const realFetch = globalThis.fetch;
  const patches = [];
  let created = 0;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/generation")) {
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.endsWith("/chat/completions")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "gen-empty-deep",
            choices: [{ delta: { content: '{"cards":[]}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 }
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "flashcards", documentFileId: "doc-1", mode: "deep" },
      overrides: stubbedDeps({
        db: {
          async getProject() { return { id: "course-1", kind: "course", name: "CMP 321", meta: {} }; },
          async getDocumentFile() {
            return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
          },
          async listStudyCards() { return []; },
          async checkApiBudget() { return { allowed: true }; },
          async listDocumentChunksForFiles() {
            return [{ text: "Photosynthesis converts light to chemical energy." }];
          },
          async createStudyCards() {
            created += 1;
            return [];
          },
          async updateProject(_userId, _id, patch) {
            patches.push(patch);
            return { id: "course-1", kind: "course", meta: patch.meta };
          },
          async recordApiUsageCost() { return null; }
        }
      })
    });
    assert.equal(res.statusCode, 200);
    const events = res.sseEvents();
    assert.ok(events.some((event) => event.type === "error" && /Generation failed/i.test(event.error)));
    assert.equal(events.some((event) => event.type === "complete"), false);
    assert.equal(created, 0);
    assert.equal(patches.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("combo quiz generate stores a course-level quiz", async () => {
  const realFetch = globalThis.fetch;
  const created = [];
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/generation")) {
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.endsWith("/chat/completions")) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "gen-combo-quiz",
            choices: [{ delta: { content: '{"title":"Ch1 + Ch2","questions":[{"q":"Q","topic":"T","choices":["A","B","C","D"],"answer":0,"whys":["a","b","c","d"]}]}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 }
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321", meta: {} }; },
        async getDocumentFile(_userId, id) {
          return { id, project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt", file_name: `${id}.pdf` };
        },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles(_userId, ids) {
          return ids.map((id) => ({ document_file_id: id, text: `${id} text.` }));
        },
        async createStudyQuiz(_userId, quiz) {
          created.push(quiz);
          return { id: "quiz-combo", ...quiz };
        },
        async updateProject(_userId, _id, patch) {
          patches.push(patch);
          return { id: "course-1", kind: "course", meta: patch.meta };
        },
        async recordApiUsageCost() { return null; }
      }
    });
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "quiz", documentFileIds: ["doc-1", "doc-2"], count: 10 },
      overrides
    });
    assert.equal(res.statusCode, 200);
    const complete = res.sseEvents().find((event) => event.type === "complete");
    assert.ok(complete);
    assert.equal(complete.result.id, "quiz-combo");
    assert.equal(created[0].document_file_id, null);
    assert.equal(created[0].note_id, null);
    assert.equal(created[0].title, "Ch1 + Ch2");
    assert.match(created[0].deck_key, /^combo_[0-9a-f-]{36}$/i);
    assert.equal(patches[0].meta.deckTitles[created[0].deck_key], "Ch1 + Ch2");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("notes generate rejects a second Summary", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; },
      async getDocumentFile() {
        return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z" };
      },
      async listStudyNotes() {
        return [{ document_file_id: "doc-1", kind: "summary" }];
      }
    }
  });
  const again = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
    overrides
  });
  assert.equal(again.statusCode, 409);
  assert.match(again.json().error, /Summary already created/);
});

test("study generate streams SSE complete for notes", async () => {
  const realFetch = globalThis.fetch;
  const created = [];
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/generation")) {
      return new Response(JSON.stringify({ data: { total_cost: 0.001 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (href.endsWith("/chat/completions")) {
      const body = JSON.parse(options.body || "{}");
      assert.equal(body.stream, true);
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            id: "gen-study-1",
            choices: [{ delta: { content: "# Cell Biology\n\nMembranes matter." }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 }
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() {
          return { id: "course-1", kind: "course", name: "CMP 321", meta: {} };
        },
        async getDocumentFile() {
          return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        },
        async listStudyNotes() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles() {
          return [{ text: "Membranes control what enters the cell." }];
        },
        async createStudyNote(_userId, note) {
          created.push(note);
          return { id: "note-1", ...note };
        },
        async recordApiUsageCost() { return null; }
      }
    });
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
      overrides
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    const events = res.sseEvents();
    assert.ok(events.some((event) => event.type === "status" && event.stage === "preparing"));
    const complete = events.find((event) => event.type === "complete");
    assert.ok(complete, `events=${JSON.stringify(events)}`);
    assert.equal(complete.result.type, "notes");
    assert.equal(complete.result.id, "note-1");
    assert.equal(complete.result.mode, "summary");
    assert.match(res.body, /data: \[DONE\]/);
    assert.equal(created.length, 1);
    assert.match(created[0].content, /Membranes matter/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("study generate validates before SSE headers", async () => {
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/generate",
    body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
    overrides: stubbedDeps({
      db: {
        async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; },
        async getDocumentFile() { return null; }
      }
    })
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.headersSent, true);
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.match(res.json().error, /Material not found/);
});

test("study generate aborts on response close without saving", async () => {
  const realFetch = globalThis.fetch;
  const created = [];
  let abortSeen = false;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`);
    return new Response(new ReadableStream({
      start(controller) {
        const onAbort = () => {
          abortSeen = true;
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          try { controller.error(error); } catch { /* already closed */ }
        };
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
      }
    }), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() {
          return { id: "course-1", kind: "course", name: "CMP 321", meta: {} };
        },
        async getDocumentFile() {
          return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        },
        async listStudyNotes() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles() {
          return [{ text: "Abortable source text for study notes." }];
        },
        async createStudyNote(_userId, note) {
          created.push(note);
          return { id: "note-1", ...note };
        }
      }
    });
    const pending = await dispatchPending(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
      overrides
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(pending.res.statusCode, 200);
    assert.match(pending.res.headers["content-type"], /text\/event-stream/);
    pending.res.emitClose();
    await pending.done;
    assert.equal(created.length, 0);
    assert.equal(abortSeen, true);
    const events = pending.res.sseEvents();
    assert.equal(events.some((event) => event.type === "complete"), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("study generate aborts on request abort without saving", async () => {
  const realFetch = globalThis.fetch;
  const created = [];
  let abortSeen = false;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`);
    return new Response(new ReadableStream({
      start(controller) {
        const onAbort = () => {
          abortSeen = true;
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          try { controller.error(error); } catch { /* already closed */ }
        };
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener("abort", onAbort, { once: true });
      }
    }), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() {
          return { id: "course-1", kind: "course", name: "CMP 321", meta: {} };
        },
        async getDocumentFile() {
          return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        },
        async listStudyNotes() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles() {
          return [{ text: "Abortable source text for study notes." }];
        },
        async createStudyNote(_userId, note) {
          created.push(note);
          return { id: "note-1", ...note };
        }
      }
    });
    const pending = await dispatchPending(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
      overrides
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(pending.res.statusCode, 200);
    pending.req.emit("aborted");
    await pending.done;
    assert.equal(created.length, 0);
    assert.equal(abortSeen, true);
    assert.equal(pending.res.sseEvents().some((event) => event.type === "complete"), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("study generate emits error event after SSE headers", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith("/chat/completions")) throw new Error(`unexpected fetch ${url}`);
    return new Response("upstream failed", { status: 502 });
  };
  try {
    const overrides = stubbedDeps({
      db: {
        async getProject() {
          return { id: "course-1", kind: "course", name: "CMP 321", meta: {} };
        },
        async getDocumentFile() {
          return { id: "doc-1", project_id: "course-1", text_ready_at: "2026-01-01T00:00:00Z", kind: "txt" };
        },
        async listStudyNotes() { return []; },
        async checkApiBudget() { return { allowed: true }; },
        async listDocumentChunksForFiles() {
          return [{ text: "Source text." }];
        }
      }
    });
    const res = await dispatch(authReadyConfig, {
      method: "POST",
      path: "/api/study/courses/course-1/generate",
      body: { type: "notes", documentFileId: "doc-1", mode: "summary" },
      overrides
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/event-stream/);
    const events = res.sseEvents();
    assert.ok(events.some((event) => event.type === "error" && event.error));
    assert.match(res.body, /data: \[DONE\]/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("study generation status endpoints are removed", async () => {
  const list = await dispatch(authReadyConfig, {
    path: "/api/study/courses/course-1/generations",
    overrides: stubbedDeps()
  });
  assert.equal(list.statusCode, 404);

  const one = await dispatch(authReadyConfig, {
    path: "/api/study/generations/job-1",
    overrides: stubbedDeps()
  });
  assert.equal(one.statusCode, 404);
});

test("study note delete is scoped to the course owner", async () => {
  const deleted = [];
  const overrides = stubbedDeps({
    db: {
      async getStudyNote() {
        return { id: "note-1", project_id: "course-1", title: "Summary" };
      },
      async getProject() {
        return { id: "course-1", kind: "course", name: "Biology" };
      },
      async deleteStudyNote(_userId, id) {
        deleted.push(id);
        return null;
      }
    }
  });
  const ok = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/notes/note-1",
    overrides
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(deleted, ["note-1"]);

  const missing = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/notes/note-1",
    overrides: stubbedDeps({
      db: {
        async getStudyNote() { return null; }
      }
    })
  });
  assert.equal(missing.statusCode, 404);
});

test("deleting a deck clears its Rapid/Deep lock", async () => {
  const patches = [];
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return {
          id: "course-1",
          kind: "course",
          name: "CMP 321",
          meta: { term: "Fall", flashcardModes: { "doc:doc-1": "deep", "doc:doc-2": "rapid" } }
        };
      },
      async updateProject(_userId, projectId, patch) {
        patches.push(patch);
        return { id: projectId, kind: "course", meta: patch.meta };
      },
      async deleteStudyCardsForSource() { return null; }
    }
  });
  const res = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/courses/course-1/decks",
    body: { documentFileId: "doc-1" },
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.equal(patches[0].meta.term, "Fall");
  assert.equal(patches[0].meta.flashcardModes["doc:doc-1"], undefined);
  assert.equal(patches[0].meta.flashcardModes["doc:doc-2"], "rapid");
});

test("study practice groups cards into openable decks and applies title overrides", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return {
          id: "course-1",
          kind: "course",
          name: "CMP 321",
          meta: {
            deckTitles: {
              "doc:doc-1": "Syntax notes",
              "combo_11111111-1111-1111-1111-111111111111": "Ch1, Ch2"
            }
          }
        };
      },
      async listProjectDocuments() {
        return [{ id: "doc-1", file_name: "03+SyntaxAndSemantics-4S.pdf" }];
      },
      async listStudyNotes() { return []; },
      async listStudyCards() {
        return [
          { id: "card-1", document_file_id: "doc-1", note_id: null },
          { id: "card-2", document_file_id: "doc-1", note_id: null },
          { id: "card-3", document_file_id: null, note_id: null },
          {
            id: "card-4",
            document_file_id: null,
            note_id: null,
            deck_key: "combo_11111111-1111-1111-1111-111111111111"
          }
        ];
      },
      async listStudyQuizzes() { return []; }
    }
  });
  const res = await dispatch(authReadyConfig, { path: "/api/study/courses/course-1/practice", overrides });
  assert.equal(res.statusCode, 200);
  const decks = res.json().decks;
  const named = decks.find((deck) => deck.id === "doc:doc-1");
  const manual = decks.find((deck) => deck.id === "manual");
  assert.equal(named.title, "Syntax notes");
  assert.equal(named.documentFileId, "doc-1");
  assert.equal(named.cardCount, 2);
  assert.equal(named.dueCount, undefined);
  assert.equal(manual.title, "Your cards");
  assert.equal(manual.manual, true);
  assert.equal(manual.cardCount, 1);
  const combo = decks.find((deck) => deck.id === "combo_11111111-1111-1111-1111-111111111111");
  assert.equal(combo.title, "Ch1, Ch2");
  assert.equal(combo.deckKey, "combo_11111111-1111-1111-1111-111111111111");
  assert.equal(combo.cardCount, 1);
  assert.equal(combo.manual, undefined);
});

test("study queue returns every card in a deck", async () => {
  const listed = [];
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; },
      async listStudyCards() {
        listed.push(true);
        return [
          { id: "later", front: "later", back: "b", document_file_id: "doc-1" },
          { id: "due", front: "due", back: "b", document_file_id: "doc-1" },
          { id: "other", front: "other", back: "b", document_file_id: "doc-2" }
        ];
      }
    }
  });
  const res = await dispatch(authReadyConfig, {
    path: "/api/study/courses/course-1/queue?documentFileId=doc-1",
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.equal(listed.length, 1);
  const cards = res.json().cards;
  assert.deepEqual(cards.map((card) => card.id), ["later", "due"]);
  assert.equal(cards[0].due, undefined);
  assert.equal(cards[0].starred, false);
});

test("study queue can load a combo deck by deckKey", async () => {
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "course-1", kind: "course", name: "CMP 321" }; },
      async listStudyCards() {
        return [
          { id: "combo-1", front: "a", back: "b", deck_key: "combo_11111111-1111-1111-1111-111111111111" },
          { id: "manual", front: "c", back: "d", document_file_id: null, note_id: null },
          { id: "chapter", front: "e", back: "f", document_file_id: "doc-1" }
        ];
      }
    }
  });
  const res = await dispatch(authReadyConfig, {
    path: "/api/study/courses/course-1/queue?deckKey=combo_11111111-1111-1111-1111-111111111111",
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().cards.map((card) => card.id), ["combo-1"]);
});

test("study deck rename and delete are scoped to one source", async () => {
  const patches = [];
  const deleted = [];
  const overrides = stubbedDeps({
    db: {
      async getProject() {
        return {
          id: "course-1",
          kind: "course",
          name: "CMP 321",
          meta: { term: "Fall", deckTitles: { "doc:doc-1": "Old title" } }
        };
      },
      async updateProject(_userId, projectId, patch) {
        patches.push({ projectId, patch });
        return { id: projectId, kind: "course", meta: patch.meta };
      },
      async deleteStudyCardsForSource(_userId, filter) {
        deleted.push(filter);
        return null;
      }
    }
  });

  const renamed = await dispatch(authReadyConfig, {
    method: "PATCH",
    path: "/api/study/courses/course-1/decks",
    body: { documentFileId: "doc-1", title: "  Syntax notes  " },
    overrides
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().title, "Syntax notes");
  assert.equal(patches[0].patch.meta.term, "Fall");
  assert.equal(patches[0].patch.meta.deckTitles["doc:doc-1"], "Syntax notes");

  const removed = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/courses/course-1/decks",
    body: { documentFileId: "doc-1" },
    overrides
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().ok, true);
  assert.equal(deleted[0].projectId, "course-1");
  assert.equal(deleted[0].documentFileId, "doc-1");
  assert.equal(patches.length, 2);
  assert.equal(patches[1].patch.meta.deckTitles["doc:doc-1"], undefined);

  const bad = await dispatch(authReadyConfig, {
    method: "PATCH",
    path: "/api/study/courses/course-1/decks",
    body: { title: "Nope" },
    overrides
  });
  assert.equal(bad.statusCode, 400);
});

test("study course card create returns 201 and rejects an empty front", async () => {
  const created = [];
  const stored = [];
  const overrides = stubbedDeps({
    db: {
      async getProject() { return { id: "course-1", kind: "course", name: "Biology" }; },
      async getStudyQuiz() {
        return { id: "quiz-1", project_id: "course-1", document_file_id: "doc-1", note_id: null };
      },
      async listStudyCards() { return stored; },
      async createStudyCards(_userId, cards) {
        created.push(cards);
        const row = { id: `card-${created.length}`, ...cards[0] };
        stored.push(row);
        return [row];
      }
    }
  });

  const createdRes = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/cards",
    body: { front: "  What is mitosis?  ", back: "Cell division." },
    overrides
  });
  assert.equal(createdRes.statusCode, 201);
  assert.equal(createdRes.json().card.id, "card-1");
  assert.equal(createdRes.json().card.front, "What is mitosis?");
  assert.equal(created[0][0].document_file_id, undefined);
  assert.equal(created[0][0].note_id, undefined);

  const fromQuiz = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/cards",
    body: { front: "What is mitosis?", back: "Cell division.", quizId: "quiz-1" },
    overrides
  });
  assert.equal(fromQuiz.statusCode, 201);
  assert.equal(created[1][0].document_file_id, "doc-1");
  assert.equal(created[1][0].note_id, null);

  const dup = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/cards",
    body: { front: "What is mitosis?", back: "Cell division.", quizId: "quiz-1" },
    overrides
  });
  assert.equal(dup.statusCode, 200);
  assert.equal(dup.json().card.id, "card-2");
  assert.equal(created.length, 2);

  const empty = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/cards",
    body: { front: "   ", back: "Cell division." },
    overrides
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(created.length, 2);

  const comboQuiz = stubbedDeps({
    db: {
      async getProject() { return { id: "course-1", kind: "course", name: "Biology" }; },
      async getStudyQuiz() {
        return {
          id: "quiz-combo",
          project_id: "course-1",
          document_file_id: null,
          note_id: null,
          deck_key: "combo_11111111-1111-1111-1111-111111111111"
        };
      },
      async listStudyCards() { return []; },
      async createStudyCards(_userId, cards) {
        created.push(cards);
        return [{ id: `card-${created.length}`, ...cards[0] }];
      }
    }
  });
  const fromCombo = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/courses/course-1/cards",
    body: { front: "What is a lexeme?", back: "A token.", quizId: "quiz-combo" },
    overrides: comboQuiz
  });
  assert.equal(fromCombo.statusCode, 201);
  assert.equal(created[2][0].document_file_id, null);
  assert.equal(created[2][0].note_id, null);
  assert.equal(created[2][0].deck_key, "combo_11111111-1111-1111-1111-111111111111");
});

test("study card patch can star and rewrite a card", async () => {
  const patches = [];
  const overrides = stubbedDeps({
    db: {
      async getStudyCard() {
        return { id: "card-1", project_id: "course-1", front: "Q", back: "A", starred: false };
      },
      async getProject() {
        return { id: "course-1", kind: "course", name: "Biology" };
      },
      async updateStudyCard(_userId, id, patch) {
        patches.push({ id, patch });
        return { id, project_id: "course-1", front: "Q", back: "A", ...patch };
      }
    }
  });

  const ok = await dispatch(authReadyConfig, {
    method: "PATCH",
    path: "/api/study/cards/card-1",
    body: { starred: true },
    overrides
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().card.starred, true);
  assert.deepEqual(patches, [{ id: "card-1", patch: { starred: true } }]);
});

test("study card delete is scoped to the card owner", async () => {
  const deleted = [];
  const overrides = stubbedDeps({
    db: {
      async getStudyCard() {
        return { id: "card-1", project_id: "course-1", front: "Q" };
      },
      async getProject() {
        return { id: "course-1", kind: "course", name: "Biology" };
      },
      async deleteStudyCard(_userId, id) {
        deleted.push(id);
        return null;
      }
    }
  });

  const ok = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/cards/card-1",
    overrides
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);
  assert.deepEqual(deleted, ["card-1"]);

  const missing = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/cards/missing",
    overrides: stubbedDeps({
      db: {
        async getStudyCard() { return null; }
      }
    })
  });
  assert.equal(missing.statusCode, 404);
});

test("study quiz GET includes answers for in-session reveal", async () => {
  const overrides = stubbedDeps({
    db: {
      async getStudyQuiz() {
        return {
          id: "quiz-1",
          title: "Cells",
          project_id: "course-1",
          document_file_id: "doc-1",
          note_id: null,
          created_at: "2026-08-17T00:00:00Z",
          questions: [{
            q: "What is a cell?",
            topic: "Basics",
            choices: ["A", "B", "C", "D"],
            answer: 2,
            explanation: "secret",
            whys: ["no", "no", "yes", "no"]
          }]
        };
      },
      async getProject() { return { id: "course-1", kind: "course" }; },
      async listStudyCards() {
        return [
          { document_file_id: "doc-1", note_id: null, front: "What is a cell?" },
          { document_file_id: "doc-2", note_id: null, front: "Other" }
        ];
      }
    }
  });
  const res = await dispatch(authReadyConfig, { path: "/api/study/quizzes/quiz-1", overrides });
  assert.equal(res.statusCode, 200);
  const quiz = res.json().quiz;
  assert.equal(quiz.title, "Cells");
  assert.deepEqual(res.json().existingFronts, ["What is a cell?"]);

  const combo = await dispatch(authReadyConfig, {
    path: "/api/study/quizzes/quiz-combo",
    overrides: stubbedDeps({
      db: {
        async getStudyQuiz() {
          return {
            id: "quiz-combo",
            title: "Ch1 + Ch2",
            project_id: "course-1",
            document_file_id: null,
            note_id: null,
            deck_key: "combo_11111111-1111-1111-1111-111111111111",
            created_at: "2026-08-22T00:00:00Z",
            questions: [{ q: "Q", topic: "T", choices: ["A", "B", "C", "D"], answer: 0, explanation: "e", whys: ["a", "b", "c", "d"] }]
          };
        },
        async getProject() { return { id: "course-1", kind: "course" }; },
        async listStudyCards() {
          return [
            { document_file_id: null, note_id: null, front: "Your cards front" },
            { deck_key: "combo_11111111-1111-1111-1111-111111111111", front: "Combo front" }
          ];
        }
      }
    })
  });
  assert.deepEqual(combo.json().existingFronts, ["Combo front"]);
  assert.deepEqual(quiz.questions, [{
    q: "What is a cell?",
    topic: "Basics",
    choices: ["A", "B", "C", "D"],
    answer: 2,
    explanation: "secret",
    whys: ["no", "no", "yes", "no"]
  }]);
});

test("study quiz PATCH renames and DELETE removes", async () => {
  const patches = [];
  const deleted = [];
  const overrides = stubbedDeps({
    db: {
      async getStudyQuiz() {
        return { id: "quiz-1", title: "Cells", project_id: "course-1", questions: [] };
      },
      async getProject() { return { id: "course-1", kind: "course" }; },
      async updateStudyQuiz(_userId, id, patch) {
        patches.push({ id, patch });
        return { id, title: patch.title, project_id: "course-1" };
      },
      async deleteStudyQuiz(_userId, id) {
        deleted.push(id);
        return null;
      }
    }
  });

  const renamed = await dispatch(authReadyConfig, {
    method: "PATCH",
    path: "/api/study/quizzes/quiz-1",
    body: { title: "  Syntax quiz  " },
    overrides
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().title, "Syntax quiz");
  assert.equal(patches[0].id, "quiz-1");
  assert.equal(patches[0].patch.title, "Syntax quiz");

  const removed = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/quizzes/quiz-1",
    overrides
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().ok, true);
  assert.deepEqual(deleted, ["quiz-1"]);

  const missing = await dispatch(authReadyConfig, {
    method: "DELETE",
    path: "/api/study/quizzes/missing",
    overrides: stubbedDeps({
      db: {
        async getStudyQuiz() { return null; }
      }
    })
  });
  assert.equal(missing.statusCode, 404);
});

test("study quiz attempt grades in-session without storing", async () => {
  let stored = false;
  const overrides = stubbedDeps({
    db: {
      async getStudyQuiz() {
        return {
          id: "quiz-1",
          project_id: "course-1",
          questions: [{ q: "Q", choices: ["A", "B"], answer: 1 }]
        };
      },
      async getProject() { return { id: "course-1", kind: "course" }; },
      async createStudyQuizAttempt() { stored = true; }
    }
  });
  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/quizzes/quiz-1/attempts",
    body: { answers: [1] },
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().score, 1);
  assert.equal(res.json().total, 1);
  assert.equal(stored, false);
});

test("study note export uses the document create pipeline", async () => {
  const created = [];
  const overrides = stubbedDeps({
    db: {
      async getStudyNote() {
        return { id: "note-1", title: "Syntax summary", content: "# Hello\n\nWorld" };
      },
      async createDocumentJob(job) {
        created.push(job);
        return { id: "job-1", status: "queued", job_type: job.job_type };
      },
      async getDocumentJob() {
        return {
          id: "job-1",
          status: "succeeded",
          output: { attachment_id: "att-1", file_name: "Syntax summary.pdf", kind: "pdf" }
        };
      }
    }
  });
  const missing = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/notes/missing/export",
    body: { format: "pdf" },
    overrides: stubbedDeps({ db: { async getStudyNote() { return null; } } })
  });
  assert.equal(missing.statusCode, 404);

  const bad = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/notes/note-1/export",
    body: { format: "md" },
    overrides
  });
  assert.equal(bad.statusCode, 400);

  const res = await dispatch(authReadyConfig, {
    method: "POST",
    path: "/api/study/notes/note-1/export",
    body: { format: "pdf" },
    overrides
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().artifact.attachment_id, "att-1");
  assert.equal(created[0].job_type, "document.create.pdf");
  assert.equal(created[0].input.content, "# Hello\n\nWorld");
  assert.equal(created[0].input.instructions, "");
});
