import assert from "node:assert/strict";
import test, { describe, before, after } from "node:test";

import { SearchCache, hashKey } from "../server/websearch/cache.js";
import { buildSearchSystemHint, detectSearchNeed, extractUrls } from "../server/websearch/detect.js";
import {
  BUILTIN_ADULT_DENY_DOMAINS,
  filterDeniedDomains,
  isHeuristicallyDeniedHostname,
  mergeDenyDomains
} from "../server/websearch/deny-domains.js";
import {
  WebSearchOrchestrator,
  citationsFromResults,
  filterCitationsForAnswer,
  formatResultsForModel
} from "../server/websearch/index.js";
import { searxngSearch, selectRelevantResults } from "../server/websearch/searxng.js";
import { isPrivateHostname, jinaRead } from "../server/websearch/jina.js";
import { buildWebSearchTools, executeToolCall, isToolsUnsupportedError, runChatWithToolLoop } from "../server/websearch/tool.js";
import { buildDocumentTools } from "../server/documents/tool.js";
import { loadConfig } from "../server/config.js";
import { estimateContextTokens } from "../server/saas/messages.js";
import { buildWeatherTool } from "../server/weather.js";

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

describe("deny domains", () => {
  const sampleResults = [
    { title: "Adult exact", url: "https://xvideos.tube/video/1" },
    { title: "Adult subdomain", url: "https://cdn.inxxx.com/clip" },
    { title: "Adult alias", url: "https://www.pornhub.com/view" },
    { title: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/123" },
    { title: "WHO", url: "https://www.who.int/news" },
    { title: "Custom tracker", url: "https://ads.tracker.test/pixel" },
    { title: "Malformed", url: "not a url" }
  ];

  test("built-in adult list removes exact domains and subdomains", () => {
    const deny = mergeDenyDomains([]);
    assert.ok(BUILTIN_ADULT_DENY_DOMAINS.includes("xvideos.tube"));
    assert.ok(BUILTIN_ADULT_DENY_DOMAINS.includes("inxxx.com"));
    const kept = filterDeniedDomains(sampleResults, deny);
    assert.deepEqual(
      kept.map((entry) => entry.title),
      ["PubMed", "WHO", "Custom tracker"]
    );
  });

  test("WEBSEARCH_DENY_DOMAINS remains additive on top of built-ins", () => {
    const deny = mergeDenyDomains(["tracker.test", "evil.example"]);
    const kept = filterDeniedDomains(sampleResults, deny);
    assert.deepEqual(
      kept.map((entry) => entry.title),
      ["PubMed", "WHO"]
    );
    assert.ok(deny.includes("xvideos.com"));
    assert.ok(deny.includes("tracker.test"));
  });

  test("medical and academic hosts are retained", () => {
    const deny = mergeDenyDomains([]);
    const kept = filterDeniedDomains([
      { title: "NEJM", url: "https://www.nejm.org/doi/full/10.1056/NEJMoa000001" },
      { title: "Nature", url: "https://www.nature.com/articles/s41586-020-0001" },
      { title: "CDC", url: "https://www.cdc.gov/flu" }
    ], deny);
    assert.equal(kept.length, 3);
  });

  test("heuristic blocks adult hostnames by TLD, substring, and boundary tokens", () => {
    const blocked = [
      "hqporner.com",
      "eporner.com",
      "bestpornsites.net",
      "free-xxx-videos.com",
      "hentaihaven.xxx",
      "example.porn",
      "sexcams.example.com",
      "onlyfans.com",
      "rule34.paheal.net"
    ];
    for (const host of blocked) {
      assert.equal(isHeuristicallyDeniedHostname(host), true, `expected block: ${host}`);
      assert.equal(
        filterDeniedDomains([{ title: host, url: `https://${host}/` }], []).length,
        0,
        `filterDeniedDomains should drop ${host}`
      );
    }
  });

  test("heuristic does not block legitimate academic, retail, or analytics hosts", () => {
    const allowed = [
      "essex.ac.uk",
      "sussex.edu",
      "middlesex.edu",
      "dickssportinggoods.com",
      "analytics.google.com",
      "scunthorpe.gov.uk",
      "adultlearning.org",
      "cambridge.org",
      "nih.gov",
      "who.int"
    ];
    for (const host of allowed) {
      assert.equal(isHeuristicallyDeniedHostname(host), false, `expected allow: ${host}`);
    }
    const deny = mergeDenyDomains([]);
    const kept = filterDeniedDomains(
      allowed.map((host) => ({ title: host, url: `https://${host}/` })),
      deny
    );
    assert.equal(kept.length, allowed.length);
  });

  test("malformed URLs fail closed and do not bypass filtering", () => {
    const deny = mergeDenyDomains([]);
    assert.deepEqual(filterDeniedDomains([{ title: "Bad", url: "://broken" }], deny), []);
    assert.deepEqual(filterDeniedDomains([{ title: "Missing" }], deny), []);
  });

  test("empty deny list still fails closed for malformed result URLs", () => {
    assert.deepEqual(filterDeniedDomains([{ title: "Bad", url: "://broken" }], []), []);
    assert.deepEqual(filterDeniedDomains([{ title: "Missing" }], []), []);
    assert.deepEqual(
      filterDeniedDomains([{ title: "Ok", url: "https://example.com/ok" }], []),
      [{ title: "Ok", url: "https://example.com/ok" }]
    );
  });

  test("orchestrator always applies the shared deny filter", async () => {
    const orch = new WebSearchOrchestrator({
      config: { ...baseConfig, primaryProvider: "jina", denyDomains: ["blocked.test"] }
    });
    installFetch(async () => jsonResponse({
      data: [
        { title: "Adult", url: "https://xvideos.tube/a", description: "x", content: "x" },
        { title: "Blocked", url: "https://blocked.test/page", description: "b", content: "b" },
        { title: "Ok", url: "https://example.com/ok", description: "test query result", content: "test query result" }
      ]
    }));
    try {
      const result = await orch.search({ query: "test query" });
      assert.equal(result.ok, true);
      assert.deepEqual(result.results.map((entry) => entry.title), ["Ok"]);
    } finally {
      restoreFetch();
    }
  });

  test("readUrl rejects denied input URLs before cache, quota, or network", async () => {
    let fetchCalled = false;
    let quotaCalled = false;
    let cacheGets = 0;
    installFetch(async () => {
      fetchCalled = true;
      throw new Error("network should not run");
    });
    const orch = new WebSearchOrchestrator({ config: baseConfig });
    orch.cache = {
      async get() {
        cacheGets += 1;
        return null;
      },
      async set() {
        throw new Error("cache set should not run");
      }
    };
    orch.beforeNetwork = async () => {
      quotaCalled = true;
      throw new Error("quota should not run");
    };
    try {
      const result = await orch.readUrl({ url: "https://www.xvideos.tube/video/1" });
      assert.equal(result.ok, false);
      assert.equal(result.error.provider, "policy");
      assert.equal(result.error.status, 403);
      assert.match(result.error.message, /deny-domain policy/i);
      assert.equal(fetchCalled, false);
      assert.equal(quotaCalled, false);
      assert.equal(cacheGets, 0);
    } finally {
      restoreFetch();
    }
  });

  test("readUrl rejects a denied final URL from Jina before caching", async () => {
    let cacheSets = 0;
    installFetch(async (url) => {
      assert.match(String(url), /^https:\/\/r\.jina\.ai\//);
      return jsonResponse({
        data: {
          title: "Redirected",
          url: "https://xvideos.tube/landed",
          content: "should not be cached"
        }
      });
    });
    const orch = new WebSearchOrchestrator({ config: baseConfig });
    orch.cache = {
      async get() {
        return null;
      },
      async set() {
        cacheSets += 1;
      }
    };
    try {
      const result = await orch.readUrl({ url: "https://example.com/bounce" });
      assert.equal(result.ok, false);
      assert.equal(result.error.provider, "policy");
      assert.equal(result.error.status, 403);
      assert.match(result.error.message, /Final URL blocked/i);
      assert.equal(cacheSets, 0);
    } finally {
      restoreFetch();
    }
  });

  test("search re-filters cached results with the current deny list", async () => {
    let fetchCalls = 0;
    installFetch(async () => {
      fetchCalls += 1;
      throw new Error("network should not run on cache hit");
    });
    const orch = new WebSearchOrchestrator({
      config: { ...baseConfig, denyDomains: ["blocked.test"] }
    });
    orch.cache = {
      async get() {
        return {
          query: "legacy query",
          provider: "jina",
          results: [
            { title: "Adult", url: "https://xvideos.tube/a", snippet: "x" },
            { title: "Blocked", url: "https://blocked.test/page", snippet: "b" },
            { title: "Malformed", url: "://broken" },
            { title: "Ok", url: "https://example.com/ok", snippet: "legacy query ok" }
          ],
          tokens: null,
          fetchedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async set() {
        throw new Error("cache set should not run");
      }
    };
    try {
      const result = await orch.search({ query: "legacy query" });
      assert.equal(result.ok, true);
      assert.equal(result.cached, true);
      assert.equal(fetchCalls, 0);
      assert.deepEqual(result.results.map((entry) => entry.title), ["Ok"]);
    } finally {
      restoreFetch();
    }
  });

  test("readUrl rejects a cached payload whose final URL is now denied", async () => {
    let fetchCalled = false;
    installFetch(async () => {
      fetchCalled = true;
      throw new Error("network should not run");
    });
    const orch = new WebSearchOrchestrator({ config: baseConfig });
    orch.cache = {
      async get() {
        return {
          provider: "jina",
          url: "https://xvideos.tube/landed",
          title: "Cached redirect",
          content: "legacy adult content",
          publishedAt: null,
          fetchedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async set() {
        throw new Error("cache set should not run");
      }
    };
    try {
      const result = await orch.readUrl({ url: "https://example.com/bounce" });
      assert.equal(result.ok, false);
      assert.equal(result.error.provider, "policy");
      assert.equal(result.error.status, 403);
      assert.match(result.error.message, /Final URL blocked/i);
      assert.equal(fetchCalled, false);
    } finally {
      restoreFetch();
    }
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
    assert.deepEqual(config.websearch.searxng.engines, ["duckduckgo", "bing", "mojeek"]);
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
            title: "Latest AI News",
            content: "A relevant search snippet about artificial intelligence.",
            publishedDate: "2026-06-01"
          },
          {
            url: "https://example.com/news",
            title: "Duplicate",
            content: "duplicate"
          },
          {
            url: "https://example.org/other",
            title: "Other AI News Result",
            content: "Another artificial intelligence news snippet."
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
    assert.equal(result.results[0].title, "Latest AI News");
    assert.equal(result.results[0].snippet, "A relevant search snippet about artificial intelligence.");
    assert.equal(result.results[0].content, "");
    assert.equal(result.results[0].publishedAt, "2026-06-01");
    assert.equal(capturedUrl.origin, "http://searxng:8080");
    assert.equal(capturedUrl.pathname, "/search");
    assert.equal(capturedUrl.searchParams.get("format"), "json");
    assert.equal(capturedUrl.searchParams.get("engines"), "duckduckgo,bing");
    assert.equal(capturedUrl.searchParams.get("time_range"), "week");
    assert.equal(capturedUrl.searchParams.get("safesearch"), "2");
    assert.equal(capturedOptions.headers["x-forwarded-for"], "127.0.0.1");
    assert.equal(capturedOptions.headers["x-real-ip"], "127.0.0.1");
  });

  test("SearXNG sends the query through unchanged with safesearch=2", async () => {
    let capturedUrl;
    installFetch(async (input) => {
      capturedUrl = new URL(String(input));
      return jsonResponse({ results: [] });
    });
    try {
      await searxngSearch({
        query: "deep research query about climate",
        baseUrl: "http://searxng:8080",
        engines: ["duckduckgo"]
      });
      assert.equal(capturedUrl.searchParams.get("safesearch"), "2");
      assert.equal(capturedUrl.searchParams.get("format"), "json");
      assert.equal(capturedUrl.searchParams.get("q"), "deep research query about climate");
    } finally {
      restoreFetch();
    }
  });

  test("SearXNG filters generic retail and dictionary noise from local intent searches", async () => {
    installFetch(async () => jsonResponse({
      results: [
        {
          url: "https://www.cntravellerme.com/story/best-beachfront-restaurants-dubai",
          title: "The 23 best beachfront restaurants in Dubai",
          content: "Seafood spots, beach clubs, and restaurants around Dubai."
        },
        {
          url: "https://www.bestbuy.com/",
          title: "Best Buy | Official Online Store | Shop Now & Save",
          content: "Shop electronics, appliances, and deals."
        },
        {
          url: "https://dictionary.cambridge.org/dictionary/english/best",
          title: "BEST | English meaning - Cambridge Dictionary",
          content: "Meaning of best in English."
        },
        {
          url: "https://seafoodslurps.com/best-seafood-buffet-dubai",
          title: "2026 Ranked: Best Seafood Buffet in Dubai",
          content: "A Dubai seafood buffet guide with restaurant picks."
        },
        {
          url: "https://wordreference.com/definition/best",
          title: "best - WordReference.com Dictionary of English",
          content: "Dictionary entry."
        }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "best seafood restuarents dubai?", numResults: 5 });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.results.map((entry) => new URL(entry.url).hostname.replace(/^www\./, "")),
      ["seafoodslurps.com", "cntravellerme.com"]
    );
    assert.deepEqual(result.results.map((entry) => entry.index), [1, 2]);
  });

  test("SearXNG keeps Reddit-style results while dropping generic shopping noise", async () => {
    installFetch(async () => jsonResponse({
      results: [
        {
          url: "https://www.bestbuy.com/",
          title: "Best Buy | Official Online Store | Shop Now & Save",
          content: "Shop electronics."
        },
        {
          url: "https://www.reddit.com/r/fragrance/comments/cheap_perfume/",
          title: "What is your best cheap perfume that gets so many compliments?",
          content: "Reddit users discuss budget fragrances for men."
        },
        {
          url: "https://dictionary.cambridge.org/dictionary/english/top",
          title: "TOP | English meaning - Cambridge Dictionary",
          content: "Meaning of top in English."
        },
        {
          url: "https://shop.topsmarkets.com/",
          title: "Tops Markets Delivery or Pickup Near Me",
          content: "Grocery delivery."
        },
        {
          url: "https://www.reddit.com/r/AskMen/comments/affordable_fragrance/",
          title: "Which perfumes smell great but aren't expensive?",
          content: "Men recommend affordable perfume and fragrance options."
        },
        {
          url: "https://www.canva.com/",
          title: "Canva: Visual Suite for Everyone",
          content: "Design anything."
        }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({
      query: "can u give me a quick top 5 cheap perfumes, tell me based on what real people are saying on stuff like reddit for men",
      numResults: 5
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results.map((entry) => new URL(entry.url).hostname.replace(/^www\./, "")), [
      "reddit.com",
      "reddit.com"
    ]);
  });

  test("SearXNG prefers relevant app-development sources over generic GitHub and word noise", async () => {
    let capturedUrl;
    installFetch(async (url) => {
      capturedUrl = new URL(String(url));
      return jsonResponse({
        results: [
          {
            url: "https://restaurantji.com/ga/chatsworth/",
            title: "THE 15 BEST Restaurants in Chatsworth, GA - With Menus, Reviews",
            content: "Restaurant menus and local food reviews."
          },
          {
            url: "https://fontawesome.com/",
            title: "Font Awesome",
            content: "Icon library and toolkit."
          },
          {
            url: "https://mrmrsenglish.com/100-synonyms-for-awesome/",
            title: "100 Synonyms for Awesome in English with their Pictures",
            content: "Vocabulary examples."
          },
          {
            url: "https://cdnjs.com/libraries/font-awesome",
            title: "font-awesome - Libraries - cdnjs - The #1 free and open source CDN",
            content: "CDN assets for Font Awesome."
          },
          {
            url: "https://github.com/",
            title: "GitHub · Change is constant. GitHub keeps you ahead.",
            content: "GitHub homepage."
          },
          {
            url: "https://www.linkedin.com/company/github",
            title: "GitHub - LinkedIn",
            content: "Company profile."
          },
          {
            url: "https://github.dev/",
            title: "github.dev - Visual Studio Code for the Web",
            content: "Open GitHub repositories in a browser editor."
          },
          {
            url: "https://github.com/capacitor-community/awesome-capacitor",
            title: "GitHub - capacitor-community/awesome-capacitor: A curated list of Capacitor plugins",
            content: "A repository for Capacitor plugins and resources for Android, iOS, and mobile app development."
          },
          {
            url: "https://github.com/topics/mobile-app-development",
            title: "mobile-app-development · GitHub Topics",
            content: "GitHub repositories for Android, iOS, React Native, Flutter, Expo, and mobile app development."
          },
          {
            url: "https://docs.expo.dev/",
            title: "Expo Documentation",
            content: "Build native Android and iOS apps with React Native, Expo, and app development tools."
          },
          {
            url: "https://capacitorjs.com/docs",
            title: "Capacitor Documentation",
            content: "Capacitor lets web developers build native iOS and Android apps from one codebase."
          }
        ]
      });
    });

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({
      query: "Can you find me the best skills on a GitHub repo for making an Android app or iOS app, just like an app in general? The best GitHub skills to have the best design and code quality for making and building apps through AI agents.",
      numResults: 10
    });

    assert.equal(result.ok, true);
    assert.equal(capturedUrl.searchParams.get("q"), "Can you find me the best skills on a GitHub repo for making an Android app or iOS app, just like an app in general? The best GitHub skills to have the best design and code quality for making and building apps through AI agents.");
    assert.deepEqual(new Set(result.results.map((entry) => entry.url)), new Set([
      "https://github.com/capacitor-community/awesome-capacitor",
      "https://github.com/topics/mobile-app-development",
      "https://docs.expo.dev/",
      "https://capacitorjs.com/docs",
      // Kept: with the query sent unchanged, github.dev genuinely matches github+repo+code.
      // The word noise (restaurants, synonyms, font icons) and generic GitHub/LinkedIn
      // landing pages are still rejected. Excluding github.dev would need a reranker (skipped).
      "https://github.dev/"
    ]));
    assert.equal(result.results.length, 5);
  });

  test("SearXNG rejects filler that matches too few query terms instead of returning it", async () => {
    installFetch(async () => jsonResponse({
      results: [
        { url: "https://example.com/a", title: "Kettle overview", content: "Product page." },
        { url: "https://example.org/b", title: "Thermostat guide", content: "How it works." },
        { url: "https://sample.net/c", title: "Warranty info", content: "Coverage details." },
        { url: "https://demo.io/d", title: "Manual download", content: "PDF resource." }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "searxng" };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({
      query: "kettle thermostat warranty manual",
      numResults: 5
    });

    // Each result matches only one of four query terms (< the 2-term floor for
    // a 4-term query), so the filter returns nothing rather than filler.
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
  });

  test("Jina search success returns normalized results", async () => {
    let capturedUrl;
    let capturedOptions;
    installFetch(async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return jsonResponse({
        data: [
          { url: "https://a.example/1", title: "Result A", description: "latest ai news snippet A", content: "page content A" },
          { url: "https://b.example/2", title: "Result B", description: "latest ai news snippet B", content: "page content B" }
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
    const result = await orchestrator.search({ query: "brave" });
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
    const result = await orchestrator.search({ query: "jina" });
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
    const result = await orchestrator.search({ query: "relevant chunk" });
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
  test("weather tool returns a durable current and forecast artifact", async () => {
    const now = Math.floor(Date.now() / 1000);
    const calls = [];
    installFetch(async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === "/geo/1.0/direct") {
        return jsonResponse([{ name: "Dubai", country: "AE", lat: 25.2, lon: 55.3 }]);
      }
      if (url.pathname === "/data/2.5/weather") {
        return jsonResponse({
          dt: now,
          timezone: 14400,
          main: { temp: 41, feels_like: 45, humidity: 31, temp_min: 34, temp_max: 42 },
          wind: { speed: 5 },
          weather: [{ description: "clear sky", icon: "01d" }],
          sys: { country: "AE" }
        });
      }
      if (url.pathname === "/data/2.5/forecast") {
        return jsonResponse({
          city: { timezone: 14400 },
          list: Array.from({ length: 16 }, (_, index) => ({
            dt: now + (index + 1) * 10800,
            main: { temp: 40 - index / 2, temp_min: 34, temp_max: 42 },
            pop: 0,
            weather: [{ description: "clear sky", icon: "01d" }]
          }))
        });
      }
      return jsonResponse({ message: "not found" }, { status: 404 });
    });
    try {
      assert.equal(buildWeatherTool().function.name, "get_weather");
      const result = await executeToolCall({
        toolCall: { function: { name: "get_weather", arguments: JSON.stringify({ location: "Dubai", units: "metric" }) } },
        weather: { apiKey: "test", baseUrl: "https://api.openweathermap.org" }
      });
      assert.equal(result.ok, true);
      assert.equal(result.artifacts[0].type, "weather");
      assert.equal(result.artifacts[0].current.temperature, 41);
      assert.equal(result.artifacts[0].hourly.length, 7);
      assert.ok(result.artifacts[0].daily.length >= 2);
      assert.deepEqual(calls.sort(), ["/data/2.5/forecast", "/data/2.5/weather", "/geo/1.0/direct"].sort());
    } finally {
      restoreFetch();
    }
  });

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
      websearch,
      citationOffset: 2
    });
    assert.equal(result.ok, true);
    assert.equal(result.citations.length, 1);
    assert.equal(result.citations[0].index, 3);
    const parsed = JSON.parse(result.toolResultJson);
    assert.equal(parsed.results[0].url, "https://u");
    assert.equal(parsed.results[0].index, 3);
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
          return streamResponse([contentDelta("The document is regenerated with your parameters. The PDF should appear as an artifact card above.")]);
        }
        if (bodies.length === 2) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: {
              format: "pdf",
              title: "Project Proposal",
              content: "Complete proposal content."
            }
          })]);
        }
        return streamResponse([contentDelta("Done.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "regenerate the pdf" }],
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
              file_name: "Project Proposal.pdf",
              kind: "pdf",
              status: "ready"
            }
          };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.equal(bodies.length, 3);
    assert.match(latestUserTextFromBody(bodies[1]), /no document tool returned a real artifact card/);
    assert.equal(bodies[1].tool_choice, "required");
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
    assert.equal("tool_choice" in bodies[1], false);
    assert.equal("tools" in bodies[1], false);
  });

  test("runChatWithToolLoop resets provisional prose before the final tool answer", async () => {
    const toolEvents = [];
    let calls = 0;
    const crofai = {
      async streamChatCompletion() {
        calls += 1;
        if (calls === 1) {
          return streamResponse([{
            choices: [{
              delta: {
                content: "I will search first.",
                tool_calls: [{
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "web_search", arguments: JSON.stringify({ query: "latest" }) }
                }]
              },
              finish_reason: "tool_calls"
            }]
          }]);
        }
        return streamResponse([contentDelta("Here is the complete answer.")]);
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
      websearch: {
        search: async () => ({ ok: true, provider: "searxng", query: "latest", results: [] })
      },
      onUpstreamEvent: () => {},
      onToolEvent: (event) => toolEvents.push(event)
    });

    assert.equal(result.accumulated.content, "Here is the complete answer.");
    assert.equal(toolEvents[0].type, "response:reset");
  });

  test("runChatWithToolLoop retries once without tools when the model returns no answer", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) return streamResponse([contentDelta("")]);
        return streamResponse([contentDelta("Recovered answer")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "answer this" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "unused" } }) },
      onUpstreamEvent: () => {},
      onToolEvent: () => {}
    });

    assert.equal(bodies.length, 2);
    assert.equal("tool_choice" in bodies[1], false);
    assert.equal("tools" in bodies[1], false);
    assert.equal(result.accumulated.content, "Recovered answer");
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

  test("runChatWithToolLoop keeps document tools by falling back to the tool-capable model", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (body.model !== "deepseek/deepseek-v4-flash") {
          throw new Error("This model does not support tools.");
        }
        if (bodies.filter((entry) => entry.model === "deepseek/deepseek-v4-flash").length === 1) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: { format: "pdf", title: "Report", content: "Body" }
          })]);
        }
        return streamResponse([contentDelta("Done.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "poolside/laguna-xs-2.1",
        messages: [{ role: "user", content: "create a pdf" }],
        tools: buildDocumentTools({ toolNames: ["create_document"] }),
        tool_choice: "auto"
      },
      crofai,
      config: {
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 1, maxToolResultChars: 5000 }
      },
      provider: { id: "openrouter", apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" },
      signal: new AbortController().signal,
      websearch: {},
      documents: {
        async createDocument() {
          return {
            ok: true,
            output: {
              attachment_id: "att-pdf",
              document_file_id: "doc-pdf",
              file_name: "Report.pdf",
              kind: "pdf",
              status: "ready"
            }
          };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.equal(result.artifacts.length, 1);
    assert.equal(bodies.slice(0, -1).some((body) => !body.tools), false);
    assert.equal(bodies.at(-1).model, "deepseek/deepseek-v4-flash");
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
        if (!body.tools) return streamResponse([contentDelta("Done")]);
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

  test("runChatWithToolLoop retries once then errors if force-final still returns tool calls", async () => {
    let searchCalls = 0;
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        return streamResponse([toolCallDelta()]);
      }
    };

    await assert.rejects(runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "search" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      crofai,
      config: { serverApiKey: "k", defaultBaseUrl: "https://crof.ai/v1", websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: {
        search: async () => {
          searchCalls += 1;
          return { ok: true, provider: "searxng", query: "latest", results: [] };
        }
      },
      onUpstreamEvent: () => {}
    }), /did not provide a final answer/);

    assert.equal(searchCalls, 1);
    assert.equal(bodies.length, 3);
    assert.equal("tools" in bodies[1], false);
    assert.equal("tools" in bodies[2], false);
  });

  test("runChatWithToolLoop bounds large tool results before the next provider call", async () => {
    const bodies = [];
    const crofai = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) return streamResponse([toolCallDelta()]);
        return streamResponse([contentDelta("Bounded answer")]);
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
      config: {
        serverApiKey: "k",
        defaultBaseUrl: "https://crof.ai/v1",
        context: { maxTokens: 2000 },
        websearch: { maxToolCallsPerTurn: 1 }
      },
      signal: new AbortController().signal,
      websearch: {
        search: async () => ({
          ok: true,
          provider: "searxng",
          query: "latest",
          results: [{
            index: 1,
            title: "Large result",
            url: "https://example.com/large",
            snippet: "s",
            content: "evidence ".repeat(3000),
            publishedAt: null
          }]
        })
      },
      onUpstreamEvent: () => {}
    });

    assert.equal(result.accumulated.content, "Bounded answer");
    assert.ok(estimateContextTokens(bodies[1].messages) <= 2000);
    const toolMessage = bodies[1].messages.find((message) => message.role === "tool");
    assert.match(toolMessage.content, /truncated to fit the context limit/);
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

describe("Phase 5 relevance and reader regression", () => {
  after(() => restoreFetch());

  const searxngPayload = (results) => jsonResponse({ results });

  test("original-question relevance outranks a query-only match", () => {
    const candidates = [
      { index: 1, title: "Durasol news", url: "https://x.example/news", snippet: "durasol", score: null, engines: [] },
      { index: 2, title: "Durasol facade coating", url: "https://y.example/facade", snippet: "durasol facade aluminium coating", score: null, engines: [] }
    ];
    // Same search query for both; only the original question carries the extra intent.
    const ranked = selectRelevantResults(candidates, "durasol", "durasol facade aluminium coating for buildings", 8);
    assert.deepEqual(ranked.map((r) => r.url), ["https://y.example/facade", "https://x.example/news"]);
  });

  test("selectRelevantResults caps a single domain at two results", () => {
    const candidates = [
      { index: 1, title: "Durasol coating A", url: "https://example.com/a", snippet: "durasol coating guide", score: null, engines: [] },
      { index: 2, title: "Durasol coating B", url: "https://example.com/b", snippet: "durasol coating guide", score: null, engines: [] },
      { index: 3, title: "Durasol coating C", url: "https://example.com/c", snippet: "durasol coating guide", score: null, engines: [] },
      { index: 4, title: "Durasol coating D", url: "https://other.com/d", snippet: "durasol coating guide", score: null, engines: [] }
    ];
    const ranked = selectRelevantResults(candidates, "durasol coating", "durasol coating", 8);
    const urls = ranked.map((r) => r.url);
    assert.equal(urls.filter((u) => u.includes("example.com")).length, 2);
    assert.equal(urls.includes("https://example.com/c"), false);
    assert.equal(urls.includes("https://other.com/d"), true);
  });

  test("readUrl uses the self-hosted Jina Reader first and never leaks the API key to it", async () => {
    const calls = [];
    installFetch(async (url, options) => {
      calls.push({ url: String(url), auth: options?.headers?.authorization || null });
      if (String(url).startsWith("http://jina-reader:8081/")) {
        return jsonResponse({ data: { title: "Local Read", content: "local page content" } });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const config = { ...baseConfig, jina: { ...baseConfig.jina, readerBaseUrl: "http://jina-reader:8081", readerFallbackUrl: "https://r.jina.ai" } };
    const orchestrator = new WebSearchOrchestrator({ config });
    const read = await orchestrator.readUrl({ url: "https://example.com/page" });
    assert.equal(read.ok, true);
    assert.equal(read.content, "local page content");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://jina-reader:8081/https://example.com/page");
    assert.equal(calls[0].auth, null);
  });

  test("readUrl falls back to the hosted reader when the self-hosted reader errors", async () => {
    const calls = [];
    installFetch(async (url, options) => {
      calls.push({ url: String(url), auth: options?.headers?.authorization || null });
      if (String(url).startsWith("http://jina-reader:8081/")) return new Response("reader crashed", { status: 502 });
      if (String(url).startsWith("https://r.jina.ai/")) return jsonResponse({ data: { title: "Hosted Read", content: "hosted page content" } });
      throw new Error(`unexpected URL ${url}`);
    });
    const config = { ...baseConfig, jina: { ...baseConfig.jina, readerBaseUrl: "http://jina-reader:8081", readerFallbackUrl: "https://r.jina.ai" } };
    const orchestrator = new WebSearchOrchestrator({ config });
    const read = await orchestrator.readUrl({ url: "https://example.com/page" });
    assert.equal(read.ok, true);
    assert.equal(read.content, "hosted page content");
    assert.equal(calls[0].url, "http://jina-reader:8081/https://example.com/page");
    assert.equal(calls[1].url, "https://r.jina.ai/https://example.com/page");
    assert.equal(calls[1].auth, "Bearer test-jina-key");
  });

  test("readUrl rejects private, loopback, and link-local targets before any network call", async () => {
    let fetched = false;
    installFetch(async () => { fetched = true; return jsonResponse({}); });
    const config = { ...baseConfig, jina: { ...baseConfig.jina, readerBaseUrl: "http://jina-reader:8081" } };
    const orchestrator = new WebSearchOrchestrator({ config });
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:9000/admin",
      "http://10.0.0.5/",
      "http://192.168.1.1/"
    ]) {
      const read = await orchestrator.readUrl({ url });
      assert.equal(read.ok, false);
      assert.match(read.error.message, /private or internal|blocked/i);
    }
    assert.equal(fetched, false);
  });

  test("isPrivateHostname classifies internal hosts and allows public ones", () => {
    for (const host of ["localhost", "foo.local", "svc.internal", "metadata", "10.1.2.3", "127.0.0.1", "192.168.0.1", "172.16.5.5", "172.31.9.9", "169.254.1.1", "::1"]) {
      assert.equal(isPrivateHostname(host), true, `expected private: ${host}`);
    }
    for (const host of ["example.com", "jina.ai", "8.8.8.8", "172.15.0.1", "172.32.0.1", "sub.domain.co.uk"]) {
      assert.equal(isPrivateHostname(host), false, `expected public: ${host}`);
    }
  });

  test("acceptance: durasol/facade query rejects CNKI, speakers, and YouTube filler", async () => {
    installFetch(async (url) => {
      if (String(url).includes("searxng:8080")) {
        return searxngPayload([
          { url: "https://www.jotun.com/durasol-pvdf-facade", title: "Durasol PVDF vs SDF coatings for aluminium facades", content: "Comparison of PVDF, SDF and Durasol coil coatings for aluminium facade cladding." },
          { url: "https://coatings.example/durasol-4003-tds", title: "Jotun Durasol 4003 TDS", content: "Durasol 4003 PVDF facade coating technical data sheet for aluminium." },
          { url: "https://kns.cnki.net/kcms/detail/123", title: "PVDF ultrafiltration membrane study", content: "Academic research paper on PVDF separation membranes." },
          { url: "https://audiogear.example/pvdf-tweeters", title: "PVDF piezo speakers and tweeters", content: "Best PVDF film speaker drivers for home audio in 2026." },
          { url: "https://support.google.com/youtube/answer/123", title: "Fix YouTube playback issues", content: "Troubleshoot streaming and video quality on YouTube." }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const orchestrator = new WebSearchOrchestrator({ config: { ...baseConfig, primaryProvider: "searxng" } });
    const result = await orchestrator.search({ query: "pvdf vs sdf vs durasol for alu, imiu, facade" });
    const urls = result.results.map((r) => r.url);
    assert.equal(result.ok, true);
    assert.equal(urls.includes("https://www.jotun.com/durasol-pvdf-facade"), true);
    assert.equal(urls.includes("https://coatings.example/durasol-4003-tds"), true);
    assert.equal(urls.some((u) => u.includes("cnki") || u.includes("audiogear") || u.includes("youtube")), false);
  });

  test("acceptance: Jotun Durasol 4003 TDS query returns the data sheet, not academic or video noise", async () => {
    installFetch(async (url) => {
      if (String(url).includes("searxng:8080")) {
        return searxngPayload([
          { url: "https://www.jotun.com/durasol-4003", title: "Jotun Durasol 4003 Technical Data Sheet", content: "Durasol 4003 PVDF coating TDS from Jotun for aluminium facades." },
          { url: "https://kns.cnki.net/durasol-study", title: "Durasol coating academic study", content: "Research on coil coating durability." },
          { url: "https://support.google.com/youtube/answer/999", title: "YouTube help", content: "Fix playback issues." },
          { url: "https://audiogear.example/4003-amp", title: "Model 4003 stereo amplifier", content: "4003 series speaker amplifier review." }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const orchestrator = new WebSearchOrchestrator({ config: { ...baseConfig, primaryProvider: "searxng" } });
    const result = await orchestrator.search({ query: "Jotun Durasol 4003 TDS" });
    const urls = result.results.map((r) => r.url);
    assert.equal(result.ok, true);
    assert.deepEqual(urls, ["https://www.jotun.com/durasol-4003"]);
  });

  test("filterCitationsForAnswer keeps only cited or read sources and caps at eight", () => {
    const results = [
      { index: 1, title: "A", url: "https://a.example/1", snippet: "" },
      { index: 2, title: "B", url: "https://b.example/2", snippet: "" },
      { index: 3, title: "C", url: "https://c.example/3", snippet: "" },
      { index: 4, title: "D", url: "https://d.example/4", snippet: "" }
    ];
    const citations = citationsFromResults(results);
    citations[2].read = true; // the model deep-read source 3 via read_url
    const panel = filterCitationsForAnswer(citations, "The spec is in [2].");
    assert.deepEqual(panel.map((c) => c.url), ["https://b.example/2", "https://c.example/3"]);

    // No source supports the answer -> empty panel (caller omits the Sources block).
    assert.deepEqual(filterCitationsForAnswer(citations.map(({ read, ...c }) => c), "No citations here."), []);

    // Cap at eight even when the answer cites more.
    const many = Array.from({ length: 10 }, (_, i) => ({ index: i + 1, title: `S${i + 1}`, url: `https://s${i + 1}.example/` }));
    const cited = many.map((c) => `[${c.index}]`).join(" ");
    assert.equal(filterCitationsForAnswer(many, cited).length, 8);
  });

  test("read timeout covers a stalled response body, not just headers", async () => {
    // Regression: a reader that returns 200 headers then never sends the body
    // (throttled r.jina.ai) used to hang response.json() — and the whole chat
    // turn — forever, because the old timeout was cleared once headers arrived.
    installFetch(async (url, options) => {
      const signal = options?.signal;
      assert.ok(signal, "fetch must receive an abort signal");
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => {
            controller.error(signal.reason || new DOMException("Aborted", "AbortError"));
          }, { once: true });
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    // AbortSignal.timeout timers are unref'd; hold the test event loop open
    // until the timeout can fire (the real server always has ref'd handles).
    const keepAlive = setTimeout(() => {}, 5000);
    try {
      const started = Date.now();
      await assert.rejects(
        jinaRead({ url: "https://example.com/stalled", apiKey: "k", timeoutMs: 500 }),
        /timed out/i
      );
      assert.ok(Date.now() - started < 5000, "read must fail within the timeout, not hang");
    } finally {
      clearTimeout(keepAlive);
      restoreFetch();
    }
  });
});
