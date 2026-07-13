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
      readUrl(key) { return `https://signed.example/${key}`; }
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
    ["checkApiBudget", "recordApiUsageCost", "responseEnd"]
  );
});

/* ── retry and edit modes ── */

test("retry: deletes failed assistant, reuses user message, streams fresh assistant", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => [contentDelta("Retried answer."), usageChunk()]
  });

  const history = [
    { id: "user-1", role: "user", content: "Original question?" },
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
});

test("edit: rewrites user text, purges downstream messages, streams new assistant", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => [contentDelta("Answer to edited prompt."), usageChunk()]
  });

  const history = [
    { id: "user-1", role: "user", content: "First question" },
    { id: "asst-2", role: "assistant", content: "First answer", finish_reason: "stop" },
    { id: "user-3", role: "user", content: "Follow up question" },
    { id: "asst-4", role: "assistant", content: "Follow up answer", finish_reason: "stop" }
  ];

  const config = loadConfig(CONFIG_ENV);
  const db = makeDb({ conversation: conversationRow, messages: history });
  const res = await dispatchChat(config, db, {
    path: "/api/conversations/conv-1/messages",
    body: { editUserMessageId: "user-3", text: "Edited follow up?", model: TEXT_MODEL }
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

test("client-keyed send persists one durable turn and fences the first provider call", async (t) => {
  t.after(restoreFetch);
  installProviderFetch({
    streamFor: () => [contentDelta("The document says hello."), usageChunk()]
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
      clientTurnKey: "00000000-0000-4000-8000-000000000105"
    }
  });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["x-klui-turn-run-id"], turnId);
  assert.equal(res.headers["x-klui-user-message-id"], "msg-document-user");
  assert.equal(res.headers["x-klui-assistant-message-id"], undefined);
  assert.equal(calls.filter((call) => call.op === "submitDocumentTurn").length, 1);
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
