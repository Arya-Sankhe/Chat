import assert from "node:assert/strict";
import test, { describe, before, after } from "node:test";

import { SearchCache, hashKey } from "../server/websearch/cache.js";
import { buildSearchSystemHint, detectSearchNeed, extractUrls } from "../server/websearch/detect.js";
import { WebSearchOrchestrator, formatResultsForModel } from "../server/websearch/index.js";
import { buildWebSearchTools, executeToolCall, runChatWithToolLoop } from "../server/websearch/tool.js";

const realFetch = globalThis.fetch;

function installFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

const baseConfig = {
  defaultMode: "auto",
  primaryProvider: "jina",
  maxResults: 5,
  pageContentChars: 1000,
  totalContextChars: 4000,
  cacheTtlSeconds: 60,
  cacheMaxEntries: 100,
  fetchTimeoutMs: 5000,
  maxToolCallsPerTurn: 3,
  denyDomains: [],
  dailyLimits: { pro: 100 },
  jina: { apiKey: "test-jina-key", backend: "google", engine: "direct" },
  brave: { apiKey: "test-brave-key" }
};

describe("detect", () => {
  test("extractUrls strips trailing punctuation", () => {
    assert.deepEqual(
      extractUrls("See https://example.com/foo, https://other.org/bar."),
      ["https://example.com/foo", "https://other.org/bar"]
    );
  });

  test("detectSearchNeed picks up time-sensitive triggers", () => {
    const detection = detectSearchNeed("What happened in the news today?");
    assert.ok(detection.score >= 2);
    assert.ok(detection.reasons.includes("time-sensitive"));
    assert.ok(detection.reasons.includes("live-data-topic"));
  });

  test("detectSearchNeed ignores stable knowledge questions", () => {
    const detection = detectSearchNeed("What is the capital of France?");
    assert.equal(detection.score, 0);
    assert.equal(detection.hasUrls, false);
  });

  test("buildSearchSystemHint emits the URL-specific hint", () => {
    const detection = detectSearchNeed("Read https://example.com/article please");
    const hint = buildSearchSystemHint(detection);
    assert.match(hint, /URLs/);
    assert.match(hint, /read_url/);
  });
});

describe("cache", () => {
  test("LRU returns null on miss and value on hit", async () => {
    const cache = new SearchCache({ maxEntries: 2, ttlMs: 5000 });
    const key = hashKey({ query: "abc" });
    assert.equal(await cache.get(key), null);
    await cache.set(key, { value: 1 });
    assert.deepEqual(await cache.get(key), { value: 1 });
  });

  test("LRU evicts oldest entry past maxEntries", async () => {
    const cache = new SearchCache({ maxEntries: 2, ttlMs: 5000 });
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    assert.equal(await cache.get("a"), null);
    assert.equal(await cache.get("b"), 2);
    assert.equal(await cache.get("c"), 3);
  });

  test("LRU expires entries past TTL", async () => {
    const cache = new SearchCache({ maxEntries: 5, ttlMs: 5 });
    await cache.set("x", "y");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await cache.get("x"), null);
  });

  test("persistent backend feeds the LRU on cold start", async () => {
    let storedRow = null;
    const persistent = {
      async get() {
        return storedRow;
      },
      async set(row) {
        storedRow = row;
      }
    };
    const cache = new SearchCache({ maxEntries: 5, ttlMs: 60_000, persistent });
    const key = hashKey({ q: "hello" });
    await cache.set(key, { hello: "world" }, { query: "hello", provider: "test" });
    cache.clear();
    /* LRU is empty, so this read must come from the persistent layer. */
    storedRow = {
      ...storedRow,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      results: { hello: "world" }
    };
    assert.deepEqual(await cache.get(key), { hello: "world" });
  });
});

describe("WebSearchOrchestrator", () => {
  after(() => restoreFetch());

  test("Jina search success returns normalized results", async () => {
    installFetch(async () => jsonResponse({
      data: [
        { url: "https://a.example/1", title: "Result A", description: "snippet A", content: "page content A" },
        { url: "https://b.example/2", title: "Result B", description: "snippet B", content: "page content B" }
      ]
    }));
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const result = await orchestrator.search({ query: "latest ai news" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "jina");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].title, "Result A");
    assert.equal(result.results[0].content, "page content A");
  });

  test("cache short-circuits a repeat query without calling fetch", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return jsonResponse({ data: [{ url: "https://a.example/1", title: "A", content: "x" }] });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const first = await orchestrator.search({ query: "duplicate query" });
    const second = await orchestrator.search({ query: "duplicate query" });
    assert.equal(first.ok, true);
    assert.equal(second.cached, true);
    assert.equal(calls, 1);
  });

  test("falls back to Brave when Jina returns 5xx", async () => {
    let stage = "jina";
    installFetch(async (url) => {
      if (String(url).includes("s.jina.ai")) {
        return new Response("upstream busy", { status: 502 });
      }
      stage = "brave";
      return jsonResponse({
        results: [{ url: "https://b.example/1", title: "Brave A", description: "brave snippet" }]
      });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const result = await orchestrator.search({ query: "anything" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
    assert.equal(stage, "brave");
    assert.equal(result.results[0].title, "Brave A");
  });

  test("beforeNetwork hook blocks the call when it throws", async () => {
    installFetch(async () => {
      throw new Error("should not have been called");
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    orchestrator.beforeNetwork = async () => {
      const err = new Error("quota exceeded");
      err.status = 429;
      throw err;
    };
    const result = await orchestrator.search({ query: "blocked" });
    assert.equal(result.ok, false);
    assert.equal(result.error.provider, "quota");
    assert.equal(result.error.status, 429);
  });

  test("circuit breaker flips to fallback after consecutive 5xx", async () => {
    let jinaCalls = 0;
    installFetch(async (url) => {
      if (String(url).includes("s.jina.ai")) {
        jinaCalls += 1;
        return new Response("err", { status: 500 });
      }
      return jsonResponse({ results: [{ url: "https://x", title: "B", description: "" }] });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    for (let i = 0; i < 3; i++) {
      const r = await orchestrator.search({ query: `q${i}` });
      assert.equal(r.ok, true);
      assert.equal(r.provider, "brave");
    }
    /* After 3 jina failures the breaker should keep jina skipped */
    const r = await orchestrator.search({ query: "after cooldown" });
    assert.equal(r.provider, "brave");
    assert.equal(jinaCalls, 3);
  });

  test("formatResultsForModel renders all required fields", () => {
    const text = formatResultsForModel([
      { index: 1, title: "T", url: "https://u", snippet: "s", content: "c", publishedAt: null }
    ]);
    assert.match(text, /\[1] T/);
    assert.match(text, /URL: https:\/\/u/);
    assert.match(text, /Snippet: s/);
    assert.match(text, /Content:\nc/);
  });
});

describe("tool", () => {
  test("buildWebSearchTools exposes web_search and read_url", () => {
    const tools = buildWebSearchTools({ maxResults: 5 });
    assert.equal(tools.length, 2);
    assert.equal(tools[0].function.name, "web_search");
    assert.equal(tools[1].function.name, "read_url");
  });

  test("executeToolCall returns error JSON when args are malformed", async () => {
    const result = await executeToolCall({
      toolCall: { function: { name: "web_search", arguments: "not-json" } },
      websearch: { search: async () => ({ ok: true }) }
    });
    assert.equal(result.ok, false);
    assert.match(result.toolResultJson, /not valid JSON/);
  });

  test("executeToolCall passes a clean search through", async () => {
    const websearch = {
      search: async () => ({
        ok: true,
        provider: "jina",
        cached: false,
        results: [
          { index: 1, title: "T", url: "https://u", snippet: "s", content: "c", publishedAt: null }
        ]
      })
    };
    const result = await executeToolCall({
      toolCall: { function: { name: "web_search", arguments: JSON.stringify({ query: "abc" }) } },
      websearch
    });
    assert.equal(result.ok, true);
    assert.equal(result.citations.length, 1);
    const parsed = JSON.parse(result.toolResultJson);
    assert.equal(parsed.results[0].url, "https://u");
  });

  test("runChatWithToolLoop completes when model finishes without tool call", async () => {
    const crofai = {
      async streamChatCompletion() {
        return {
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode("data: " + JSON.stringify({
                choices: [{ delta: { content: "Hi" }, finish_reason: "stop" }]
              }) + "\n\n"));
              controller.close();
            }
          })
        };
      }
    };
    const result = await runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "ping" }] },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 3 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      onUpstreamEvent: () => {}
    });
    assert.equal(result.accumulated.content, "Hi");
    assert.equal(result.toolCallCount, 0);
  });
});
