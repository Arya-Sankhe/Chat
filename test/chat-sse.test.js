import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { loadConfig } from "../server/config.js";
import { createApiHandler } from "../server/routes.js";

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

const TEXT_MODEL = "deepseek/deepseek-v4-flash";
const VISION_MODEL = "xiaomi/mimo-v2.5";
const DEFAULT_COMPARE_MODELS = [TEXT_MODEL, VISION_MODEL];
const DEFAULT_COUNCIL_MODELS = [TEXT_MODEL, "deepseek/deepseek-v4-pro", VISION_MODEL, "xiaomi/mimo-v2.5-pro"];

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

function makeRes() {
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
function installProviderFetch({ streamFor, completionFor = null }) {
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/models")) return jsonResponse({ data: [] });
    if (href.includes("/generation")) return jsonResponse({ data: { total_cost: 0.001 } });
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

function makeDb({ conversation, cachedSearch = null } = {}) {
  const calls = [];
  let counter = 0;
  const db = {
    calls,
    async upsertProfile(user) { return { id: user.id, role: "user" }; },
    async getConversation() { return conversation; },
    async listMessages() { return []; },
    async getAppSetting() { return null; },
    async getResearchRun() { return null; },
    async getModelCache() { return null; },
    async upsertModelCache() { return {}; },
    async getSearchCache() { return cachedSearch; },
    async upsertSearchCache() { return {}; },
    async updateAttachment() { return {}; },
    async checkApiBudget(payload) {
      calls.push({ op: "checkApiBudget", payload });
      return { allowed: true };
    },
    async recordApiUsageCost(payload) {
      calls.push({ op: "recordApiUsageCost", payload });
      return {};
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
    createR2: () => ({}),
    verifyUser: async () => ({ id: "user-1", email: "user@example.com", raw: {} })
  };
}

async function dispatchChat(config, db, { path, body }) {
  const req = makeReq({ path, body });
  const res = makeRes();
  await createApiHandler(config, overridesFor(db))(req, res, new URL(path, "http://test.local"));
  return res;
}

const conversationRow = { id: "conv-1", title: "Existing chat", model: TEXT_MODEL };

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

  assert.equal(res.statusCode, 200);
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

/* ── (b) two-model compare ── */

test("compare: server substitutes the default pair and streams per-index start/delta/done", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: (body) => [contentDelta(`Answer from ${body.model}`), usageChunk()]
  });

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { text: "Compare this.", models: ["model-a", "model-b"] }
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
  installProviderFetch({
    streamFor: (body) => {
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
    body: { text: "Council question.", council: true, models: ["model-a", "model-b"] }
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
    ["checkApiBudget", "recordApiUsageCost"]
  );
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
});
