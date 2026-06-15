import assert from "node:assert/strict";
import test, { describe, before, after } from "node:test";

import { SearchCache, hashKey } from "../server/websearch/cache.js";
import { buildSearchSystemHint, detectSearchNeed, extractUrls } from "../server/websearch/detect.js";
import { WebSearchOrchestrator, formatResultsForModel } from "../server/websearch/index.js";
import { buildWebSearchTools, executeToolCall, isToolsUnsupportedError, runChatWithToolLoop } from "../server/websearch/tool.js";
import { buildDocumentTools } from "../server/documents/tool.js";
import { loadConfig } from "../server/config.js";

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

function streamResponse(events) {
  return {
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      }
    })
  };
}

function toolCallDelta({ id = "call_1", name = "web_search", args = { query: "latest ai news" }, index = 0 } = {}) {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index,
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) }
        }]
      },
      finish_reason: "tool_calls"
    }]
  };
}

function contentDelta(content) {
  return {
    choices: [{ delta: { content }, finish_reason: "stop" }]
  };
}

function latestUserTextFromBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n");
    }
  }
  return "";
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
  searxng: { baseUrl: "http://searxng:8080", engines: ["duckduckgo", "bing"] },
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

  test("config defaults to SearXNG search with internal Docker URL", () => {
    const config = loadConfig({});
    assert.equal(config.websearch.primaryProvider, "searxng");
    assert.equal(config.websearch.searxng.baseUrl, "http://searxng:8080");
    assert.deepEqual(config.websearch.searxng.engines, ["duckduckgo", "bing"]);
  });

  test("SearXNG search success returns normalized snippet-only results", async () => {
    let capturedUrl;
    let capturedOptions;
    installFetch(async (url, options) => {
      capturedUrl = new URL(String(url));
      capturedOptions = options;
      return jsonResponse({
        results: [
          {
            url: "https://example.com/news",
            title: "Example News",
            content: "A relevant search snippet.",
            publishedDate: "2026-06-01"
          },
          {
            url: "https://example.com/news",
            title: "Duplicate",
            content: "duplicate"
          },
          {
            url: "https://example.org/other",
            title: "Other Result",
            content: "Another snippet."
          }
        ]
      });
    });

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "latest ai news", freshness: "week" });

    assert.equal(result.ok, true);
    assert.equal(result.provider, "searxng");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].title, "Example News");
    assert.equal(result.results[0].snippet, "A relevant search snippet.");
    assert.equal(result.results[0].content, "");
    assert.equal(result.results[0].publishedAt, "2026-06-01");
    assert.equal(capturedUrl.origin, "http://searxng:8080");
    assert.equal(capturedUrl.pathname, "/search");
    assert.equal(capturedUrl.searchParams.get("format"), "json");
    assert.equal(capturedUrl.searchParams.get("engines"), "duckduckgo,bing");
    assert.equal(capturedUrl.searchParams.get("time_range"), "week");
    assert.equal(capturedOptions.headers["x-forwarded-for"], "127.0.0.1");
    assert.equal(capturedOptions.headers["x-real-ip"], "127.0.0.1");
  });

  test("Jina search success returns normalized results", async () => {
    let capturedUrl;
    let capturedOptions;
    installFetch(async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return jsonResponse({
        data: [
          { url: "https://a.example/1", title: "Result A", description: "snippet A", content: "page content A" },
          { url: "https://b.example/2", title: "Result B", description: "snippet B", content: "page content B" }
        ]
      });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const result = await orchestrator.search({ query: "latest ai news" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "jina");
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].title, "Result A");
    assert.equal(result.results[0].content, "page content A");
    assert.equal(capturedUrl, "https://s.jina.ai/search");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(capturedOptions.headers["x-respond-with"], "markdown");
    assert.equal(JSON.parse(capturedOptions.body).q, "latest ai news");
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
        grounding: {
          generic: [{ url: "https://b.example/1", title: "Brave A", snippets: ["brave snippet"] }],
          map: []
        },
        sources: { "https://b.example/1": { title: "Brave A", hostname: "b.example", age: ["Friday", "2026-05-22"] } }
      });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const result = await orchestrator.search({ query: "anything" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
    assert.equal(stage, "brave");
    assert.equal(result.results[0].title, "Brave A");
    assert.equal(result.results[0].publishedAt, "2026-05-22");
  });

  test("falls back from SearXNG to Jina when SearXNG fails", async () => {
    let stage = "searxng";
    installFetch(async (url) => {
      if (String(url).includes("searxng:8080")) {
        return new Response("upstream busy", { status: 502 });
      }
      stage = "jina";
      return jsonResponse({
        data: [{ url: "https://j.example/1", title: "Jina A", description: "jina snippet", content: "jina content" }]
      });
    });

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "anything" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "jina");
    assert.equal(stage, "jina");
    assert.equal(result.results[0].content, "jina content");
  });

  test("SearXNG 403 surfaces a JSON-format configuration error", async () => {
    installFetch(async () => new Response("json disabled", { status: 403 }));
    const config = {
      ...baseConfig,
      primaryProvider: "searxng",
      jina: { ...baseConfig.jina, apiKey: "" },
      brave: { apiKey: "" }
    };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "json disabled" });
    assert.equal(result.ok, false);
    assert.equal(result.error.provider, "searxng");
    assert.equal(result.error.status, 403);
    assert.match(result.error.message, /Enable `search\.formats/);
  });

  test("SearXNG web_search does not auto-read pages; readUrl still uses Jina Reader", async () => {
    const called = [];
    installFetch(async (url) => {
      called.push(String(url));
      if (String(url).includes("searxng:8080")) {
        return jsonResponse({
          results: [{ url: "https://example.com/a", title: "A", content: "snippet A" }]
        });
      }
      if (String(url).startsWith("https://r.jina.ai/")) {
        return jsonResponse({ data: { title: "Read A", content: "full page A" } });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const search = await orchestrator.search({ query: "snippet only" });
    assert.equal(search.ok, true);
    assert.equal(search.provider, "searxng");
    assert.equal(called.length, 1);
    assert.equal(called.some((url) => url.startsWith("https://r.jina.ai/")), false);

    const read = await orchestrator.readUrl({ url: "https://example.com/a" });
    assert.equal(read.ok, true);
    assert.equal(read.provider, "jina");
    assert.equal(read.content, "full page A");
    assert.equal(called.some((url) => url === "https://r.jina.ai/https://example.com/a"), true);
  });

  test("Brave current LLM Context schema returns normalized context", async () => {
    installFetch(async () => jsonResponse({
      grounding: {
        generic: [
          { url: "https://docs.example/a", title: "Grounding A", snippets: ["first relevant chunk", "second chunk"] }
        ],
        map: []
      },
      sources: {
        "https://docs.example/a": {
          title: "Source A",
          hostname: "docs.example",
          age: ["Monday, May 18, 2026", "2026-05-18", "4 days ago"]
        }
      }
    }));
    const config = { ...baseConfig, primaryProvider: "brave" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "brave schema" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].url, "https://docs.example/a");
    assert.match(result.results[0].content, /first relevant chunk/);
    assert.equal(result.results[0].publishedAt, "2026-05-18");
  });

  test("skips Jina search when no JINA_API_KEY is configured", async () => {
    const called = [];
    installFetch(async (url) => {
      called.push(String(url));
      return jsonResponse({
        grounding: {
          generic: [{ url: "https://b.example/1", title: "Brave Only", snippets: ["fallback context"] }],
          map: []
        },
        sources: {}
      });
    });
    const config = {
      ...baseConfig,
      primaryProvider: "jina",
      jina: { ...baseConfig.jina, apiKey: "" },
      brave: { apiKey: "brave-key" }
    };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "brave only" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
    assert.equal(called.some((url) => url.includes("s.jina.ai")), false);
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
    assert.match(text, /^T\nURL: https:\/\/u/);
    assert.doesNotMatch(text, /\[1\]/);
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
    assert.equal(parsed.formatted_for_reference, undefined);
  });

  test("executeToolCall dispatches document tools through the shared tool loop executor", async () => {
    let called = false;
    const result = await executeToolCall({
      toolCall: {
        function: {
          name: "search_document",
          arguments: JSON.stringify({ query: "invoice totals" })
        }
      },
      documents: {
        async search(args) {
          called = true;
          assert.equal(args.query, "invoice totals");
          return {
            ok: true,
            provider: "documents",
            results: [{ index: 1, title: "Invoice.pdf", content: "Total: $100" }],
            citations: [{ index: 1, type: "document", title: "Invoice.pdf" }]
          };
        }
      }
    });

    assert.equal(called, true);
    assert.equal(result.ok, true);
    assert.equal(result.provider, "documents");
    assert.equal(JSON.parse(result.toolResultJson).results[0].title, "Invoice.pdf");
  });

  test("runChatWithToolLoop completes when model finishes without tool call", async () => {
    const crofai = {
      async streamChatCompletion() {
        return streamResponse([contentDelta("Hi")]);
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

  test("runChatWithToolLoop corrects fake document download handoffs into real artifact calls", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) {
          return streamResponse([contentDelta("Here you go - the PPTX is ready: [Price Comparison.pptx](Price Comparison.pptx)")]);
        }
        if (bodies.length === 2) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: {
              format: "pptx",
              title: "Price Comparison",
              content: "Complete deck content."
            }
          })]);
        }
        return streamResponse([contentDelta("Done.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "make the ppt more concise and send the pptx" }],
        tools: buildDocumentTools({ toolNames: ["create_document"] }),
        tool_choice: "auto"
      },
      crofai,
      config: {
        serverApiKey: "k",
        defaultBaseUrl: "https://crof.ai/v1",
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 1, maxToolResultChars: 5000 }
      },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      documents: {
        async createDocument() {
          return {
            ok: true,
            output: {
              attachment_id: "att-pptx",
              document_file_id: "doc-pptx",
              file_name: "Price Comparison.pptx",
              kind: "pptx",
              status: "ready"
            }
          };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.equal(bodies.length, 3);
    assert.match(latestUserTextFromBody(bodies[1]), /no document tool returned a real artifact card/);
    assert.equal(result.accumulated.content, "Done.");
    assert.equal(result.toolCallCount, 1);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].download_url, "/api/attachments/att-pptx/download");
  });

  test("runChatWithToolLoop routes through the supplied provider override", async () => {
    const seenAuth = [];
    const crofai = {
      async streamChatCompletion({ apiKey, baseUrl, providerId, body }) {
        seenAuth.push({ apiKey, baseUrl, providerId, body });
        return streamResponse([contentDelta("ok")]);
      }
    };

    await runChatWithToolLoop({
      chatRequest: {
        model: "xiaomi/mimo-v2.5",
        messages: [{ role: "user", content: "ping" }],
        reasoning_effort: "high"
      },
      crofai,
      config: { serverApiKey: "klui-key", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 3 } },
      provider: { id: "openrouter", apiKey: "or-key", baseUrl: "https://openrouter.ai/api/v1", label: "OpenRouter" },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      onUpstreamEvent: () => {}
    });

    assert.equal(seenAuth.length, 1);
    assert.equal(seenAuth[0].apiKey, "or-key");
    assert.equal(seenAuth[0].baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(seenAuth[0].providerId, "openrouter");
    assert.equal(seenAuth[0].body.reasoning_effort, "high");
  });

  test("runChatWithToolLoop falls back to klui credentials when provider is missing", async () => {
    const seenAuth = [];
    const crofai = {
      async streamChatCompletion({ apiKey, baseUrl }) {
        seenAuth.push({ apiKey, baseUrl });
        return streamResponse([contentDelta("ok")]);
      }
    };

    await runChatWithToolLoop({
      chatRequest: { model: "x", messages: [{ role: "user", content: "ping" }] },
      crofai,
      config: { serverApiKey: "klui-key", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 3 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      onUpstreamEvent: () => {}
    });

    assert.equal(seenAuth[0].apiKey, "klui-key");
    assert.equal(seenAuth[0].baseUrl, "https://crof.ai/v1");
  });

  test("runChatWithToolLoop forces a final answer after the tool-call cap", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) return streamResponse([toolCallDelta()]);
        return streamResponse([contentDelta("Final answer")]);
      }
    };
    const websearch = {
      search: async () => ({
        ok: true,
        provider: "jina",
        cached: false,
        query: "latest ai news",
        results: [
          { index: 1, title: "T", url: "https://u", snippet: "s", content: "c", publishedAt: null }
        ]
      })
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "search" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch,
      onUpstreamEvent: () => {}
    });

    assert.equal(result.accumulated.content, "Final answer");
    assert.equal(result.toolCallCount, 1);
    assert.deepEqual(result.providers, ["jina"]);
    assert.equal(bodies[1].tool_choice, "none");
  });

  test("isToolsUnsupportedError recognizes provider tool/tool_choice rejections", () => {
    assert.equal(isToolsUnsupportedError(new Error("No endpoints found that support the provided 'tool_choice' value.")), true);
    assert.equal(isToolsUnsupportedError(new Error("This model does not support tools.")), true);
    assert.equal(isToolsUnsupportedError(new Error("tools are not supported by this endpoint")), true);
    assert.equal(isToolsUnsupportedError(new Error("function calling is not supported")), true);
    assert.equal(isToolsUnsupportedError(new Error("Rate limit exceeded.")), false);
    assert.equal(isToolsUnsupportedError(null), false);
  });

  test("runChatWithToolLoop degrades to a tool-less answer when the provider rejects tools", async () => {
    const bodies = [];
    const toolEvents = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if ("tool_choice" in body || "tools" in body) {
          throw new Error("No endpoints found that support the provided 'tool_choice' value.");
        }
        return streamResponse([contentDelta("Plain answer")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "xiaomi/mimo-v2.5",
        messages: [{ role: "user", content: "compare prices" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 3 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      onUpstreamEvent: () => {},
      onToolEvent: (event) => toolEvents.push(event)
    });

    assert.equal(result.accumulated.content, "Plain answer");
    assert.equal(result.toolCallCount, 0);
    // 0: tool_choice rejected, 1: tools-only rejected, 2: stripped → success
    assert.equal(bodies.length, 3);
    assert.equal("tool_choice" in bodies[1], false);
    assert.equal("tools" in bodies[1], true);
    assert.equal("tool_choice" in bodies[2], false);
    assert.equal("tools" in bodies[2], false);
    assert.deepEqual(toolEvents.map((event) => event.type), ["tool:degraded", "tool:degraded"]);
  });

  test("runChatWithToolLoop drops only tool_choice when the provider still supports tools", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if ("tool_choice" in body) {
          throw new Error("No endpoints found that support the provided 'tool_choice' value.");
        }
        if (bodies.length === 2) return streamResponse([toolCallDelta()]);
        return streamResponse([contentDelta("Answer with search")]);
      }
    };
    const websearch = {
      search: async () => ({
        ok: true,
        provider: "jina",
        cached: false,
        query: "prices",
        results: [{ index: 1, title: "T", url: "https://u", snippet: "s", content: "c", publishedAt: null }]
      })
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "some/tools-ok-model",
        messages: [{ role: "user", content: "search" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch,
      onUpstreamEvent: () => {}
    });

    assert.equal(result.accumulated.content, "Answer with search");
    assert.equal(result.toolCallCount, 1);
    assert.deepEqual(result.providers, ["jina"]);
    // Final turn must not reintroduce tool_choice (provider rejects it).
    assert.equal("tool_choice" in bodies[bodies.length - 1], false);
  });

  test("runChatWithToolLoop executes only the remaining tool-call budget from a batch", async () => {
    let searchCalls = 0;
    const toolEvents = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        if (body.tool_choice === "none") return streamResponse([contentDelta("Done")]);
        return streamResponse([{
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "a" }) } },
                { index: 1, id: "call_b", type: "function", function: { name: "web_search", arguments: JSON.stringify({ query: "b" }) } }
              ]
            },
            finish_reason: "tool_calls"
          }]
        }]);
      }
    };
    const websearch = {
      search: async () => {
        searchCalls += 1;
        return {
          ok: true,
          provider: "jina",
          cached: false,
          query: "a",
          results: [
            { index: 1, title: "T", url: "https://u", snippet: "s", content: "c", publishedAt: null }
          ]
        };
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "search" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch,
      onUpstreamEvent: () => {},
      onToolEvent: (event) => toolEvents.push(event)
    });

    assert.equal(result.accumulated.content, "Done");
    assert.equal(searchCalls, 1);
    assert.equal(result.toolCallCount, 1);
    assert.equal(toolEvents.some((event) => event.type === "tool:limit"), true);
  });

  test("runChatWithToolLoop injects PDF page images after visual document tool calls", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) {
          return streamResponse([toolCallDelta({
            name: "read_document",
            args: { attachment_id: "00000000-0000-4000-8000-000000000003", page_start: 1, page_end: 1 }
          })]);
        }
        return streamResponse([contentDelta("I inspected the page image.")]);
      }
    };
    const documents = {
      async read() {
        return {
          ok: true,
          provider: "documents",
          results: [{ index: 1, title: "Homework.pdf - Page 1", content: "helper text" }],
          citations: [{ index: 1, type: "document", title: "Homework.pdf - Page 1" }],
          visualPages: [{
            index: 1,
            title: "Homework.pdf - Page 1",
            page_number: 1,
            url: "https://signed.example/page-0001.jpg",
            text: "helper text"
          }]
        };
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "gpt-5-vision",
        messages: [{ role: "user", content: "solve this pdf" }],
        tools: [],
        tool_choice: "auto"
      },
      crofai,
      config: {
        serverApiKey: "k",
        defaultBaseUrl: "https://crof.ai/v1",
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 1, maxToolResultChars: 5000 }
      },
      signal: new AbortController().signal,
      websearch: {},
      documents,
      visualDocuments: true,
      onUpstreamEvent: () => {}
    });

    assert.equal(result.accumulated.content, "I inspected the page image.");
    const secondMessages = bodies[1].messages;
    const visualMessage = secondMessages.find((message) => (
      message.role === "user"
      && Array.isArray(message.content)
      && message.content.some((part) => part?.type === "image_url")
    ));
    assert.ok(visualMessage);
    assert.equal(
      visualMessage.content.find((part) => part?.type === "image_url").image_url.url,
      "https://signed.example/page-0001.jpg"
    );
  });

  test("runChatWithToolLoop can inline PDF page images for vision models", async () => {
    const bodies = [];
    installFetch(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": "4"
      }
    }));

    try {
      const crofai = {
        async streamChatCompletion({ body }) {
          bodies.push(body);
          if (bodies.length === 1) {
            return streamResponse([toolCallDelta({
              name: "read_document",
              args: { attachment_id: "00000000-0000-4000-8000-000000000003", page_start: 1, page_end: 1 }
            })]);
          }
          return streamResponse([contentDelta("I read the inline page image.")]);
        }
      };
      const documents = {
        async read() {
          return {
            ok: true,
            provider: "documents",
            results: [{ index: 1, title: "Homework.pdf - Page 1", content: "helper text" }],
            citations: [{ index: 1, type: "document", title: "Homework.pdf - Page 1" }],
            visualPages: [{
              index: 1,
              title: "Homework.pdf - Page 1",
              page_number: 1,
              url: "https://signed.example/page-0001.jpg",
              text: "helper text"
            }]
          };
        }
      };

      const result = await runChatWithToolLoop({
        chatRequest: {
          model: "gpt-5-vision",
          messages: [{ role: "user", content: "solve this pdf" }],
          tools: [],
          tool_choice: "auto"
        },
        crofai,
        config: {
          serverApiKey: "k",
          defaultBaseUrl: "https://crof.ai/v1",
          websearch: { maxToolCallsPerTurn: 0 },
          documents: {
            maxToolCallsPerTurn: 1,
            maxToolResultChars: 5000,
            visualInlineImages: true,
            visualMaxImageInputsPerTurn: 12,
            visualInlineMaxBytes: 1024,
            visualInlineMaxTotalBytes: 1024
          }
        },
        signal: new AbortController().signal,
        websearch: {},
        documents,
        visualDocuments: true,
        onUpstreamEvent: () => {}
      });

      assert.equal(result.accumulated.content, "I read the inline page image.");
      const secondMessages = bodies[1].messages;
      const visualMessage = secondMessages.find((message) => (
        message.role === "user"
        && Array.isArray(message.content)
        && message.content.some((part) => part?.type === "image_url")
      ));
      assert.ok(visualMessage);
      const imageUrl = visualMessage.content.find((part) => part?.type === "image_url").image_url.url;
      assert.match(imageUrl, /^data:image\/jpeg;base64,/);
    } finally {
      restoreFetch();
    }
  });

  test("runChatWithToolLoop fetches PDF page images concurrently and enforces the per-turn byte budget in page order", async () => {
    /* Pages sized so two fit the per-turn budget (above the 64KiB
       config-validation floor) and the third must fall back to the
       signed URL. Using realistic byte sizes keeps the test from
       being silently rewritten by the floor clamps. */
    const pageSize = 32 * 1024;
    const pageBytes = new Map([
      ["https://signed.example/page-0001.jpg", new Uint8Array(pageSize)],
      ["https://signed.example/page-0002.jpg", new Uint8Array(pageSize)],
      ["https://signed.example/page-0003.jpg", new Uint8Array(pageSize)]
    ]);

    let inFlight = 0;
    let maxConcurrent = 0;
    const fetchOrder = [];

    installFetch(async (url) => {
      fetchOrder.push(String(url));
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      const bytes = pageBytes.get(String(url)) || new Uint8Array(0);
      return new Response(bytes, {
        headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength) }
      });
    });

    try {
      const crofai = {
        async streamChatCompletion({ body }) {
          if (!crofai.calls) crofai.calls = 0;
          crofai.calls += 1;
          if (crofai.calls === 1) {
            return streamResponse([toolCallDelta({
              name: "read_document",
              args: { attachment_id: "00000000-0000-4000-8000-000000000004", page_start: 1, page_end: 3 }
            })]);
          }
          crofai.lastBody = body;
          return streamResponse([contentDelta("done.")]);
        }
      };
      const documents = {
        async read() {
          return {
            ok: true,
            provider: "documents",
            results: [],
            citations: [],
            visualPages: [
              { index: 1, page_id: "p1", page_number: 1, url: "https://signed.example/page-0001.jpg" },
              { index: 2, page_id: "p2", page_number: 2, url: "https://signed.example/page-0002.jpg" },
              { index: 3, page_id: "p3", page_number: 3, url: "https://signed.example/page-0003.jpg" }
            ]
          };
        }
      };

      await runChatWithToolLoop({
        chatRequest: { model: "gpt-5-vision", messages: [{ role: "user", content: "read it" }], tools: [], tool_choice: "auto" },
        crofai,
        config: {
          serverApiKey: "k",
          defaultBaseUrl: "https://crof.ai/v1",
          websearch: { maxToolCallsPerTurn: 0 },
          documents: {
            maxToolCallsPerTurn: 1,
            maxToolResultChars: 5000,
            visualInlineImages: true,
            visualMaxImageInputsPerTurn: 5,
            visualInlineMaxBytes: 64 * 1024,
            /* Only enough budget for two of the three 32KiB pages. */
            visualInlineMaxTotalBytes: 70 * 1024
          }
        },
        signal: new AbortController().signal,
        websearch: {},
        documents,
        visualDocuments: true,
        onUpstreamEvent: () => {}
      });

      /* All three pages should be fetched concurrently regardless of
         the budget — the budget only decides which inline data URLs
         end up attached to the next model turn. */
      assert.equal(fetchOrder.length, 3);
      assert.ok(maxConcurrent >= 2, `expected concurrent fetches, got max=${maxConcurrent}`);

      const visualMessage = crofai.lastBody.messages.find((message) => (
        message.role === "user"
        && Array.isArray(message.content)
        && message.content.some((part) => part?.type === "image_url")
      ));
      const urls = visualMessage.content.filter((part) => part?.type === "image_url").map((part) => part.image_url.url);
      assert.equal(urls.length, 3);
      /* Earlier pages get priority for the data-URL slot; the last one
         falls back to the signed URL because the byte budget is full. */
      assert.match(urls[0], /^data:image\/jpeg;base64,/);
      assert.match(urls[1], /^data:image\/jpeg;base64,/);
      assert.equal(urls[2], "https://signed.example/page-0003.jpg");
    } finally {
      restoreFetch();
    }
  });

  test("runChatWithToolLoop dedupes inline image fetches across iterations within a single turn", async () => {
    const fetchCounts = new Map();
    installFetch(async (url) => {
      fetchCounts.set(String(url), (fetchCounts.get(String(url)) || 0) + 1);
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { "content-type": "image/jpeg", "content-length": "4" }
      });
    });

    try {
      let toolCalls = 0;
      const crofai = {
        async streamChatCompletion() {
          toolCalls += 1;
          if (toolCalls <= 2) {
            return streamResponse([toolCallDelta({
              id: `call_${toolCalls}`,
              name: "read_document",
              args: { attachment_id: "00000000-0000-4000-8000-000000000005", page_start: 1, page_end: 1 }
            })]);
          }
          return streamResponse([contentDelta("answered.")]);
        }
      };
      /* Same page returned twice across two consecutive tool calls. */
      const documents = {
        async read() {
          return {
            ok: true,
            provider: "documents",
            results: [],
            citations: [],
            visualPages: [{
              index: 1,
              page_id: "stable-page",
              page_number: 1,
              url: "https://signed.example/page-0001.jpg"
            }]
          };
        }
      };

      await runChatWithToolLoop({
        chatRequest: { model: "gpt-5-vision", messages: [{ role: "user", content: "look" }], tools: [], tool_choice: "auto" },
        crofai,
        config: {
          serverApiKey: "k",
          defaultBaseUrl: "https://crof.ai/v1",
          websearch: { maxToolCallsPerTurn: 0 },
          documents: {
            maxToolCallsPerTurn: 2,
            maxToolResultChars: 5000,
            visualInlineImages: true,
            visualMaxImageInputsPerTurn: 5,
            visualInlineMaxBytes: 64 * 1024,
            visualInlineMaxTotalBytes: 128 * 1024
          }
        },
        signal: new AbortController().signal,
        websearch: {},
        documents,
        visualDocuments: true,
        onUpstreamEvent: () => {}
      });

      assert.equal(fetchCounts.get("https://signed.example/page-0001.jpg"), 1);
    } finally {
      restoreFetch();
    }
  });
});
