import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";
import { filterCurrentTurnMessages } from "../server/chat/pipeline.js";

/*
 * Phase-0 canonical SSE characterization tests.
 *
 * These freeze the streaming contract of the chat pipeline as a
 * CANONICAL SEMANTIC TRANSCRIPT: the ordered sequence of event types
 * and their required fields, with volatile values (generated IDs,
 * timestamps, costs) normalized before comparison. Persistence writes
 * and billing calls observed by the fake DB are asserted alongside.
 *
 * Covered: single chat with a web-search tool call, two-model compare,
 * council through chairman synthesis, temporary chat, empty-response
 * errors, aborts, and usage/cost events. Phases 1 and 4 must not
 * change any expectation here.
 */

const TEXT_MODEL = "deepseek/deepseek-v4-flash-0731";
const VISION_MODEL = "xiaomi/mimo-v2.5";
const DEFAULT_COMPARE_MODELS = [TEXT_MODEL, VISION_MODEL];
const DEFAULT_COUNCIL_MODELS = [TEXT_MODEL, "tencent/hy3", VISION_MODEL, "xiaomi/mimo-v2.5-pro"];

const CONFIG_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  OPENROUTER_API_KEY: "or-key",
  CROFAI_API_KEY: "crof-key"
};

/* ── request/response fakes ── */

function makeReq({ method = "POST", path, body = null } = {}) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.headers = { host: "test.local" };
  req.aborted = false;
  return req;
}

function makeRes(calls = null) {
  return {
    statusCode: null,
    headers: {},
    body: "",
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    closeHandlers: [],
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers || {})) {
        this.headers[String(name).toLowerCase()] = value;
      }
      this.headersSent = true;
      if (headers["x-klui-turn-run-id"]) calls?.push({ op: "responseStart" });
      return this;
    },
    write(chunk) {
      this.body += String(chunk);
      return true;
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
      calls?.push({ op: "responseEnd" });
      this.writableEnded = true;
      return this;
    },
    on(event, fn) {
      if (event === "close") this.closeHandlers.push(fn);
    },
    emitClose() {
      this.destroyed = true;
      for (const fn of this.closeHandlers) fn();
    }
  };
}

/* ── SSE parsing and canonicalization ── */

function parseSse(body) {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => block.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

function canonicalChunk(event) {
  const choice = event?.choices?.[0] || null;
  const toolCalls = (choice?.delta?.tool_calls || [])
    .map((call) => call?.function?.name || "")
    .filter(Boolean);
  return {
    kind: "chunk",
    content: choice?.delta?.content || "",
    ...(toolCalls.length ? { toolCalls } : {}),
    ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
    ...(event?.usage ? { usage: "<usage>" } : {})
  };
}

const ID_KEYS = new Set(["sessionId", "assistantMessageId", "toolCallId"]);

function canonicalEvent(event) {
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    return canonicalChunk(event);
  }
  const out = { type: event.type };
  for (const [key, value] of Object.entries(event)) {
    if (key === "type") continue;
    if (ID_KEYS.has(key)) {
      out[key] = value ? "<id>" : value;
    } else if (key === "assistantMessageIds") {
      out[key] = Array.isArray(value) ? value.map(() => "<id>") : value;
    } else if (key === "usage") {
      out[key] = value ? "<usage>" : value;
    } else if (key === "event") {
      out[key] = canonicalChunk(value);
    } else if (key === "citations") {
      out[key] = (value || []).map((citation) => {
        const picked = {};
        for (const field of ["index", "title", "url", "marker", "provider"]) {
          if (citation[field] !== undefined) picked[field] = citation[field];
        }
        return picked;
      });
    } else {
      out[key] = value;
    }
  }
  return out;
}

function transcript(res) {
  return parseSse(res.body).map(canonicalEvent);
}

/* ── provider stream fakes (global fetch) ── */

function sseStreamResponse(events, { hang = false, signalHook = null } = {}) {
  const encoder = new TextEncoder();
  let streamController = null;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      if (!hang) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }
  });
  if (hang && typeof signalHook === "function") {
    signalHook(() => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      try { streamController.error(error); } catch { /* already errored */ }
    });
  }
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function contentDelta(content) {
  return { choices: [{ delta: { content }, finish_reason: "stop" }] };
}

function usageChunk({ cost = 0.001 } = {}) {
  return {
    id: "gen-test-1",
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost }
  };
}

function toolCallDelta({ id = "call_1", name = "web_search", args = { query: "latest ai news" } } = {}) {
  return {
    choices: [{
      delta: {
        tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }]
      },
      finish_reason: "tool_calls"
    }]
  };
}

const realFetch = globalThis.fetch;

/**
 * Installs a scripted global fetch. `streamFor(body, options)` returns the
 * event list (or Response) for each streaming /chat/completions call;
 * `completionFor(body)` returns the JSON payload for non-streaming calls.
 */
function installProviderFetch({ streamFor, completionFor = null, imageFor = null }) {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/models")) return jsonResponse({ data: [] });
    if (href.includes("/generation")) return jsonResponse({ data: { total_cost: 0.001 } });
    if (href.endsWith("/images")) {
      if (!imageFor) throw new Error(`Unexpected fetch in SSE test: ${href}`);
      return jsonResponse(imageFor(JSON.parse(options.body), options));
    }
    if (href.endsWith("/chat/completions")) {
      const body = JSON.parse(options.body);
      if (body.stream) {
        const scripted = streamFor(body, options);
        return scripted instanceof Response ? scripted : sseStreamResponse(scripted);
      }
      if (completionFor) return jsonResponse(completionFor(body));
      throw new Error(`Unexpected non-stream completion call for ${body.model}`);
    }
    throw new Error(`Unexpected fetch in SSE test: ${href}`);
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/* ── fake DB + auth ── */

function futureIso(ms = 60_000) {
  return new Date(Date.now() + ms).toISOString();
}

function searchCacheRow() {
  return {
    query_hash: "hash",
    expires_at: futureIso(),
    results: {
      query: "latest ai news",
      provider: "searxng",
      results: [{
        index: 1,
        title: "AI News",
        url: "https://example.com/ai",
        snippet: "The latest in AI",
        publishedAt: null,
        content: "Model releases everywhere."
      }],
      tokens: null,
      fetchedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function makeDb({ conversation, cachedSearch = null, messages: seedMessages = null } = {}) {
  const calls = [];
  let counter = 0;
  const messages = seedMessages ? seedMessages.map((message) => ({ ...message })) : null;
  const db = {
    calls,
    async upsertProfile(user) { return { id: user.id, role: "user" }; },
    async getConversation() { return conversation; },
    async listMessages() {
      return messages ? messages.map((message) => ({ ...message })) : [];
    },
    async deleteMessage(userId, id, { signal } = {}) {
      calls.push({ op: "deleteMessage", userId, id, signal });
      if (messages) {
        const index = messages.findIndex((message) => message.id === id);
        if (index >= 0) {
          const [removed] = messages.splice(index, 1);
          return removed;
        }
      }
      return { id };
    },
    async listMessageAttachments() { return []; },
    async getAppSetting() { return null; },
    async getResearchRun() { return null; },
    async getModelCache() { return null; },
    async upsertModelCache() { return {}; },
    async getSearchCache() { return cachedSearch; },
    async upsertSearchCache() { return {}; },
    async updateAttachment() { return {}; },
    async deleteAttachment(userId, id) {
      calls.push({ op: "deleteAttachment", userId, id });
    },
    async checkApiBudget(payload) {
      calls.push({ op: "checkApiBudget", payload });
      return { allowed: true };
    },
    async recordApiUsageCost(payload) {
      calls.push({ op: "recordApiUsageCost", payload });
      return {};
    },
    async createAttachment(row) {
      counter += 1;
      const attachment = { id: `att-${counter}`, ...row };
      calls.push({ op: "createAttachment", attachment });
      return attachment;
    },
    async reserveAttachment(params) {
      counter += 1;
      const attachment = {
        id: `att-${counter}`,
        object_key: params.objectKey,
        file_name: params.fileName,
        content_type: params.contentType,
        size_bytes: params.sizeBytes,
        category: params.category,
        status: "pending"
      };
      calls.push({ op: "createAttachment", attachment });
      return attachment;
    },
    async completeAttachment(userId, id, patch) {
      calls.push({ op: "completeAttachment", id, patch });
      return { id, ...patch, status: "uploaded" };
    },
    async completeReservedAttachment({ attachmentId, sizeBytes, etag }) {
      calls.push({ op: "completeAttachment", id: attachmentId, patch: { size_bytes: sizeBytes, etag } });
      return { id: attachmentId, size_bytes: sizeBytes, etag, status: "uploaded" };
    },
    async insertMessage(row) {
      counter += 1;
      const message = { id: `msg-${counter}`, ...row };
      calls.push({ op: "insertMessage", message });
      return message;
    },
    async updateMessage(userId, id, patch) {
      calls.push({ op: "updateMessage", id, patch });
      return { id, ...patch };
    },
    async updatePendingTurnOutput({ messageId, patch }) {
      calls.push({ op: "updatePendingTurnOutput", id: messageId, patch });
      return { id: messageId, ...patch };
    },
    async updateConversation(userId, id, patch) {
      calls.push({ op: "updateConversation", id, patch });
      return { ...conversation, ...patch };
    }
  };
  return db;
}

function overridesFor(db) {
  return {
    createDb: () => db,
    createR2: () => ({
      readUrl(key) { return `https://signed.example/${key}`; },
      objectKey({ userId, fileName }) { return `users/${userId}/${fileName}`; },
      async putObject(key, body, opts) {
        db.calls.push({ op: "putObject", key, size: body?.length, contentType: opts?.contentType });
        return { etag: "etag-1" };
      },
      async deleteObjects(keys) { db.calls.push({ op: "deleteObjects", keys }); }
    }),
    verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} })
  };
}

async function dispatchChat(config, db, { path, body }) {
  const req = makeReq({ path, body });
  const res = makeRes(db.calls);
  await createApiHandler(config, overridesFor(db))(req, res, new URL(path, "http://test.local"));
  return res;
}

const conversationRow = { id: "conv-1", title: "Existing chat", model: TEXT_MODEL };

test("chat role think resolves on the server without a vendor model ID", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: (body) => {
      assert.equal(body.model, TEXT_MODEL);
      assert.deepEqual(body.reasoning, { effort: "xhigh", exclude: false });
      return [contentDelta("Think response."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: { id: "conv-1", title: "Existing chat", model: TEXT_MODEL } });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Use Think", role: "think", agentMode: false }
  });

  assert.equal(res.statusCode, 200, res.body);
  const identity = db.calls.find((call) => call.op === "updateConversation" && call.patch.model);
  assert.equal(identity?.patch.model, "think");
});

test("Pro ignores a Klui provider request and sends Luna through OpenAI at max reasoning", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: (body) => {
      assert.equal(body.model, "openai/gpt-5.6-luna");
      assert.deepEqual(body.reasoning, { effort: "xhigh", exclude: false });
      assert.equal(body.service_tier, "flex");
      assert.deepEqual(body.provider, { order: ["openai/flex"], allow_fallbacks: false });
      assert.equal(body.messages.filter((message) => message.role === "system").length, 1);
      assert.match(body.messages[0].content, /Conversation style for this model:/);
      return [contentDelta("Pro response."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: {
      text: "Use Pro",
      model: "openai/gpt-5.6-luna",
      provider: "klui",
      settings: { reasoning_effort: "low" },
      agentMode: false
    }
  });

  assert.equal(res.statusCode, 200, res.body);
});

test("pending turn execution excludes its user row and output shells from provider history", () => {
  const messages = [
    { id: "older-user", role: "user", content: "Earlier" },
    { id: "turn-user", role: "user", content: "Current" },
    { id: "turn-output", role: "assistant", turn_run_id: "turn-1", output_slot: "single", content: "" },
    { id: "unrelated-output", role: "assistant", turn_run_id: "turn-0", content: "Previous answer" }
  ];
  assert.deepEqual(
    filterCurrentTurnMessages(messages, "turn-1", "turn-user").map((message) => message.id),
    ["older-user", "unrelated-output"]
  );
});

/* ── (a) single chat with a web-search tool call ── */

test("single chat with a web-search tool call: canonical transcript, persistence, and billing", async (t) => {
  t.after(restoreFetch);
  let streamCalls = 0;
  installProviderFetch({
    streamFor: () => {
      streamCalls += 1;
      if (streamCalls === 1) return [toolCallDelta()];
      return [contentDelta("AI moved fast this week. [1]"), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, cachedSearch: searchCacheRow() });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "What is the latest AI news today?", model: TEXT_MODEL, agentMode: true }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.equal(res.headers["x-klui-user-message-id"], "msg-1");
  assert.equal(res.headers["x-klui-assistant-message-id"], "msg-2");

  assert.deepEqual(transcript(res), [
    { kind: "chunk", content: "", toolCalls: ["web_search"], finishReason: "tool_calls" },
    /* Provisional-prose reset: the loop clears any pre-tool prose. */
    { type: "response:reset" },
    {
      type: "tool:start",
      toolCallId: "<id>",
      name: "web_search",
      arguments: JSON.stringify({ query: "latest ai news" })
    },
    {
      type: "tool:result",
      toolCallId: "<id>",
      name: "web_search",
      query: "latest ai news",
      provider: "searxng",
      cached: true,
      /* The SSE event carries the raw tool citations; marker/provider
         enrichment happens only on the persisted metadata copy. */
      citations: [{
        index: 1,
        title: "AI News",
        url: "https://example.com/ai"
      }],
      artifacts: [],
      error: null
    },
    { kind: "chunk", content: "AI moved fast this week. [1]", finishReason: "stop" },
    { kind: "chunk", content: "", usage: "<usage>" },
    { type: "usage", usage: "<usage>" }
  ]);

  /* The trailing usage event carries normalized fields. */
  const usageEvent = parseSse(res.body).find((event) => event.type === "usage");
  assert.deepEqual(
    Object.keys(usageEvent.usage).sort(),
    ["completionTokens", "costCredits", "promptTokens", "totalTokens"]
  );

  /* Persistence: user + assistant inserts, final assistant update. */
  const inserts = db.calls.filter((call) => call.op === "insertMessage");
  assert.deepEqual(inserts.map((call) => call.message.role), ["user", "assistant"]);
  const finalUpdate = db.calls.filter((call) => call.op === "updateMessage").at(-1);
  assert.equal(finalUpdate.id, "msg-2");
  assert.equal(finalUpdate.patch.content, "AI moved fast this week. [1]");
  assert.equal(finalUpdate.patch.finish_reason, "stop");
  assert.ok(finalUpdate.patch.metadata.websearch, "assistant metadata records websearch");
  assert.equal(finalUpdate.patch.metadata.websearch.toolCallCount, 1);

  /* Billing gate: budget checked before each metered stream, cost recorded after. */
  const billingOps = db.calls
    .filter((call) => call.op === "checkApiBudget" || call.op === "recordApiUsageCost")
    .map((call) => call.op);
  assert.deepEqual(billingOps, [
    "checkApiBudget", "recordApiUsageCost",
    "checkApiBudget", "recordApiUsageCost"
  ]);
  const recorded = db.calls.find((call) => call.op === "recordApiUsageCost");
  assert.equal(recorded.payload.provider, "openrouter");
  assert.equal(recorded.payload.status, "completed");
});

test("first message stores a generated intent title without delaying the response model", async (t) => {
  t.after(restoreFetch);
  let titleBody;
  installProviderFetch({
    streamFor: () => [contentDelta("Here is the comparison."), usageChunk()],
    completionFor: (body) => {
      titleBody = body;
      return {
        id: "title-gen",
        choices: [{ message: { content: "Compare VPS Hosting Costs" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.00001 }
      };
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const conversation = { id: "conv-1", title: "New chat", model: TEXT_MODEL };
  const db = makeDb({ conversation });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Can you compare VPS hosting costs for deployment?", model: TEXT_MODEL, agentMode: false }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(titleBody.model, "poolside/laguna-xs-2.1");
  assert.equal(
    db.calls.find((call) => call.op === "updateConversation" && call.patch.title)?.patch.title,
    "Compare VPS Hosting Costs"
  );
  const titleUsage = db.calls.find((call) => (
    call.op === "recordApiUsageCost"
    && call.payload.model === "poolside/laguna-xs-2.1"
  ));
  assert.equal(titleUsage.payload.provider, "openrouter");
  assert.equal(titleUsage.payload.costCredits, 0.00001);
  assert.ok(db.calls.filter((call) => call.op === "checkApiBudget").length >= 2);
});

test("a raw fallback title is retried using the first user message", async (t) => {
  t.after(restoreFetch);
  let titleBody;
  installProviderFetch({
    streamFor: () => [contentDelta("Done."), usageChunk()],
    completionFor: (body) => {
      titleBody = body;
      return {
        id: "title-retry",
        choices: [{ message: { content: "Rewrite Recent Chat Heading" } }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cost: 0.00001 }
      };
    }
  });

  const firstPrompt = "hi i need you to rewrite the recent chat heading because it failed";
  const config = loadConfig(CONFIG_ENV);
  const conversation = { id: "conv-1", title: "hi i need you to rewrite the recent chat head...", model: TEXT_MODEL };
  const db = makeDb({
    conversation,
    messages: [
      { id: "old-user", role: "user", content: firstPrompt },
      { id: "old-assistant", role: "assistant", content: "Sure." }
    ]
  });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Please try the title again", model: TEXT_MODEL, agentMode: false }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.match(titleBody.messages[1].content, new RegExp(firstPrompt));
  assert.equal(
    db.calls.find((call) => call.op === "updateConversation" && call.patch.title)?.patch.title,
    "Rewrite Recent Chat Heading"
  );
});

/* ── (b) two-model compare ── */

test("compare: server substitutes the default pair and streams per-index start/delta/done", async (t) => {
  t.after(restoreFetch);
  const providerBodies = [];
  installProviderFetch({
    streamFor: (body) => {
      providerBodies.push(body);
      return [contentDelta(`Answer from ${body.model}`), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Compare this.", models: ["model-a", "model-b"], writingStyle: "learning", skillIds: ["humanizer"] }
  });

  assert.equal(res.statusCode, 200);
  const events = transcript(res);

  for (const [index, model] of DEFAULT_COMPARE_MODELS.entries()) {
    const lane = events.filter((event) => event.index === index);
    assert.deepEqual(lane, [
      { type: "start", index, model, assistantMessageId: "<id>", metadata: {} },
      { type: "delta", index, model, event: { kind: "chunk", content: `Answer from ${model}`, finishReason: "stop" } },
      { type: "delta", index, model, event: { kind: "chunk", content: "", usage: "<usage>" } },
      { type: "done", index, model }
    ], `lane ${index} (${model})`);
  }
  assert.equal(events.length, 8, "compare emits exactly per-lane events, no global done/usage");
  assert.ok(providerBodies.every((body) => /Writing style skill \(learning\)/.test(body.messages[0].content)));
  assert.ok(providerBodies.every((body) => /<klui_composer_skill id="humanizer">/.test(body.messages[0].content)));
  assert.ok(providerBodies.every((body) => !("skillIds" in body)));

  /* Two assistant rows persisted, then updated with their content. */
  const assistantInserts = db.calls.filter((call) => call.op === "insertMessage" && call.message.role === "assistant");
  assert.deepEqual(assistantInserts.map((call) => call.message.model), DEFAULT_COMPARE_MODELS);
  const updates = db.calls.filter((call) => call.op === "updateMessage" && call.patch.content);
  assert.deepEqual(
    updates.map((call) => call.patch.content).sort(),
    DEFAULT_COMPARE_MODELS.map((model) => `Answer from ${model}`).sort()
  );

  const billingOps = db.calls
    .filter((call) => call.op === "checkApiBudget" || call.op === "recordApiUsageCost")
    .map((call) => call.op);
  assert.deepEqual(billingOps, [
    "checkApiBudget", "checkApiBudget",
    "recordApiUsageCost", "recordApiUsageCost"
  ]);
});

/* ── (c) council through chairman synthesis ── */

test("council: panel, anonymized peer review, and chairman synthesis transcript", async (t) => {
  t.after(restoreFetch);
  const streamedBodies = [];
  installProviderFetch({
    streamFor: (body) => {
      streamedBodies.push(body);
      const isChairman = body.messages.some((message) =>
        typeof message.content === "string" && message.content.includes("You are the Chairman"));
      if (isChairman) return [contentDelta("Synthesized final answer."), usageChunk()];
      return [contentDelta(`Panel answer from ${body.model}`), usageChunk()];
    },
    completionFor: (body) => {
      /* Peer-review ballot: rank the nonce-tagged responses in prompt order. */
      const prompt = body.messages[0].content;
      const nonces = [...prompt.matchAll(/<response-([a-f0-9]{4,})>/g)].map((match) => match[1]);
      const ranking = nonces.map((nonce, i) => `${i + 1}. response-${nonce} — solid reasoning`).join("\n");
      return {
        choices: [{ message: { content: `RANKING:\n${ranking}` } }],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10, cost: 0.0005 }
      };
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Council question.", council: true, models: ["model-a", "model-b"], writingStyle: "formal", skillIds: ["humanizer"] }
  });

  assert.equal(res.statusCode, 200);
  const events = transcript(res);
  const types = events.map((event) => event.type);

  /* Stage 0: session announcement with the default 4-model panel. */
  assert.deepEqual(events[0], {
    type: "council:start",
    sessionId: "<id>",
    panel: DEFAULT_COUNCIL_MODELS,
    assistantMessageIds: ["<id>", "<id>", "<id>", "<id>"]
  });

  /* Stage 1: each panel lane streams start → delta(s) → done. */
  for (const [index, model] of DEFAULT_COUNCIL_MODELS.entries()) {
    const lane = events.filter((event) => event.index === index);
    assert.equal(lane[0].type, "start");
    assert.equal(lane[0].model, model);
    assert.equal(lane.at(-1).type, "done");
    const laneContent = lane
      .filter((event) => event.type === "delta")
      .map((event) => event.event.content)
      .join("");
    assert.equal(laneContent, `Panel answer from ${model}`);
  }

  /* Stage 2: peer review over all four reviewers, then aggregate. */
  const peerStart = events.find((event) => event.type === "council:peer:start");
  assert.deepEqual(peerStart.reviewers, DEFAULT_COUNCIL_MODELS);
  const ballots = events.filter((event) => event.type === "council:peer:ballot");
  assert.equal(ballots.length, 4);
  for (const ballot of ballots) {
    assert.equal(ballot.valid, true);
    assert.equal(ballot.ranking.length, 3, "each reviewer ranks the other three panelists");
    assert.equal(ballot.error, null);
  }
  const peerDone = events.find((event) => event.type === "council:peer:done");
  assert.deepEqual(
    peerDone.borda.map((row) => row.modelId).sort(),
    [...DEFAULT_COUNCIL_MODELS].sort()
  );
  for (const row of peerDone.borda) {
    assert.deepEqual(Object.keys(row).sort(), ["ballotCount", "bordaScore", "modelId", "rank"]);
  }

  /* Stage 3: chairman synthesis streams and completes. */
  const chairmanStart = events.find((event) => event.type === "council:chairman:start");
  assert.ok(DEFAULT_COUNCIL_MODELS.includes(chairmanStart.chairmanModel));
  assert.equal(chairmanStart.assistantMessageId, "<id>");
  assert.equal(chairmanStart.sessionId, "<id>");
  const chairmanContent = events
    .filter((event) => event.type === "council:chairman:delta")
    .map((event) => event.event.content)
    .join("");
  assert.equal(chairmanContent, "Synthesized final answer.");
  assert.equal(events.at(-1).type, "council:chairman:done");
  assert.equal(streamedBodies.length, 5, "four panelists and the chairman stream");
  assert.ok(streamedBodies.every((body) => /Writing style skill \(formal\)/.test(body.messages[0].content)));
  assert.ok(streamedBodies.every((body) => /<klui_composer_skill id="humanizer">/.test(body.messages[0].content)));
  assert.ok(streamedBodies.every((body) => !("skillIds" in body)));

  /* Stage ordering is frozen. */
  const order = [
    "council:start",
    "council:peer:start",
    "council:peer:done",
    "council:chairman:start",
    "council:chairman:done"
  ].map((type) => types.indexOf(type));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "council stages emit in order");
  assert.ok(types.indexOf("council:peer:start") > types.lastIndexOf("done"), "peer review starts after all panel lanes finish");

  /* Persistence: 4 panelist rows + 1 chairman row + peer metadata updates. */
  const assistantInserts = db.calls.filter((call) => call.op === "insertMessage" && call.message.role === "assistant");
  assert.equal(assistantInserts.length, 5);
  const chairmanInsert = assistantInserts.at(-1);
  assert.equal(chairmanInsert.message.metadata.council.role, "chairman");
  const peerMetadataUpdates = db.calls.filter((call) =>
    call.op === "updateMessage" && call.patch.metadata?.council?.peerReviewStatus);
  assert.equal(peerMetadataUpdates.length, 4);

  /* Billing: every model call (4 panel + 4 ballots + 1 chairman) is metered. */
  const checks = db.calls.filter((call) => call.op === "checkApiBudget").length;
  const records = db.calls.filter((call) => call.op === "recordApiUsageCost").length;
  assert.equal(checks, 9);
  assert.equal(records, 9);
});

/* ── (d) temporary chat ── */

test("temporary chat: transcript ends with usage and done(temporary), and nothing persists", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => [contentDelta("Ephemeral answer."), usageChunk()]
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "Hello", model: TEXT_MODEL, messages: [{ role: "user", content: "earlier" }] }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-klui-temporary-chat"], "1");
  assert.deepEqual(transcript(res), [
    { kind: "chunk", content: "Ephemeral answer.", finishReason: "stop" },
    { kind: "chunk", content: "", usage: "<usage>" },
    { type: "usage", usage: "<usage>" },
    { type: "done", temporary: true }
  ]);

  assert.equal(db.calls.filter((call) => call.op === "insertMessage").length, 0, "no message rows");
  assert.equal(db.calls.filter((call) => call.op === "updateMessage").length, 0);
  /* Billing still applies to temporary chats. */
  assert.deepEqual(
    db.calls.map((call) => call.op),
    ["checkApiBudget", "recordApiUsageCost", "responseEnd"]
  );
});

test("temporary chat sends an uploaded image without persisting it", async (t) => {
  t.after(restoreFetch);
  let providerBody = null;
  installProviderFetch({
    streamFor: (body) => {
      providerBody = body;
      return [contentDelta("I can see it."), usageChunk()];
    }
  });

  const attachment = {
    id: "00000000-0000-4000-8000-000000000301",
    category: "image",
    status: "uploaded",
    file_name: "photo.png",
    content_type: "image/png",
    size_bytes: 512,
    object_key: "users/user-1/photo.png"
  };
  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  db.getAttachment = async (_userId, id) => id === attachment.id ? attachment : null;
  const res = await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "What is in this image?", model: VISION_MODEL, attachments: [attachment.id] }
  });

  assert.equal(res.statusCode, 200);
  const userMessage = providerBody.messages.find((message) => message.role === "user");
  assert.equal(userMessage.content[1].image_url.url, "https://signed.example/users/user-1/photo.png");
  assert.equal(db.calls.some((call) => call.op === "insertMessage"), false);
  assert.deepEqual(db.calls.find((call) => call.op === "deleteObjects")?.keys, [attachment.object_key]);
  assert.equal(db.calls.some((call) => call.op === "deleteAttachment" && call.id === attachment.id), true);
});

test("temporary chat keeps document tools disabled and explains the limitation", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: (body) => {
      assert.equal(body.tools?.some((tool) => tool.function.name === "create_document"), false);
      assert.match(
        body.messages.find((message) => message.role === "system")?.content || "",
        /I can’t create documents in temporary chat\. I can only create documents in a normal chat\./
      );
      return [contentDelta("I can’t create documents in temporary chat. I can only create documents in a normal chat."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });

  const res = await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "Create a PDF report", model: TEXT_MODEL, agentMode: true }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.body, /I can’t create documents in temporary chat/);
  assert.equal(db.calls.some((call) => call.op === "insertMessage"), false);
});

test("writing styles reach normal and temporary provider prompts without leaking provider fields", async (t) => {
  t.after(restoreFetch);
  const requests = [];
  installProviderFetch({
    streamFor: (body) => {
      requests.push(body);
      return [contentDelta("Styled answer."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Be brief.", model: TEXT_MODEL, agentMode: false, writingStyle: "concise" }
  });
  await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "Write professionally.", model: TEXT_MODEL, writingStyle: "formal" }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /Writing style skill \(concise\)/);
  assert.match(requests[1].messages[0].content, /Writing style skill \(formal\)/);
  assert.equal("writingStyle" in requests[0], false);
  assert.equal("writingStyle" in requests[1], false);
});

test("composer skills reach normal and temporary prompts without leaking skillIds", async (t) => {
  t.after(restoreFetch);
  const requests = [];
  installProviderFetch({
    streamFor: (body) => {
      requests.push(body);
      return [contentDelta("Humanized answer."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: {
      text: "Rewrite this.",
      model: TEXT_MODEL,
      agentMode: false,
      skillIds: ["humanizer", "humanizer", "../../etc/passwd", "unknown"],
      skillMarks: [{ id: "humanizer", at: 8 }, { id: "unknown", at: 0 }]
    }
  });
  await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "Rewrite this too.", model: TEXT_MODEL, skillIds: ["humanizer"] }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.match(requests[1].messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.match(requests[1].messages[0].content, /Temporary chat cannot create/);
  assert.equal("skillIds" in requests[0], false);
  assert.equal("skillIds" in requests[1], false);
  const userInsert = db.calls.find((call) => call.op === "insertMessage" && call.message.role === "user");
  assert.deepEqual(userInsert.message.metadata.skillIds, ["humanizer"]);
  assert.deepEqual(userInsert.message.metadata.skillMarks, [{ id: "humanizer", at: 8 }]);
});

const ILLUSTRATION_ENV = {
  ...CONFIG_ENV,
  R2_ACCOUNT_ID: "acc",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "bucket"
};
const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("illustration turn plans, stores one image, and streams status plus result", async (t) => {
  t.after(restoreFetch);
  const imageRequests = [];
  const plannerRequests = [];
  installProviderFetch({
    streamFor: () => {
      throw new Error("illustration must not stream a chat completion");
    },
    completionFor: (body) => {
      plannerRequests.push(body);
      assert.match(body.messages.map((message) => message.content).join("\n"), /Explain the above/);
      assert.match(body.messages.map((message) => message.content).join("\n"), /Ingest, transform/);
      return {
        id: "plan-1",
        choices: [{
          message: {
            content: JSON.stringify({
              mode: "generate",
              reply: "One diagram of the earlier process.",
              images: [{ purpose: "Show the process", prompt: "A text-free Klui illustration of a pipeline." }]
            })
          }
        }],
        usage: { cost: 0.001 }
      };
    },
    imageFor: (body, options) => {
      imageRequests.push({ body, options });
      return {
        id: "img-1",
        data: [{ b64_json: MINI_PNG_B64, media_type: "image/png" }],
        usage: { cost: 0.015 }
      };
    }
  });

  const config = loadConfig(ILLUSTRATION_ENV);
  const db = makeDb({
    conversation: conversationRow,
    messages: [
      { id: "older-user", role: "user", content: "We should split the pipeline." },
      { id: "older-asst", role: "assistant", content: "Ingest, transform, and publish." }
    ]
  });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Explain the above as one digestible image.", model: TEXT_MODEL, agentMode: false, skillIds: ["illustration"] }
  });

  assert.equal(res.statusCode, 200, res.body);
  const events = parseSse(res.body);
  assert.equal(events[0].type, "illustration:status");
  assert.equal(events[0].label, "Planning illustration…");
  assert.ok(events.some((event) => event.type === "illustration:status" && event.label === "Generating illustration…"));
  const result = events.find((event) => event.type === "illustration:result");
  assert.ok(result);
  assert.equal(Array.isArray(result.content), true);
  assert.doesNotMatch(JSON.stringify(result.content), /Show the process|Ian Xiaohei/);
  assert.match(JSON.stringify(result.content), /signed\.example/);
  assert.doesNotMatch(res.body, /iVBORw0KGgo/);
  assert.ok(events.some((event) => event.type === "done"));
  assert.equal(plannerRequests[0].model, TEXT_MODEL);
  assert.equal(plannerRequests[0].max_tokens, 15_000);
  assert.equal(imageRequests.length, 1);
  assert.equal(imageRequests[0].body.model, "krea/krea-2-medium-turbo");
  assert.equal(imageRequests[0].body.n, undefined);
  assert.equal(imageRequests[0].body.aspect_ratio, "16:9");
  assert.equal(imageRequests[0].body.resolution, "1K");
  assert.equal(imageRequests[0].body.output_format, undefined);
  assert.match(imageRequests[0].options.headers.authorization, /Bearer or-key/);
  assert.doesNotMatch(imageRequests[0].body.prompt, /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/);
  assert.match(imageRequests[0].body.prompt, /English labels/i);
  assert.match(imageRequests[0].body.prompt, /No watermark/i);
  assert.match(imageRequests[0].body.prompt, /No Chinese characters/i);
  assert.ok(db.calls.some((call) => call.op === "createAttachment"));
  assert.ok(db.calls.some((call) => call.op === "putObject"));
  assert.ok(
    db.calls.findIndex((call) => call.op === "recordApiUsageCost" && call.payload.model === "krea/krea-2-medium-turbo")
      > db.calls.findIndex((call) => call.op === "completeAttachment"),
    "image usage should settle only after the generated attachment is durable"
  );
  const assistantUpdate = db.calls.find((call) => call.op === "updateMessage" && call.patch?.content);
  assert.equal(assistantUpdate.patch.metadata.illustration.completed, 1);
  assert.doesNotMatch(JSON.stringify(assistantUpdate.patch.metadata), /Klui illustration of a pipeline/);
  const costs = db.calls.filter((call) => call.op === "recordApiUsageCost").map((call) => call.payload);
  assert.ok(costs.some((payload) => payload.model === TEXT_MODEL));
  assert.ok(costs.some((payload) => payload.model === "krea/krea-2-medium-turbo" && payload.costCredits === 0.015));
});

test("illustration plan-only and unsupported modes never call the Image API", async (t) => {
  t.after(restoreFetch);
  let images = 0;
  installProviderFetch({
    streamFor: () => {
      throw new Error("plan-only illustration must not stream chat");
    },
    completionFor: () => ({
      id: "plan-2",
      choices: [{
        message: {
          content: JSON.stringify({
            mode: "plan",
            reply: "Suggested shots.",
            images: [{ purpose: "The first idea", prompt: "Klui holds a list" }]
          })
        }
      }],
      usage: { cost: 0.001 }
    }),
    imageFor: () => {
      images += 1;
      throw new Error("plan-only must not generate");
    }
  });

  const config = loadConfig(ILLUSTRATION_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Give me a shot list only. Do not generate yet.", model: TEXT_MODEL, agentMode: false, skillIds: ["illustration"] }
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(images, 0);
  assert.match(res.body, /No image was generated/);
  assert.equal(db.calls.some((call) => call.op === "createAttachment"), false);

  const compare = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Draw this.", models: ["model-a", "model-b"], skillIds: ["illustration"] }
  });
  assert.equal(compare.statusCode, 400);
  assert.match(compare.body, /standard chat/);

  const temp = await dispatchChat(config, db, {
    path: "/api/temporary-chat",
    body: { text: "Draw this.", model: TEXT_MODEL, skillIds: ["illustration"] }
  });
  assert.equal(temp.statusCode, 400);
  assert.match(temp.body, /standard chat/);
  assert.equal(images, 0);
});

test("editing an illustration request is rejected before downstream messages are purged", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => {
      throw new Error("an illustration edit must not reach the provider");
    },
    completionFor: () => {
      throw new Error("an illustration edit must not reach the provider");
    },
    imageFor: () => {
      throw new Error("an illustration edit must not reach the provider");
    }
  });
  const history = [
    {
      id: "user-illustration",
      role: "user",
      content: "Explain queues.",
      metadata: { skillIds: ["illustration"], skillMarks: [{ id: "illustration", at: 0 }] }
    },
    {
      id: "assistant-illustration",
      role: "assistant",
      content: "Existing illustration.",
      finish_reason: "stop"
    }
  ];
  const config = loadConfig(ILLUSTRATION_ENV);
  const db = makeDb({ conversation: conversationRow, messages: history });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: {
      editUserMessageId: "user-illustration",
      text: "Explain stacks instead.",
      model: TEXT_MODEL
    }
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body, /cannot be edited/i);
  assert.equal(db.calls.some((call) => call.op === "deleteMessage"), false);
  assert.equal(db.calls.some((call) => call.op === "updateMessage"), false);
});

/* ── retry and edit modes ── */

test("retry: deletes failed assistant, reuses user message, streams fresh assistant", async (t) => {
  t.after(restoreFetch);
  let providerRequest = null;
  installProviderFetch({
    streamFor: (body) => {
      providerRequest = body;
      return [contentDelta("Retried answer."), usageChunk()];
    }
  });

  const history = [
    { id: "user-1", role: "user", content: "Original question?", metadata: { skillIds: ["humanizer"] } },
    {
      id: "asst-2",
      role: "assistant",
      content: "",
      error: "Model request failed.",
      finish_reason: "error"
    }
  ];

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, messages: history });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { retryAssistantMessageId: "asst-2", model: TEXT_MODEL }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-klui-user-message-id"], "user-1");
  assert.equal(res.headers["x-klui-assistant-message-id"], "msg-1");

  assert.deepEqual(transcript(res), [
    { kind: "chunk", content: "Retried answer.", finishReason: "stop" },
    { kind: "chunk", content: "", usage: "<usage>" },
    { type: "usage", usage: "<usage>" }
  ]);

  const deletes = db.calls.filter((call) => call.op === "deleteMessage");
  assert.deepEqual(deletes.map((call) => call.id), ["asst-2"]);

  const inserts = db.calls.filter((call) => call.op === "insertMessage");
  assert.deepEqual(inserts.map((call) => call.message.role), ["assistant"]);
  assert.equal(inserts[0].message.model, TEXT_MODEL);

  const finalUpdate = db.calls.filter((call) => call.op === "updateMessage").at(-1);
  assert.equal(finalUpdate.id, "msg-1");
  assert.equal(finalUpdate.patch.content, "Retried answer.");
  assert.equal(finalUpdate.patch.finish_reason, "stop");
  assert.match(providerRequest.messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.equal("skillIds" in providerRequest, false);
});

test("longer retry rewrites the existing answer without adding a user message", async (t) => {
  t.after(restoreFetch);
  let providerRequest = null;
  installProviderFetch({
    streamFor: (body) => {
      providerRequest = body;
      return [contentDelta("A longer answer."), usageChunk()];
    }
  });

  const history = [
    { id: "user-1", role: "user", content: "Explain this.", metadata: { skillIds: ["humanizer"] } },
    { id: "asst-2", role: "assistant", content: "Short answer.", finish_reason: "stop" }
  ];
  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, messages: history });
  await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { retryAssistantMessageId: "asst-2", responseAdjustment: "longer", model: TEXT_MODEL }
  });

  assert.match(providerRequest.messages[0].content, /substantially longer/);
  assert.match(providerRequest.messages[0].content, /<previous_response>\nShort answer\./);
  assert.match(providerRequest.messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.equal("skillIds" in providerRequest, false);
  assert.equal(db.calls.filter((call) => call.op === "insertMessage" && call.message.role === "user").length, 0);
  assert.deepEqual(db.calls.filter((call) => call.op === "deleteMessage").map((call) => call.id), ["asst-2"]);
});

test("edit: rewrites user text, purges downstream messages, streams new assistant", async (t) => {
  t.after(restoreFetch);
  let providerRequest = null;
  installProviderFetch({
    streamFor: (body) => {
      providerRequest = body;
      return [contentDelta("Answer to edited prompt."), usageChunk()];
    }
  });

  const history = [
    { id: "user-1", role: "user", content: "First question" },
    { id: "asst-2", role: "assistant", content: "First answer", finish_reason: "stop" },
    { id: "user-3", role: "user", content: "Follow up question", metadata: { skillIds: ["humanizer"] } },
    { id: "asst-4", role: "assistant", content: "Follow up answer", finish_reason: "stop" }
  ];

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, messages: history });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { editUserMessageId: "user-3", text: "Edited follow up?", model: TEXT_MODEL, skillIds: ["unknown"] }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-klui-user-message-id"], "user-3");
  assert.equal(res.headers["x-klui-assistant-message-id"], "msg-1");

  assert.deepEqual(transcript(res), [
    { kind: "chunk", content: "Answer to edited prompt.", finishReason: "stop" },
    { kind: "chunk", content: "", usage: "<usage>" },
    { type: "usage", usage: "<usage>" }
  ]);

  const deletes = db.calls.filter((call) => call.op === "deleteMessage");
  assert.deepEqual(deletes.map((call) => call.id), ["asst-4"]);

  const userUpdates = db.calls.filter((call) => call.op === "updateMessage" && call.id === "user-3");
  assert.equal(userUpdates.length, 1);
  assert.equal(userUpdates[0].patch.content, "Edited follow up?");
  assert.equal("metadata" in userUpdates[0].patch, false);
  assert.match(providerRequest.messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.equal("skillIds" in providerRequest, false);

  const inserts = db.calls.filter((call) => call.op === "insertMessage");
  assert.deepEqual(inserts.map((call) => call.message.role), ["assistant"]);

  const assistantUpdate = db.calls.filter((call) =>
    call.op === "updateMessage" && call.patch.content === "Answer to edited prompt.");
  assert.equal(assistantUpdate.length, 1);
  assert.equal(assistantUpdate[0].id, "msg-1");
});

/* ── (e) errors, aborts, usage/cost ── */

test("empty provider response after headers surfaces as an SSE error event and error persistence", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => [usageChunk({ cost: 0 })]
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Hi", model: TEXT_MODEL }
  });

  assert.equal(res.statusCode, 200, "headers were already sent as SSE");
  const events = transcript(res);
  assert.deepEqual(events.at(-1), { type: "error", error: "Klui returned an empty response." });
  assert.equal(res.writableEnded, true);

  const errorUpdate = db.calls.filter((call) => call.op === "updateMessage").at(-1);
  assert.equal(errorUpdate.patch.error, "Klui returned an empty response.");
  assert.equal(errorUpdate.patch.finish_reason, "error");
});

test("client disconnect aborts the stream and persists 'Stopped by user.'", async (t) => {
  t.after(restoreFetch);
  let abortStream = null;
  installProviderFetch({
    streamFor: (body, options) => sseStreamResponse([contentDelta("partial")], {
      hang: true,
      signalHook: (errorStream) => {
        abortStream = errorStream;
        options.signal?.addEventListener("abort", errorStream);
      }
    })
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const req = makeReq({
    path: "/api/conversations/conv-1/messages",
    body: { text: "Hi", model: TEXT_MODEL }
  });
  const res = makeRes();
  const handler = createApiHandler(config, overridesFor(db));
  const pending = handler(req, res, new URL("/api/conversations/conv-1/messages", "http://test.local"));

  /* Wait for the stream to open, then simulate the client going away. */
  while (!res.body.includes("partial")) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  res.emitClose();
  if (abortStream) abortStream();
  await pending;

  const errorUpdate = db.calls.filter((call) => call.op === "updateMessage").at(-1);
  assert.equal(errorUpdate.patch.error, "Stopped by user.");
  assert.equal(errorUpdate.patch.finish_reason, "error");
  assert.equal(errorUpdate.patch.content, "partial");
  assert.equal(errorUpdate.patch.reasoning, "");
});

test("compare: provider requests include prior conversation history", async (t) => {
  t.after(restoreFetch);
  const providerBodies = [];
  installProviderFetch({
    streamFor: (body) => {
      providerBodies.push(body);
      return [contentDelta(`Answer from ${body.model}`), usageChunk()];
    }
  });

  const prior = [
    { id: "msg-prior-user", role: "user", content: "Earlier question", conversation_id: "conv-1" },
    { id: "msg-prior-asst", role: "assistant", content: "Earlier answer", conversation_id: "conv-1", model: TEXT_MODEL }
  ];
  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, messages: prior });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Compare follow-up.", models: ["model-a", "model-b"] }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(providerBodies.length, DEFAULT_COMPARE_MODELS.length);
  for (const body of providerBodies) {
    const roles = body.messages.map((message) => message.role);
    assert.ok(roles.includes("user"), "compare request includes user turns");
    assert.ok(roles.includes("assistant"), "compare request includes prior assistant turns");
    const texts = body.messages.map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content)
    );
    assert.ok(texts.some((text) => text.includes("Earlier question")), "prior user message is in context");
    assert.ok(texts.some((text) => text.includes("Earlier answer")), "prior assistant message is in context");
    assert.ok(texts.some((text) => text.includes("Compare follow-up.")), "new user turn is in context");
  }
});

test("project knowledge cannot be rebound to an individual chat message", async () => {
  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const attachmentId = "00000000-0000-4000-8000-000000000202";
  db.getAttachment = async (_userId, id) => id === attachmentId ? {
    id,
    project_id: "00000000-0000-4000-8000-000000000201",
    category: "image",
    status: "uploaded",
    file_name: "shared.png",
    content_type: "image/png",
    size_bytes: 100
  } : null;

  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Use the shared source", model: TEXT_MODEL, attachments: [attachmentId] }
  });

  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /Project knowledge is already available/);
  assert.equal(db.calls.some((call) => call.op === "updateAttachment"), false);
});

test("client-keyed send persists one durable turn and fences the first provider call", async (t) => {
  t.after(restoreFetch);
  let providerRequest = null;
  installProviderFetch({
    streamFor: (body) => {
      providerRequest = body;
      return [contentDelta("The document says hello."), usageChunk()];
    }
  });

  const config = loadConfig(CONFIG_ENV);
  const storedMessages = [];
  const turnId = "00000000-0000-4000-8000-000000000101";
  const attachment = {
    id: "00000000-0000-4000-8000-000000000102",
    category: "document",
    status: "uploaded",
    file_name: "notes.docx",
    content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 512,
    object_key: "users/user-1/notes.docx"
  };
  const documentFile = {
    id: "00000000-0000-4000-8000-000000000103",
    attachment_id: attachment.id,
    conversation_id: "conv-1",
    kind: "docx",
    processing_status: "processing",
    text_ready_at: "2026-07-11T00:00:00.000Z",
    metadata: { stage: "text_ready", progress: 100 }
  };
  let run = null;

  const db = makeDb({ conversation: conversationRow });
  const calls = db.calls;
  db.upsertProfile = async (user) => {
    calls.push({ op: "upsertProfile" });
    return { id: user.id, role: "user" };
  };
  db.listMessages = async () => storedMessages.map((message) => ({ ...message }));
  db.getAttachment = async (_userId, attachmentId) => attachmentId === attachment.id ? attachment : null;
  db.getDocumentFileByAttachment = async () => documentFile;
  db.listDocumentFilesByAttachments = async () => [documentFile];
  db.submitDocumentTurn = async (payload) => {
    calls.push({ op: "submitDocumentTurn", payload });
    const userMessage = {
      id: "msg-document-user",
      user_id: "user-1",
      conversation_id: "conv-1",
      role: "user",
      content: payload.userContent,
      metadata: payload.messageMetadata
    };
    storedMessages.push(userMessage);
    run = {
      id: turnId,
      user_id: "user-1",
      conversation_id: "conv-1",
      user_message_id: userMessage.id,
      mode: "single",
      request_payload: payload.requestPayload,
      status: "waiting_documents",
      provider_started_at: null
    };
    return { run, user_message: userMessage, created: true };
  };
  db.claimPendingDocumentTurn = async ({ claimedBy }) => {
    run = {
      ...run,
      status: "running",
      claimed_by: claimedBy,
      claim_token: "00000000-0000-4000-8000-000000000104",
      lease_until: futureIso(120_000)
    };
    calls.push({ op: "claimPendingDocumentTurn" });
    return run;
  };
  db.heartbeatPendingDocumentTurn = async () => run;
  db.markPendingTurnProviderStarted = async () => {
    run = { ...run, provider_started_at: new Date().toISOString() };
    calls.push({ op: "markPendingTurnProviderStarted" });
    return run;
  };
  db.finishPendingDocumentTurn = async ({ status }) => {
    run = { ...run, status };
    calls.push({ op: "finishPendingDocumentTurn", status });
    return run;
  };
  db.upsertTurnOutputMessage = async (row) => {
    const message = { id: "msg-document-assistant", ...row };
    storedMessages.push(message);
    calls.push({ op: "upsertTurnOutputMessage", row });
    return message;
  };

  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: {
      text: "Say hello",
      model: TEXT_MODEL,
      attachments: [],
      writingStyle: "learning",
      skillIds: ["humanizer", "../../etc/passwd"],
      clientTurnKey: "00000000-0000-4000-8000-000000000105"
    }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["x-klui-turn-run-id"], turnId);
  assert.equal(res.headers["x-klui-user-message-id"], "msg-document-user");
  assert.equal(res.headers["x-klui-assistant-message-id"], undefined);
  assert.equal(calls.filter((call) => call.op === "submitDocumentTurn").length, 1);
  assert.equal(calls.find((call) => call.op === "submitDocumentTurn").payload.requestPayload.writingStyle, "learning");
  assert.deepEqual(calls.find((call) => call.op === "submitDocumentTurn").payload.requestPayload.skillIds, ["humanizer"]);
  assert.deepEqual(calls.find((call) => call.op === "submitDocumentTurn").payload.messageMetadata.skillIds, ["humanizer"]);
  assert.match(providerRequest.messages[0].content, /<klui_composer_skill id="humanizer">/);
  assert.equal("skillIds" in providerRequest, false);
  assert.deepEqual(calls.find((call) => call.op === "submitDocumentTurn").payload.attachmentIds, []);
  assert.equal(calls.filter((call) => call.op === "upsertProfile").length, 2);
  assert.ok(
    calls.findLastIndex((call) => call.op === "upsertProfile")
      > calls.findIndex((call) => call.op === "claimPendingDocumentTurn"),
    "auth and entitlement are refreshed after the durable turn is claimed"
  );
  assert.equal(calls.filter((call) => call.op === "upsertTurnOutputMessage").length, 1);
  assert.equal(calls.filter((call) => call.op === "updatePendingTurnOutput").length, 1);
  assert.equal(calls.some((call) => call.op === "insertMessage"), false);
  assert.ok(
    calls.findIndex((call) => call.op === "responseStart")
      < calls.findIndex((call) => call.op === "claimPendingDocumentTurn"),
    "the durable turn ID is returned before document wait/claim work"
  );
  assert.ok(
    calls.findIndex((call) => call.op === "checkApiBudget")
      < calls.findIndex((call) => call.op === "markPendingTurnProviderStarted"),
    "the budget gate runs before the durable provider fence"
  );
  assert.ok(
    calls.findIndex((call) => call.op === "markPendingTurnProviderStarted")
      < calls.findIndex((call) => call.op === "recordApiUsageCost"),
    "the durable provider fence is written before provider usage is recorded"
  );
  assert.equal(calls.at(-2).op, "finishPendingDocumentTurn");
  assert.equal(calls.at(-2).status, "done");
  assert.equal(calls.at(-1).op, "responseEnd");
});
