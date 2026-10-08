import assert from "node:assert/strict";
import test, { describe, before, after } from "node:test";

import { detectSearchNeed, extractUrls } from "../server/websearch/detect.js";
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
  formatResultsForModel,
  readWebPage
} from "../server/websearch/index.js";
import { selectRelevantResults } from "../server/websearch/relevance.js";
import { tinyfishSearch } from "../server/websearch/tinyfish.js";
import { tinyfetchRead } from "../server/websearch/tinyfetch.js";
import { isPrivateHostname, jinaRead } from "../server/websearch/jina.js";
import { answerCitations, onlyPromisesLookup } from "../server/websearch/tool/loop.js";
import {
  buildLoadToolsTool,
  buildWebSearchTools,
  executeToolCall,
  isToolsUnsupportedError,
  runChatWithToolLoop as runChatWithToolLoopImpl
} from "../server/websearch/tool.js";
import { buildDocumentTools } from "../server/documents/tool.js";
import { loadConfig } from "../server/config.js";
import { estimateContextTokens } from "../server/saas/messages.js";
import { buildWeatherTool } from "../server/weather.js";

const realFetch = globalThis.fetch;
const MODEL_PROVIDER = {
  id: "openrouter",
  apiKey: "key",
  baseUrl: "https://openrouter.ai/api/v1",
  label: "OpenRouter"
};
const runChatWithToolLoop = (options) => runChatWithToolLoopImpl({ provider: MODEL_PROVIDER, ...options });

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
  fetchTimeoutMs: 5000,
  maxToolCallsPerTurn: 3,
  denyDomains: [],
  tinyfish: { apiKey: "", apiKeys: [] },
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

  test("internal R2 storage hosts are always denied", () => {
    const deny = mergeDenyDomains([]);
    const kept = filterDeniedDomains([
      { title: "Presigned page image", url: "https://206df89133b849f2cfedd8b52122213f.r2.cloudflarestorage.com/klui-chat/users/u/page.png?X-Amz-Signature=abc" },
      { title: "Bare endpoint", url: "https://r2.cloudflarestorage.com/bucket/key" },
      { title: "Regular site", url: "https://example.com/article" }
    ], deny);
    assert.deepEqual(kept.map((entry) => entry.title), ["Regular site"]);
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

  test("readUrl rejects denied input URLs before network", async () => {
    let fetchCalled = false;
    installFetch(async () => {
      fetchCalled = true;
      throw new Error("network should not run");
    });
    const orch = new WebSearchOrchestrator({ config: baseConfig });
    try {
      const result = await orch.readUrl({ url: "https://www.xvideos.tube/video/1" });
      assert.equal(result.ok, false);
      assert.equal(result.error.provider, "policy");
      assert.equal(result.error.status, 403);
      assert.match(result.error.message, /deny-domain policy/i);
      assert.equal(fetchCalled, false);
    } finally {
      restoreFetch();
    }
  });

  test("readUrl rejects a denied final URL from Jina", async () => {
    installFetch(async (url) => {
      assert.match(String(url), /^https:\/\/r\.jina\.ai\//);
      return jsonResponse({
        data: {
          title: "Redirected",
          url: "https://xvideos.tube/landed",
          content: "should not be returned"
        }
      });
    });
    const orch = new WebSearchOrchestrator({ config: baseConfig });
    try {
      const result = await orch.readUrl({ url: "https://example.com/bounce" });
      assert.equal(result.ok, false);
      assert.equal(result.error.provider, "policy");
      assert.equal(result.error.status, 403);
      assert.match(result.error.message, /Final URL blocked/i);
    } finally {
      restoreFetch();
    }
  });
});

describe("WebSearchOrchestrator", () => {
  after(() => restoreFetch());

  test("config defaults to TinyFish-first, then Brave, then Jina when it has a key", () => {
    const config = loadConfig({});
    assert.equal(config.websearch.primaryProvider, "tinyfish");
    assert.equal(config.websearch.searxng, undefined);
    assert.deepEqual(new WebSearchOrchestrator({ config: config.websearch }).resolveChain(), ["tinyfish", "brave", "jina"]);
    // SearXNG was removed; an old env value falls back to the default.
    assert.equal(loadConfig({ WEBSEARCH_PRIMARY_PROVIDER: "searxng" }).websearch.primaryProvider, "tinyfish");
    assert.equal(config.websearch.fetchTimeoutMs, 20_000);
    assert.equal(config.websearch.pageContentChars, 15_000);
    assert.equal(config.websearch.totalContextChars, 45_000);
    assert.equal(loadConfig({
      WEBSEARCH_PAGE_CONTENT_CHARS: "15000",
      WEBSEARCH_TOTAL_CONTEXT_CHARS: "12000"
    }).websearch.totalContextChars, 15_000);
    assert.equal(config.websearch.dailyLimits, undefined);
  });

  test("TinyFish search uses only the Search API and normalizes results", async () => {
    let capturedUrl;
    let capturedOptions;
    installFetch(async (url, options) => {
      capturedUrl = new URL(String(url));
      capturedOptions = options;
      return jsonResponse({
        query: "latest ai news",
        results: [{ title: "AI update", url: "https://example.com/ai", snippet: "Latest AI news", date: "2026-08-28" }]
      });
    });

    const result = await tinyfishSearch({
      query: "latest ai news",
      originalQuestion: "What is the latest AI news?",
      country: "ae",
      lang: "en",
      freshness: "day",
      apiKey: "secret"
    });

    assert.equal(capturedUrl.origin, "https://api.search.tinyfish.ai");
    assert.equal(capturedUrl.pathname, "/");
    assert.equal(capturedUrl.searchParams.get("query"), "latest ai news");
    assert.equal(capturedUrl.searchParams.get("purpose"), "What is the latest AI news?");
    assert.equal(capturedUrl.searchParams.get("location"), "AE");
    assert.equal(capturedUrl.searchParams.get("recency_minutes"), "1440");
    assert.equal(capturedOptions.headers["x-api-key"], "secret");
    assert.deepEqual(result.results[0], {
      index: 1,
      title: "AI update",
      url: "https://example.com/ai",
      snippet: "Latest AI news",
      content: "",
      publishedAt: "2026-08-28"
    });
  });

  test("TinyFish rate limiting falls back to Brave", async () => {
    installFetch(async (url) => {
      if (String(url).includes("api.search.tinyfish.ai")) return new Response("rate limited", { status: 429 });
      return jsonResponse({
        grounding: { generic: [{ title: "Brave result", url: "https://example.com/brave", snippets: ["fallback query"] }] },
        sources: {}
      });
    });

    const config = { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" } };
    const result = await new WebSearchOrchestrator({ config }).search({ query: "fallback query" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
  });

  test("TinyFish retries the second key before falling back to Brave", async () => {
    const keys = [];
    installFetch(async (url, options) => {
      if (String(url).includes("api.search.tinyfish.ai")) {
        keys.push(options.headers["x-api-key"]);
        if (keys.length === 1) return new Response("rate limited", { status: 429 });
        return jsonResponse({ results: [{ title: "Tiny result", url: "https://example.com/tiny", snippet: "fallback key" }] });
      }
      throw new Error("Brave must not be called when the second TinyFish key works");
    });

    const config = {
      ...baseConfig,
      primaryProvider: "tinyfish",
      tinyfish: { apiKey: "primary-key", apiKeys: ["primary-key", "secondary-key"] }
    };
    const result = await new WebSearchOrchestrator({ config }).search({ query: "fallback key" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "tinyfish");
    assert.deepEqual(keys, ["primary-key", "secondary-key"]);
  });

  test("irrelevant TinyFish results fall through to Brave", async () => {
    installFetch(async (url) => {
      if (String(url).includes("api.search.tinyfish.ai")) {
        return jsonResponse({ results: [{ title: "Weather", url: "https://example.com/weather", snippet: "Rain tomorrow" }] });
      }
      return jsonResponse({
        grounding: { generic: [{ title: "Dubai restaurants", url: "https://example.com/food", snippets: ["Best places to eat in Dubai"] }] },
        sources: {}
      });
    });

    const config = { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" } };
    const result = await new WebSearchOrchestrator({ config }).search({ query: "best places to eat in Dubai" });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "brave");
  });

  test("Search filters generic retail and dictionary noise from local intent searches", async () => {
    installFetch(async () => jsonResponse({
      results: [
        {
          url: "https://www.cntravellerme.com/story/best-beachfront-restaurants-dubai",
          title: "The 23 best beachfront restaurants in Dubai",
          snippet: "Seafood spots, beach clubs, and restaurants around Dubai."
        },
        {
          url: "https://www.bestbuy.com/",
          title: "Best Buy | Official Online Store | Shop Now & Save",
          snippet: "Shop electronics, appliances, and deals."
        },
        {
          url: "https://dictionary.cambridge.org/dictionary/english/best",
          title: "BEST | English meaning - Cambridge Dictionary",
          snippet: "Meaning of best in English."
        },
        {
          url: "https://seafoodslurps.com/best-seafood-buffet-dubai",
          title: "2026 Ranked: Best Seafood Buffet in Dubai",
          snippet: "A Dubai seafood buffet guide with restaurant picks."
        },
        {
          url: "https://wordreference.com/definition/best",
          title: "best - WordReference.com Dictionary of English",
          snippet: "Dictionary entry."
        }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" }, brave: { apiKey: "" } };
    const orchestrator = new WebSearchOrchestrator({ config });
    const result = await orchestrator.search({ query: "best seafood restuarents dubai?", numResults: 5 });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.results.map((entry) => new URL(entry.url).hostname.replace(/^www\./, "")),
      ["seafoodslurps.com", "cntravellerme.com"]
    );
    assert.deepEqual(result.results.map((entry) => entry.index), [1, 2]);
  });

  test("Search keeps Reddit-style results while dropping generic shopping noise", async () => {
    installFetch(async () => jsonResponse({
      results: [
        {
          url: "https://www.bestbuy.com/",
          title: "Best Buy | Official Online Store | Shop Now & Save",
          snippet: "Shop electronics."
        },
        {
          url: "https://www.reddit.com/r/fragrance/comments/cheap_perfume/",
          title: "What is your best cheap perfume that gets so many compliments?",
          snippet: "Reddit users discuss budget fragrances for men."
        },
        {
          url: "https://dictionary.cambridge.org/dictionary/english/top",
          title: "TOP | English meaning - Cambridge Dictionary",
          snippet: "Meaning of top in English."
        },
        {
          url: "https://shop.topsmarkets.com/",
          title: "Tops Markets Delivery or Pickup Near Me",
          snippet: "Grocery delivery."
        },
        {
          url: "https://www.reddit.com/r/AskMen/comments/affordable_fragrance/",
          title: "Which perfumes smell great but aren't expensive?",
          snippet: "Men recommend affordable perfume and fragrance options."
        },
        {
          url: "https://www.canva.com/",
          title: "Canva: Visual Suite for Everyone",
          snippet: "Design anything."
        }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" }, brave: { apiKey: "" } };
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

  test("relevance filter prefers app-development sources over generic GitHub and word noise", () => {
    const candidates = [
          {
            url: "https://restaurantji.com/ga/chatsworth/",
            title: "THE 15 BEST Restaurants in Chatsworth, GA - With Menus, Reviews",
            snippet: "Restaurant menus and local food reviews."
          },
          {
            url: "https://fontawesome.com/",
            title: "Font Awesome",
            snippet: "Icon library and toolkit."
          },
          {
            url: "https://mrmrsenglish.com/100-synonyms-for-awesome/",
            title: "100 Synonyms for Awesome in English with their Pictures",
            snippet: "Vocabulary examples."
          },
          {
            url: "https://cdnjs.com/libraries/font-awesome",
            title: "font-awesome - Libraries - cdnjs - The #1 free and open source CDN",
            snippet: "CDN assets for Font Awesome."
          },
          {
            url: "https://github.com/",
            title: "GitHub · Change is constant. GitHub keeps you ahead.",
            snippet: "GitHub homepage."
          },
          {
            url: "https://www.linkedin.com/company/github",
            title: "GitHub - LinkedIn",
            snippet: "Company profile."
          },
          {
            url: "https://github.dev/",
            title: "github.dev - Visual Studio Code for the Web",
            snippet: "Open GitHub repositories in a browser editor."
          },
          {
            url: "https://github.com/capacitor-community/awesome-capacitor",
            title: "GitHub - capacitor-community/awesome-capacitor: A curated list of Capacitor plugins",
            snippet: "A repository for Capacitor plugins and resources for Android, iOS, and mobile app development."
          },
          {
            url: "https://github.com/topics/mobile-app-development",
            title: "mobile-app-development · GitHub Topics",
            snippet: "GitHub repositories for Android, iOS, React Native, Flutter, Expo, and mobile app development."
          },
          {
            url: "https://docs.expo.dev/",
            title: "Expo Documentation",
            snippet: "Build native Android and iOS apps with React Native, Expo, and app development tools."
          },
          {
            url: "https://capacitorjs.com/docs",
            title: "Capacitor Documentation",
            snippet: "Capacitor lets web developers build native iOS and Android apps from one codebase."
          }
    ];
    const query = "Can you find me the best skills on a GitHub repo for making an Android app or iOS app, just like an app in general? The best GitHub skills to have the best design and code quality for making and building apps through AI agents.";
    const results = selectRelevantResults(candidates, query, query, 8);

    assert.deepEqual(new Set(results.map((entry) => entry.url)), new Set([
      "https://github.com/capacitor-community/awesome-capacitor",
      "https://github.com/topics/mobile-app-development",
      "https://docs.expo.dev/",
      "https://capacitorjs.com/docs",
      // Kept: github.dev genuinely matches github+repo+code. The word noise (restaurants,
      // synonyms, font icons) and generic GitHub/LinkedIn landing pages are still rejected.
      "https://github.dev/"
    ]));
    assert.equal(results.length, 5);
  });

  test("Search rejects filler that matches too few query terms instead of returning it", async () => {
    installFetch(async () => jsonResponse({
      results: [
        { url: "https://example.com/a", title: "Kettle overview", content: "Product page." },
        { url: "https://example.org/b", title: "Thermostat guide", content: "How it works." },
        { url: "https://sample.net/c", title: "Warranty info", content: "Coverage details." },
        { url: "https://demo.io/d", title: "Manual download", content: "PDF resource." }
      ]
    }));

    const config = { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" }, brave: { apiKey: "" } };
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

  test("repeat queries hit the provider again and are not cached", async () => {
    let calls = 0;
    installFetch(async () => {
      calls += 1;
      return jsonResponse({ data: [{ url: "https://a.example/1", title: "A", description: "duplicate query", content: "duplicate query" }] });
    });
    const orchestrator = new WebSearchOrchestrator({ config: baseConfig });
    const first = await orchestrator.search({ query: "duplicate query" });
    const second = await orchestrator.search({ query: "duplicate query" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.cached, false);
    assert.equal(second.cached, false);
    assert.equal(calls, 2);
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

  test("circuit breaker flips to fallback after consecutive 5xx", async () => {
    let jinaCalls = 0;
    installFetch(async (url) => {
      if (String(url).includes("s.jina.ai")) {
        jinaCalls += 1;
        return new Response("err", { status: 500 });
      }
      return jsonResponse({ results: [{ url: "https://x", title: "B", description: "q0 q1 q2 after cooldown" }] });
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

  test("runChatWithToolLoop sends the same tools on every step of a turn, including the final answer", async () => {
    const tools = [...buildWebSearchTools(), ...buildDocumentTools()];
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: { format: "docx", title: "Summary", content: "Complete summary." }
          })]);
        }
        return streamResponse([contentDelta("The document is ready.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "attach it" }], tools, tool_choice: "auto" },
      modelClient,
      config: {
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 1, maxToolResultChars: 5000 }
      },
      signal: new AbortController().signal,
      websearch: null,
      documents: {
        async createDocument() {
          return { ok: true, output: { attachment_id: "att-1", document_file_id: "doc-1", file_name: "Summary.docx", kind: "docx", status: "ready" } };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.equal(bodies.length, 2);
    for (const body of bodies) assert.deepEqual(body.tools, tools);
    // The tool limit is reached: the final answer keeps the tools; only the message asks for no tool call.
    assert.equal("tool_choice" in bodies[1], false);
    assert.equal(result.artifacts[0].attachment_id, "att-1");
    assert.equal(result.accumulated.content, "The document is ready.");
  });

  test("load_tools adds the document tools for the rest of the turn", async () => {
    const webTools = buildWebSearchTools();
    const documentTools = buildDocumentTools();
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) return streamResponse([toolCallDelta({ name: "load_tools", args: {} })]);
        if (bodies.length === 2) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: { format: "docx", title: "Notes", content: "Notes." }
          })]);
        }
        return streamResponse([contentDelta("Your file is ready.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "save that as a word doc" }], tools: [...webTools, buildLoadToolsTool()], tool_choice: "auto" },
      modelClient,
      config: {
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 3, maxToolResultChars: 5000 }
      },
      signal: new AbortController().signal,
      websearch: null,
      deferredTools: documentTools,
      documents: {
        async createDocument() {
          return { ok: true, output: { attachment_id: "att-1", document_file_id: "doc-1", file_name: "Notes.docx", kind: "docx", status: "ready" } };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.deepEqual(bodies[0].tools.map((tool) => tool.function.name), [...webTools.map((tool) => tool.function.name), "load_tools"]);
    assert.deepEqual(bodies[1].tools, [...webTools, ...documentTools]);
    assert.deepEqual(bodies[2].tools, [...webTools, ...documentTools]);
    assert.equal(result.artifacts[0].attachment_id, "att-1");
    assert.equal(result.accumulated.content, "Your file is ready.");
  });

  test("runChatWithToolLoop rejects a false refusal and requires document creation", async () => {
    const tools = buildDocumentTools();
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (bodies.length === 1) {
          return streamResponse([contentDelta("I cannot create or attach a DOCX because the available tools are read-only.")]);
        }
        if (bodies.length === 2) {
          return streamResponse([toolCallDelta({
            name: "create_document",
            args: { format: "docx", title: "Summary", content: "Complete summary." }
          })]);
        }
        return streamResponse([contentDelta("The document is ready.")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "attach it" }],
        tools,
        tool_choice: "auto"
      },
      modelClient,
      config: {
        websearch: { maxToolCallsPerTurn: 0 },
        documents: { maxToolCallsPerTurn: 2, maxToolResultChars: 5000 }
      },
      signal: new AbortController().signal,
      websearch: null,
      documents: {
        async createDocument() {
          return {
            ok: true,
            output: {
              attachment_id: "att-rescued",
              document_file_id: "doc-rescued",
              file_name: "Summary.docx",
              kind: "docx",
              status: "ready"
            }
          };
        }
      },
      onUpstreamEvent: () => {}
    });

    assert.deepEqual(bodies[1].tools, tools);
    assert.equal(bodies[1].tool_choice, "required");
    assert.equal(result.artifacts[0].attachment_id, "att-rescued");
    assert.equal(result.accumulated.content, "The document is ready.");
  });

  test("runChatWithToolLoop degrades tool-less when tools are rejected on a turn that asked for no file", async () => {
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if ("tool_choice" in body || "tools" in body) {
          throw new Error("This model does not support tools.");
        }
        return streamResponse([contentDelta("Plain answer")]);
      }
    };

    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "inclusionai/ling-3.0-flash",
        messages: [{ role: "user", content: "hello" }],
        tools: [...buildDocumentTools(), ...buildWebSearchTools()],
        tool_choice: "auto"
      },
      artifactRequested: false,
      modelClient,
      config: {
        websearch: { maxToolCallsPerTurn: 3 },
        documents: { maxToolCallsPerTurn: 3, maxToolResultChars: 5000 }
      },
      provider: { id: "openrouter", apiKey: "k", baseUrl: "https://openrouter.ai/api/v1" },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      documents: {},
      onUpstreamEvent: () => {}
    });

    // Listed document tools must not force a document-model switch or a throw.
    assert.equal(result.accumulated.content, "Plain answer");
    assert.equal(bodies.every((body) => body.model === "inclusionai/ling-3.0-flash"), true);
    assert.equal("tools" in bodies.at(-1), false);
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
    const modelClient = {
      async streamChatCompletion() {
        return streamResponse([contentDelta("Hi")]);
      }
    };
    const result = await runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "ping" }] },
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 3 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      onUpstreamEvent: () => {}
    });
    assert.equal(result.accumulated.content, "Hi");
    assert.equal(result.toolCallCount, 0);
  });

  test("runChatWithToolLoop corrects fake document download handoffs into real artifact calls", async () => {
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: {
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

  test("runChatWithToolLoop leaves a reading answer about a document alone", async () => {
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        return streamResponse([contentDelta("The receipt document you created was updated: owner Niko Vale, budget USD 934.80.")]);
      }
    };
    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "read the receipt and tell me the owner" }],
        tools: buildDocumentTools({ toolNames: ["read_document"] }),
        tool_choice: "auto"
      },
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 2, maxToolResultChars: 5000 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      documents: { async createDocument() { throw new Error("a reading turn must not create a file"); } },
      artifactRequested: false,
      onUpstreamEvent: () => {}
    });
    assert.equal(bodies.length, 1);
    assert.match(result.accumulated.content, /Niko Vale/);
    assert.equal(result.artifacts.length, 0);
  });

  test("a turn makes at most one new file", async () => {
    let call = 0;
    const exports = [];
    const result = await runChatWithToolLoop({
      chatRequest: {
        model: "test",
        messages: [{ role: "user", content: "create a pdf out of the above info" }],
        tools: buildDocumentTools({ toolNames: ["create_document", "export_document"] }),
        tool_choice: "auto"
      },
      modelClient: {
        async streamChatCompletion() {
          call += 1;
          if (call === 1) return streamResponse([toolCallDelta({ name: "create_document", args: { format: "pdf", title: "Pricing", content: "x" } })]);
          if (call === 2) return streamResponse([toolCallDelta({ name: "export_document", args: { attachment_id: "att-1", target_format: "docx" } })]);
          return streamResponse([contentDelta("Done.")]);
        }
      },
      config: { websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 4, maxToolResultChars: 5000 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "n/a" } }) },
      documents: {
        async createDocument() {
          return { ok: true, output: { attachment_id: "att-1", file_name: "Pricing.pdf", kind: "pdf", status: "ready" } };
        },
        async exportDocument(args) {
          exports.push(args);
          return { ok: true, output: { attachment_id: "att-2", file_name: "Pricing.docx", kind: "docx", status: "ready" } };
        }
      },
      onUpstreamEvent: () => {}
    });
    assert.equal(exports.length, 0);
    assert.deepEqual(result.artifacts.map((artifact) => artifact.file_name), ["Pricing.pdf"]);
  });

  test("document promises execute the artifact tool instead of ending the turn", async () => {
    for (const promise of ["I'll create the deck now.", "I’m creating the PowerPoint now.", "Let me prepare the document."]) {
      const tools = buildDocumentTools({ toolNames: ["create_document"] });
      const bodies = [];
      const result = await runChatWithToolLoop({
        chatRequest: { model: "test", messages: [{ role: "user", content: "create me on the topic machine learning" }], tools },
        modelClient: { async streamChatCompletion({ body }) {
          bodies.push(body);
          if (bodies.length === 1) return streamResponse([contentDelta(promise)]);
          if (bodies.length === 2) return streamResponse([toolCallDelta({ name: "create_document", args: { format: "pptx", title: "Machine learning", content: "Complete teaching content." } })]);
          return streamResponse([contentDelta("Created the presentation.")]);
        } },
        config: { documents: { maxToolCallsPerTurn: 2, maxToolResultChars: 5000 } },
        documents: { async createDocument() { return { ok: true, output: { attachment_id: "real-ppt", kind: "pptx", status: "ready" } }; } },
        onUpstreamEvent() {}
      });
      assert.equal(bodies[1].tool_choice, "required");
      assert.deepEqual(bodies[1].tools.map((t) => t.function.name), ["create_document"]);
      assert.equal(result.toolCallCount, 1);
      assert.equal(result.artifacts[0].attachment_id, "real-ppt");
    }
  });

  test("a repeated creation promise without a file surfaces a failure", async () => {
    await assert.rejects(runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "Make a PPT" }], tools: buildDocumentTools({ toolNames: ["create_document"] }) },
      modelClient: { async streamChatCompletion() { return streamResponse([contentDelta("I'll create the deck now.")]); } },
      config: { documents: { maxToolCallsPerTurn: 2 } }, documents: {}, onUpstreamEvent() {}
    }), /stopped without creating the requested document/);
  });

  test("a concrete document creation failure can still be explained after recovery", async () => {
    let attempts = 0;
    const result = await runChatWithToolLoop({
      chatRequest: { model: "test", messages: [{ role: "user", content: "Make a PPT" }], tools: buildDocumentTools({ toolNames: ["create_document"] }) },
      modelClient: { async streamChatCompletion() { return streamResponse([contentDelta(++attempts === 1 ? "I'll create the deck now." : "I cannot create the PPT because the document service is unavailable.")]); } },
      config: { documents: { maxToolCallsPerTurn: 2 } }, documents: {}, onUpstreamEvent() {}
    });
    assert.match(result.accumulated.content, /document service is unavailable/);
    assert.equal(result.artifacts.length, 0);
  });

  test("runChatWithToolLoop routes through the supplied provider override", async () => {
    const seenAuth = [];
    const modelClient = {
      async streamChatCompletion({ apiKey, baseUrl, providerId, body }) {
        seenAuth.push({ apiKey, baseUrl, providerId, body });
        return streamResponse([contentDelta("ok")]);
      }
    };

    await runChatWithToolLoop({
      chatRequest: {
        model: "xiaomi/mimo-v2.6-flash",
        messages: [{ role: "user", content: "ping" }],
        reasoning_effort: "high"
      },
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 3 } },
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

  test("runChatWithToolLoop forces a final answer after the tool-call cap", async () => {
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch,
      onUpstreamEvent: () => {}
    });

    assert.equal(result.accumulated.content, "Final answer");
    assert.equal(result.toolCallCount, 1);
    assert.deepEqual(result.providers, ["jina"]);
    // Same tools as before, so the cached prompt still matches.
    assert.equal("tool_choice" in bodies[1], false);
    assert.deepEqual(bodies[1].tools, bodies[0].tools);
  });

  test("runChatWithToolLoop resets provisional prose before the final tool answer", async () => {
    const toolEvents = [];
    let calls = 0;
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: {
        search: async () => ({ ok: true, provider: "tinyfish", query: "latest", results: [] })
      },
      onUpstreamEvent: () => {},
      onToolEvent: (event) => toolEvents.push(event)
    });

    assert.equal(result.accumulated.content, "Here is the complete answer.");
    assert.equal(toolEvents[0].type, "response:reset");
  });

  test("runChatWithToolLoop retries once with no tool call allowed when the model returns no answer", async () => {
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: { search: async () => ({ ok: false, error: { message: "unused" } }) },
      onUpstreamEvent: () => {},
      onToolEvent: () => {}
    });

    assert.equal(bodies.length, 2);
    assert.equal("tool_choice" in bodies[1], false);
    assert.deepEqual(bodies[1].tools, bodies[0].tools);
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
    const modelClient = {
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
        model: "xiaomi/mimo-v2.6-flash",
        messages: [{ role: "user", content: "compare prices" }],
        tools: buildWebSearchTools(),
        tool_choice: "auto"
      },
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 3 } },
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
    const modelClient = {
      async streamChatCompletion({ body }) {
        bodies.push(body);
        if (body.model !== "deepseek/deepseek-v4-flash-0731") {
          throw new Error("This model does not support tools.");
        }
        if (bodies.filter((entry) => entry.model === "deepseek/deepseek-v4-flash-0731").length === 1) {
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
        model: "inclusionai/ling-3.0-flash",
        messages: [{ role: "user", content: "create a pdf" }],
        tools: buildDocumentTools({ toolNames: ["create_document"] }),
        tool_choice: "auto"
      },
      modelClient,
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
    assert.equal(bodies.at(-1).model, "deepseek/deepseek-v4-flash-0731");
  });

  test("runChatWithToolLoop drops only tool_choice when the provider still supports tools", async () => {
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
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
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
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

  test("artifact turns keep web search available and pass retrieved evidence to the slide writer", async () => {
    let rounds = 0;
    const documents = { async createDocument() {
      assert.match(this.deckEvidence, /source text/);
      return { ok: true, output: { attachment_id: "file", file_name: "report.pptx", format: "pptx" } };
    } };
    const client = { async streamChatCompletion({ body }) {
      rounds += 1;
      if (rounds === 1) return streamResponse([toolCallDelta()]);
      if (rounds === 2) {
        assert.deepEqual(body.tools.map((tool) => tool.function.name), ["web_search", "read_url", "create_document"]);
        return streamResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "create", type: "function", function: { name: "create_document", arguments: '{"format":"pptx","title":"Report","content":"source text"}' } }] }, finish_reason: "tool_calls" }] }]);
      }
      // Search is still offered after the file exists, with budget left.
      assert.deepEqual(body.tools.map((tool) => tool.function.name), ["web_search", "read_url", "create_document"]);
      return streamResponse([contentDelta("Created")]);
    } };
    const result = await runChatWithToolLoop({ chatRequest: { model: "test", messages: [{ role: "user", content: "Create a PPT" }],
      tools: [...buildWebSearchTools(), ...buildDocumentTools({ toolNames: ["create_document"] })] },
      modelClient: client, config: { websearch: { maxToolCallsPerTurn: 4 } }, documents,
      websearch: { search: async () => ({ ok: true, provider: "jina", results: [{ index: 1, title: "Reference", url: "https://example.org", snippet: "source text", content: "source text" }] }) },
      onUpstreamEvent: () => {}, onToolEvent: (event) => { if (event.type === "tool:error") throw new Error(event.error?.message); } });
    assert.equal(result.toolCallCount, 2);
    assert.equal(result.artifacts.length, 1);
  });

  test("pages a document editor looked up reach the chat's sources with matching numbers", async () => {
    let rounds = 0;
    let toolResult = null;
    const documents = { async editDocument() {
      return { ok: true, output: { attachment_id: "file", file_name: "report.pdf", kind: "pdf", web_sources: [{ index: 1, title: "Official prices", url: "https://example.org/prices", snippet: "s" }] } };
    } };
    const client = { async streamChatCompletion({ body }) {
      rounds += 1;
      if (rounds === 1) return streamResponse([toolCallDelta()]);
      if (rounds === 2) return streamResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "edit", type: "function", function: { name: "edit_document", arguments: '{"attachment_id":"file","instructions":"update the prices"}' } }] }, finish_reason: "tool_calls" }] }]);
      toolResult = JSON.parse(body.messages.at(-1).content);
      return streamResponse([contentDelta("Updated the prices [2].")]);
    } };
    const result = await runChatWithToolLoop({ chatRequest: { model: "test", messages: [{ role: "user", content: "Update the prices" }],
      tools: [...buildWebSearchTools(), ...buildDocumentTools({ toolNames: ["edit_document"] })] },
      modelClient: client, config: { websearch: { maxToolCallsPerTurn: 4 } }, documents,
      websearch: { search: async () => ({ ok: true, provider: "jina", results: [{ index: 1, title: "Reference", url: "https://example.com/ref", snippet: "s", content: "s" }] }) },
      onUpstreamEvent: () => {} });
    assert.deepEqual(toolResult.output.web_sources, [{ marker: "[2]", title: "Official prices", url: "https://example.org/prices" }]);
    const cited = result.citations.find((citation) => citation.url === "https://example.org/prices");
    assert.equal(cited.index, 2);
    assert.equal(cited.marker, "[2]");
  });

  test("runChatWithToolLoop retries once then errors if force-final still returns tool calls", async () => {
    let searchCalls = 0;
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: { websearch: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: {
        search: async () => {
          searchCalls += 1;
          return { ok: true, provider: "tinyfish", query: "latest", results: [] };
        }
      },
      onUpstreamEvent: () => {}
    }), /did not provide a final answer/);

    assert.equal(searchCalls, 1);
    assert.equal(bodies.length, 3);
    // Asked for no tool call first; a model that calls one anyway gets the tools removed.
    assert.deepEqual(bodies[1].tools, bodies[0].tools);
    assert.equal("tools" in bodies[2], false);
  });

  test("runChatWithToolLoop bounds large tool results before the next provider call", async () => {
    const bodies = [];
    const modelClient = {
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
      modelClient,
      config: {
        context: { maxTokens: 2000 },
        websearch: { maxToolCallsPerTurn: 1 }
      },
      signal: new AbortController().signal,
      websearch: {
        search: async () => ({
          ok: true,
          provider: "tinyfish",
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
    const modelClient = {
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
      modelClient,
      config: {
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
      const modelClient = {
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
        modelClient,
        config: {
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
      const modelClient = {
        async streamChatCompletion({ body }) {
          if (!modelClient.calls) modelClient.calls = 0;
          modelClient.calls += 1;
          if (modelClient.calls === 1) {
            return streamResponse([toolCallDelta({
              name: "read_document",
              args: { attachment_id: "00000000-0000-4000-8000-000000000004", page_start: 1, page_end: 3 }
            })]);
          }
          modelClient.lastBody = body;
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
        modelClient,
        config: {
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

      const visualMessage = modelClient.lastBody.messages.find((message) => (
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
      const modelClient = {
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
        modelClient,
        config: {
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

  const tinyfishPayload = (results) => jsonResponse({ results });

  test("original-question relevance outranks a query-only match", () => {
    const candidates = [
      { index: 1, title: "Durasol news", url: "https://x.example/news", snippet: "durasol", score: null, engines: [] },
      { index: 2, title: "Durasol facade coating", url: "https://y.example/facade", snippet: "durasol facade aluminium coating", score: null, engines: [] }
    ];
    // Same search query for both; only the original question carries the extra intent.
    const ranked = selectRelevantResults(candidates, "durasol", "durasol facade aluminium coating for buildings", 8);
    assert.deepEqual(ranked.map((r) => r.url), ["https://y.example/facade", "https://x.example/news"]);
  });

  test("whole-token relevance rejects substring matches from generic search noise", () => {
    const ranked = selectRelevantResults([
      {
        title: "BEST Definition & Meaning - Merriam-Webster",
        url: "https://www.merriam-webster.com/dictionary/best",
        snippet: "In the best of all possible worlds, no one would be without food and water."
      },
      {
        title: "THE 10 BEST Restaurants in Kigali",
        url: "https://www.tripadvisor.com/Restaurants-g293829-Kigali_Kigali_Province.html",
        snippet: "Best Dining in Kigali: traveler reviews of Kigali restaurants."
      },
      {
        title: "Best places to eat in Dubai",
        url: "https://visit.example/dubai-restaurants",
        snippet: "A Dubai guide to places to eat and the best restaurants."
      }
    ], "best places to eat in Dubai", "best places to eat in Dubai", 5);

    assert.deepEqual(ranked.map((entry) => entry.url), ["https://visit.example/dubai-restaurants"]);
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

  test("tinyfetchRead normalizes a TinyFetch markdown response", async () => {
    let captured = null;
    installFetch(async (url, options) => {
      captured = { url: String(url), body: JSON.parse(options.body), key: options.headers["x-api-key"] };
      return jsonResponse({
        results: [{ url: "https://example.com/a", final_url: "https://example.com/a?x=1", title: "Page A", text: "# A\n\nBody." }],
        errors: []
      });
    });
    const page = await tinyfetchRead({ url: "https://example.com/a", apiKey: "key-1" });
    assert.equal(captured.url, "https://api.fetch.tinyfish.ai");
    assert.deepEqual(captured.body, { urls: ["https://example.com/a"], format: "markdown", per_url_timeout_ms: 8000 });
    assert.equal(captured.key, "key-1");
    assert.deepEqual(page, {
      provider: "tinyfetch",
      url: "https://example.com/a?x=1",
      title: "Page A",
      content: "# A\n\nBody.",
      publishedAt: null
    });
  });

  test("tinyfetchRead surfaces per-URL failures", async () => {
    installFetch(async () => jsonResponse({ results: [], errors: [{ url: "https://example.com/a", error: "blocked" }] }));
    await assert.rejects(
      () => tinyfetchRead({ url: "https://example.com/a", apiKey: "key-1" }),
      /blocked/
    );
  });

  test("tinyfetchRead treats empty text as a failed read", async () => {
    installFetch(async () => jsonResponse({ results: [{ url: "https://example.com/a", text: "   " }], errors: [] }));
    await assert.rejects(
      () => tinyfetchRead({ url: "https://example.com/a", apiKey: "key-1" }),
      (error) => error.status === 502 && /no content/i.test(error.message)
    );
  });

  test("tinyfetchRead maps a stalled JSON body abort to a timeout", async () => {
    installFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
    }));
    await assert.rejects(
      () => tinyfetchRead({ url: "https://example.com/a", apiKey: "key-1" }),
      (error) => error.status === 504 && error.retryable === true && /timed out/i.test(error.message)
    );
  });

  test("tinyfetchRead rethrows a caller abort during JSON parse", async () => {
    const controller = new AbortController();
    installFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        controller.abort();
        throw new DOMException("The operation was aborted.", "AbortError");
      }
    }));
    await assert.rejects(
      () => tinyfetchRead({ url: "https://example.com/a", apiKey: "key-1", signal: controller.signal }),
      (error) => error.name === "AbortError"
    );
  });

  test("readUrl prefers TinyFetch and skips Jina entirely on success", async () => {
    const calls = [];
    installFetch(async (url) => {
      calls.push(String(url));
      if (String(url).includes("api.fetch.tinyfish.ai")) {
        return jsonResponse({ results: [{ url: "https://example.com/a", title: "Fetched A", text: "tinyfetch body" }], errors: [] });
      }
      throw new Error(`Jina must not be called when TinyFetch works: ${url}`);
    });
    const config = { ...baseConfig, tinyfish: { apiKey: "key-1", apiKeys: ["key-1"] } };
    const read = await new WebSearchOrchestrator({ config }).readUrl({ url: "https://example.com/a" });
    assert.equal(read.ok, true);
    assert.equal(read.provider, "tinyfetch");
    assert.equal(read.content, "tinyfetch body");
    assert.equal(calls.length, 1);
  });

  test("readUrl tries each TinyFetch key, then the Jina readers", async () => {
    const keys = [];
    const calls = [];
    installFetch(async (url, options) => {
      calls.push(String(url));
      if (String(url).includes("api.fetch.tinyfish.ai")) {
        keys.push(options.headers["x-api-key"]);
        return new Response("limited", { status: 429 });
      }
      if (String(url).startsWith("http://jina-reader:8081/")) return new Response("reader crashed", { status: 502 });
      if (String(url).startsWith("https://r.jina.ai/")) return jsonResponse({ data: { title: "Hosted Read", content: "hosted page content" } });
      throw new Error(`unexpected URL ${url}`);
    });
    const config = {
      ...baseConfig,
      tinyfish: { apiKey: "key-1", apiKeys: ["key-1", "key-2", "key-3"] },
      jina: { ...baseConfig.jina, readerBaseUrl: "http://jina-reader:8081", readerFallbackUrl: "https://r.jina.ai" }
    };
    const read = await new WebSearchOrchestrator({ config }).readUrl({ url: "https://example.com/a" });
    assert.equal(read.ok, true);
    assert.equal(read.provider, "jina");
    assert.equal(read.content, "hosted page content");
    assert.deepEqual(keys, ["key-1", "key-2", "key-3"]);
    assert.equal(calls.at(-2), "http://jina-reader:8081/https://example.com/a");
    assert.equal(calls.at(-1), "https://r.jina.ai/https://example.com/a");
  });

  test("readUrl falls through to Jina when TinyFetch returns empty text", async () => {
    const keys = [];
    installFetch(async (url, options) => {
      if (String(url).includes("api.fetch.tinyfish.ai")) {
        keys.push(options.headers["x-api-key"]);
        return jsonResponse({ results: [{ url: "https://example.com/a", title: "Empty", text: "" }], errors: [] });
      }
      if (String(url).startsWith("https://r.jina.ai/")) {
        return jsonResponse({ data: { title: "Hosted Read", content: "hosted page content" } });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const config = { ...baseConfig, tinyfish: { apiKey: "key-1", apiKeys: ["key-1", "key-2"] } };
    const read = await new WebSearchOrchestrator({ config }).readUrl({ url: "https://example.com/a" });
    assert.equal(read.ok, true);
    assert.equal(read.provider, "jina");
    assert.equal(read.content, "hosted page content");
    assert.deepEqual(keys, ["key-1"]);
  });

  test("readUrl skips remaining TinyFetch keys after a timeout and uses Jina", async () => {
    const keys = [];
    installFetch(async (url, options) => {
      if (String(url).includes("api.fetch.tinyfish.ai")) {
        keys.push(options.headers["x-api-key"]);
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      if (String(url).startsWith("https://r.jina.ai/")) {
        return jsonResponse({ data: { title: "Hosted Read", content: "hosted page content" } });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const config = { ...baseConfig, tinyfish: { apiKey: "key-1", apiKeys: ["key-1", "key-2", "key-3"] } };
    const read = await new WebSearchOrchestrator({ config }).readUrl({ url: "https://example.com/a" });
    assert.equal(read.ok, true);
    assert.equal(read.provider, "jina");
    assert.equal(read.content, "hosted page content");
    assert.deepEqual(keys, ["key-1"]);
  });

  test("readUrl rejects private, loopback, and link-local targets before any network call", async () => {
    let fetched = false;
    installFetch(async () => { fetched = true; return jsonResponse({}); });
    const config = {
      ...baseConfig,
      tinyfish: { apiKey: "key-1", apiKeys: ["key-1", "key-2"] },
      jina: { ...baseConfig.jina, readerBaseUrl: "http://jina-reader:8081" }
    };
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

  test("readWebPage refuses hosts that resolve to non-public addresses", async () => {
    let fetched = false;
    installFetch(async () => { fetched = true; return jsonResponse({}); });
    const config = { ...baseConfig, tinyfish: { apiKey: "key-1", apiKeys: ["key-1"] } };
    await assert.rejects(
      () => readWebPage({ url: "https://no-such-host.invalid/", config, timeoutMs: 5000, maxChars: 1000 }),
      /non-public/
    );
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
      if (String(url).includes("api.search.tinyfish.ai")) {
        return tinyfishPayload([
          { url: "https://www.jotun.com/durasol-pvdf-facade", title: "Durasol PVDF vs SDF coatings for aluminium facades", snippet: "Comparison of PVDF, SDF and Durasol coil coatings for aluminium facade cladding." },
          { url: "https://coatings.example/durasol-4003-tds", title: "Jotun Durasol 4003 TDS", snippet: "Durasol 4003 PVDF facade coating technical data sheet for aluminium." },
          { url: "https://kns.cnki.net/kcms/detail/123", title: "PVDF ultrafiltration membrane study", snippet: "Academic research paper on PVDF separation membranes." },
          { url: "https://audiogear.example/pvdf-tweeters", title: "PVDF piezo speakers and tweeters", snippet: "Best PVDF film speaker drivers for home audio in 2026." },
          { url: "https://support.google.com/youtube/answer/123", title: "Fix YouTube playback issues", snippet: "Troubleshoot streaming and video quality on YouTube." }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const orchestrator = new WebSearchOrchestrator({ config: { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" }, brave: { apiKey: "" } } });
    const result = await orchestrator.search({ query: "pvdf vs sdf vs durasol for alu, imiu, facade" });
    const urls = result.results.map((r) => r.url);
    assert.equal(result.ok, true);
    assert.equal(urls.includes("https://www.jotun.com/durasol-pvdf-facade"), true);
    assert.equal(urls.includes("https://coatings.example/durasol-4003-tds"), true);
    assert.equal(urls.some((u) => u.includes("cnki") || u.includes("audiogear") || u.includes("youtube")), false);
  });

  test("acceptance: Jotun Durasol 4003 TDS query returns the data sheet, not academic or video noise", async () => {
    installFetch(async (url) => {
      if (String(url).includes("api.search.tinyfish.ai")) {
        return tinyfishPayload([
          { url: "https://www.jotun.com/durasol-4003", title: "Jotun Durasol 4003 Technical Data Sheet", snippet: "Durasol 4003 PVDF coating TDS from Jotun for aluminium facades." },
          { url: "https://kns.cnki.net/durasol-study", title: "Durasol coating academic study", snippet: "Research on coil coating durability." },
          { url: "https://support.google.com/youtube/answer/999", title: "YouTube help", snippet: "Fix playback issues." },
          { url: "https://audiogear.example/4003-amp", title: "Model 4003 stereo amplifier", snippet: "4003 series speaker amplifier review." }
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const orchestrator = new WebSearchOrchestrator({ config: { ...baseConfig, primaryProvider: "tinyfish", tinyfish: { apiKey: "test-tinyfish-key" }, brave: { apiKey: "" } } });
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

  test("answer sources read grouped markers and fall back to top results when uncited", () => {
    const search = (offset, n) => Array.from({ length: n }, (_, i) => ({
      index: offset + i + 1, rank: i + 1, title: `S${offset + i + 1}`, url: `https://s${offset + i + 1}.example/`
    }));
    const web = [...search(0, 4), ...search(4, 4)];
    assert.deepEqual(filterCitationsForAnswer(web, "Prices [1, 3] and [5-6][8].").map((c) => c.index), [1, 3, 5, 6, 8]);

    // Three searches, no markers: the panel keeps each search's best results, not nothing.
    const shown = answerCitations([...web, { type: "document", index: 99, title: "Doc" }], "Plain answer.");
    assert.deepEqual(shown.map((c) => c.index), [1, 5, 2, 6, 3, 99]);
    assert.equal(shown.some((c) => c.read), false);
    assert.equal(shown.filter((c) => c.type !== "document").every((c) => c.searched === true), true, "uncited results are flagged as search results");

    // Cited answers still show only what they cite.
    assert.deepEqual(answerCitations(web, "See [2].").map((c) => c.index), [2]);
    assert.equal(answerCitations(web, "See [2].")[0].searched, undefined);
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

test("tool page images stay within one total cap across reads, oldest swapped for a note", async () => {
  let calls = 0;
  const bodies = [];
  const modelClient = {
    async streamChatCompletion({ body }) {
      calls += 1;
      bodies.push(body);
      if (calls <= 3) {
        return streamResponse([toolCallDelta({
          id: `call_${calls}`,
          name: "read_document",
          args: { attachment_id: "00000000-0000-4000-8000-000000000009", page_start: calls * 3 - 2, page_end: calls * 3 }
        })]);
      }
      return streamResponse([contentDelta("done.")]);
    }
  };
  let read = 0;
  const documents = {
    async read() {
      read += 1;
      const pages = [1, 2, 3].map((offset) => (read - 1) * 3 + offset);
      return {
        ok: true,
        provider: "documents",
        results: [],
        citations: [],
        visualPages: pages.map((page, i) => ({ index: i + 1, page_id: `p${page}`, page_number: page, title: `Page ${page}`, url: `https://signed.example/page-${page}.jpg` }))
      };
    }
  };
  await runChatWithToolLoop({
    chatRequest: { model: "gpt-5-vision", messages: [{ role: "user", content: "read it" }], tools: [], tool_choice: "auto" },
    modelClient,
    config: { websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 5, maxToolResultChars: 5000, visualMaxImageInputsPerTurn: 4 } },
    signal: new AbortController().signal,
    websearch: {},
    documents,
    visualDocuments: true,
    onUpstreamEvent: () => {}
  });
  const images = (body) => body.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .filter((part) => part?.type === "image_url").map((part) => part.image_url.url);
  // 3 → 4 → 4 images, never 3 → 6 → 9; the newest pages are the ones kept.
  assert.deepEqual(bodies.slice(1).map((body) => images(body).length), [3, 4, 4]);
  assert.deepEqual(images(bodies[3]).map((url) => url.match(/page-(\d+)/)[1]), ["6", "7", "8", "9"]);
  const notes = JSON.stringify(bodies[3].messages);
  assert.match(notes, /Page 1: its image was removed to keep this request small/);
  assert.match(notes, /Page 5: its image was removed/);
});

test("a reply that only promises a lookup is nudged once to make the tool call", async () => {
  const bodies = [];
  const events = [];
  const replies = [
    [contentDelta("One sec, let me look up the score.")],
    [toolCallDelta({ args: { query: "arsenal score" } })],
    [contentDelta("Arsenal won two nil.")]
  ];
  const result = await runChatWithToolLoop({
    chatRequest: { model: "m", messages: [{ role: "user", content: "arsenal score?" }], tools: buildWebSearchTools({ maxResults: 3 }) },
    modelClient: { async streamChatCompletion({ body }) { bodies.push(body); return streamResponse(replies[bodies.length - 1]); } },
    config: { websearch: { maxToolCallsPerTurn: 4 }, documents: { maxToolCallsPerTurn: 0 } },
    signal: new AbortController().signal,
    websearch: { search: async () => ({ ok: true, provider: "jina", results: [{ index: 1, title: "T", url: "https://u", snippet: "s", content: "c" }] }) },
    onUpstreamEvent: () => {},
    onToolEvent: (event) => events.push(event.type)
  });
  assert.equal(result.accumulated.content, "Arsenal won two nil.");
  assert.equal(result.toolCallCount, 1);
  assert.equal(bodies[1].messages.at(-2).content, "One sec, let me look up the score.");
  assert.match(bodies[1].messages.at(-1).content, /call the tool now/);
  assert.deepEqual(events.slice(0, 2), ["response:reset", "response:reset"]);
});

test("only a short announcement counts as a promised lookup", () => {
  assert.equal(onlyPromisesLookup("Let me check the latest Arsenal results.\n\n"), true);
  assert.equal(onlyPromisesLookup("Sure, I'll search for that."), true);
  assert.equal(onlyPromisesLookup("Let me know if you need more."), false);
  assert.equal(onlyPromisesLookup("Let me explain how it works."), false);
  assert.equal(onlyPromisesLookup("Let me check: Max won. Hamilton was second. Then the season went on."), false);
});

test("a model call that reasons without answering is retried once with the same request", async () => {
  const bodies = [];
  const events = [];
  const modelClient = {
    async streamChatCompletion({ body, signal }) {
      bodies.push(body);
      if (bodies.length === 1) {
        // Streams reasoning and never starts the answer until aborted.
        return {
          body: new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: "thinking…" } }] })}\n\n`));
              signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
            }
          })
        };
      }
      return streamResponse([contentDelta("SCAN-0O1I-719")]);
    }
  };
  const result = await runChatWithToolLoop({
    chatRequest: { model: "mimo", messages: [{ role: "user", content: "codes?" }], tools: [], reasoning_effort: "high" },
    modelClient,
    config: { context: { answerStallMs: 30 }, websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 1 } },
    signal: new AbortController().signal,
    websearch: {},
    onUpstreamEvent: () => {},
    onToolEvent: (event) => events.push(event)
  });
  assert.equal(result.accumulated.content, "SCAN-0O1I-719");
  assert.equal(bodies.length, 2);
  // Same reasoning and no output cap: the retry is the same request again.
  assert.deepEqual(bodies[1], bodies[0]);
  assert.ok(events.some((event) => event.reason === "answer-stalled"));
});

test("a second stalled call ends the turn with a clear error, and a user cancel is not retried", async () => {
  const stalling = (counter) => ({
    async streamChatCompletion({ signal }) {
      counter.calls += 1;
      return {
        body: new ReadableStream({
          start(controller) { signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }); }
        })
      };
    }
  });
  const base = {
    chatRequest: { model: "mimo", messages: [{ role: "user", content: "codes?" }], tools: [] },
    config: { context: { answerStallMs: 20 }, websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 1 } },
    websearch: {},
    onUpstreamEvent: () => {}
  };
  const twice = { calls: 0 };
  await assert.rejects(
    runChatWithToolLoop({ ...base, modelClient: stalling(twice), signal: new AbortController().signal }),
    /stopped responding/
  );
  assert.equal(twice.calls, 2);

  const cancelled = { calls: 0 };
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(runChatWithToolLoop({
    ...base,
    config: { ...base.config, context: { answerStallMs: 60_000 } },
    modelClient: stalling(cancelled),
    signal: controller.signal
  }));
  assert.equal(cancelled.calls, 1);
});

test("a call that hangs before its headers or mid-answer is stopped and retried", async () => {
  const run = async (firstCall) => {
    const bodies = [];
    const modelClient = {
      async streamChatCompletion({ body, signal }) {
        bodies.push(body);
        if (bodies.length === 1) return firstCall(signal);
        return streamResponse([contentDelta("done")]);
      }
    };
    const result = await runChatWithToolLoop({
      chatRequest: { model: "mimo", messages: [{ role: "user", content: "codes?" }], tools: [] },
      modelClient,
      config: { context: { answerStallMs: 60_000, answerIdleMs: 30 }, websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 1 } },
      signal: new AbortController().signal,
      websearch: {},
      onUpstreamEvent: () => {}
    });
    return { result, bodies };
  };
  const hangAfter = (delta) => (signal) => ({
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`));
        signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      }
    })
  });

  // Some answer text, then silence.
  const text = await run(hangAfter({ content: "The first code is" }));
  assert.equal(text.result.accumulated.content, "done");
  assert.deepEqual(text.bodies[1], text.bodies[0]);
  // A tool-call fragment, then silence.
  const tool = await run(hangAfter({ tool_calls: [{ index: 0, id: "c1", function: { name: "read_document", arguments: "{\"attach" } }] }));
  assert.equal(tool.result.accumulated.content, "done");

  // No response headers at all: the start limit covers the wait for them.
  const bodies = [];
  const result = await runChatWithToolLoop({
    chatRequest: { model: "mimo", messages: [{ role: "user", content: "codes?" }], tools: [] },
    modelClient: {
      async streamChatCompletion({ body, signal }) {
        bodies.push(body);
        if (bodies.length === 1) {
          return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
        }
        return streamResponse([contentDelta("done")]);
      }
    },
    config: { context: { answerStallMs: 30 }, websearch: { maxToolCallsPerTurn: 0 }, documents: { maxToolCallsPerTurn: 1 } },
    signal: new AbortController().signal,
    websearch: {},
    onUpstreamEvent: () => {}
  });
  assert.equal(result.accumulated.content, "done");
  assert.equal(bodies.length, 2);
});

test("a secondary TinyFish key alone enables web search and Deep Research", async () => {
  const { configuredServices } = await import("../server/config.js");
  const services = configuredServices(loadConfig({
    TINYFISH_API_KEY_2: "second-key",
    OPENROUTER_API_KEY: "or-key",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    RESEARCH_ENABLED: "true"
  }));
  assert.equal(services.websearch, true);
  assert.equal(services.research, true);
});
