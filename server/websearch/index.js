/**
 * Web search orchestrator. Picks a provider, runs the fallback chain, and
 * reports a normalized result shape regardless of which provider answered.
 *
 * TinyFish is the default web_search provider, followed by self-hosted
 * SearXNG and Brave. read_url uses TinyFetch, then Jina Reader.
 *
 * A tiny circuit breaker pauses a provider for 5 minutes after 3 consecutive
 * 5xx/429 responses within 60 seconds.
 *
 * There is no search cache. Each call hits a provider; queries are not
 * stored or shared across users.
 */

import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { braveSearch } from "./brave.js";
import {
  filterDeniedDomains as applyDenyDomainFilter,
  isDeniedUrl,
  mergeDenyDomains
} from "./deny-domains.js";
import { jinaRead, jinaSearch, WebSearchError, clampContent, isPrivateHostname } from "./jina.js";
import { searxngSearch, selectRelevantResults } from "./searxng.js";
import { tinyfetchRead } from "./tinyfetch.js";
import { tinyfishSearch } from "./tinyfish.js";

export {
  BUILTIN_ADULT_DENY_DOMAINS,
  filterDeniedDomains,
  isDeniedUrl,
  mergeDenyDomains
} from "./deny-domains.js";

function denyPolicyError(message = "URL blocked by deny-domain policy.") {
  return {
    ok: false,
    error: {
      message,
      provider: "policy",
      status: 403
    }
  };
}

async function resolvesToPublicAddress(hostname) {
  let addresses;
  try {
    addresses = await dns.lookup(String(hostname || ""), { all: true });
  } catch {
    return false;
  }
  if (!addresses.length) return false;
  return addresses.every(({ address }) => {
    try {
      let parsed = ipaddr.parse(address);
      if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
      return parsed.range() === "unicast";
    } catch {
      return false;
    }
  });
}

/**
 * Read a web page through the shared reader chain: TinyFetch (each
 * configured key in order), then the self-hosted Jina Reader, then the
 * hosted Jina Reader (both inside jinaRead). Returns jina-shaped
 * { provider, url, title, content, publishedAt }.
 */
export async function readWebPage({ url, config, signal, timeoutMs, maxChars } = {}) {
  const websearch = config?.websearch || config;
  let parsed;
  try {
    parsed = new URL(String(url || ""));
  } catch {
    throw new WebSearchError("URL is invalid.", { status: 400, provider: "reader" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebSearchError("Only http(s) URLs are supported.", { status: 400, provider: "reader" });
  }
  // Refuse private/loopback hosts before TinyFetch (third-party) or the
  // self-hosted Jina reader. Short-TTL rebinding can still slip the gap
  // between this DNS check and the reader's fetch — isolate the reader
  // container's network if that matters.
  if (isPrivateHostname(parsed.hostname)) {
    throw new WebSearchError("URL points to a private or internal address.", { status: 400, provider: "reader" });
  }
  if (!(await resolvesToPublicAddress(parsed.hostname))) {
    throw new WebSearchError("URL resolved to a non-public address.", { status: 400, provider: "reader" });
  }

  const keys = (Array.isArray(websearch?.tinyfish?.apiKeys) ? websearch.tinyfish.apiKeys : [websearch?.tinyfish?.apiKey]).filter(Boolean);
  for (const apiKey of keys) {
    try {
      const page = await tinyfetchRead({ url, apiKey, timeoutMs, signal });
      return { ...page, content: clampContent(page.content, maxChars) };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error?.status !== 401 && error?.status !== 429) break;
    }
  }
  return jinaRead({
    url,
    apiKey: websearch?.jina?.apiKey,
    baseUrl: websearch?.jina?.readerBaseUrl,
    fallbackUrl: websearch?.jina?.readerFallbackUrl,
    pageContentChars: maxChars,
    timeoutMs,
    signal
  });
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000;

class ProviderHealth {
  constructor(name) {
    this.name = name;
    this.failures = [];
    this.cooldownUntil = 0;
  }

  isHealthy(now = Date.now()) {
    if (this.cooldownUntil > now) return false;
    return true;
  }

  recordSuccess() {
    this.failures = [];
    this.cooldownUntil = 0;
  }

  recordFailure(now = Date.now()) {
    this.failures = this.failures.filter((ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS);
    this.failures.push(now);
    if (this.failures.length >= CIRCUIT_BREAKER_THRESHOLD) {
      this.cooldownUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
      this.failures = [];
    }
  }
}

export class WebSearchOrchestrator {
  /**
   * @param {object} options
   * @param {object} options.config - config.websearch slice
   */
  constructor({ config } = {}) {
    this.config = config;
    this.health = {
      searxng: new ProviderHealth("searxng"),
      tinyfish: new ProviderHealth("tinyfish"),
      jina: new ProviderHealth("jina"),
      brave: new ProviderHealth("brave")
    };
  }

  get hasAnyProvider() {
    return Boolean(this.config.searxng?.baseUrl || this.tinyfishApiKeys().length || this.config.jina?.apiKey || this.config.brave?.apiKey);
  }

  tinyfishApiKeys() {
    const configured = Array.isArray(this.config.tinyfish?.apiKeys)
      ? this.config.tinyfish.apiKeys
      : [this.config.tinyfish?.apiKey];
    return [...new Set(configured.map((key) => String(key || "").trim()).filter(Boolean))];
  }

  resolveChain() {
    const providers = ["searxng", "tinyfish", "jina", "brave"];
    const requested = providers.includes(this.config.primaryProvider)
      ? this.config.primaryProvider
      : "tinyfish";
    if (requested === "jina") return ["jina", "brave", "searxng"];
    if (requested === "brave") return ["brave", "searxng", "jina"];
    if (requested === "tinyfish") return ["tinyfish", "searxng", "brave"];
    return ["searxng", "tinyfish", "brave"];
  }

  effectiveDenyDomains() {
    return mergeDenyDomains(this.config.denyDomains);
  }

  filterDeniedDomains(results) {
    return applyDenyDomainFilter(results, this.effectiveDenyDomains());
  }

  /**
   * Run a search through the provider chain with circuit breaker.
   * Always returns a result object — never throws to the caller. Failures
   * surface as { ok: false, error }.
   */
  async search({ query, originalQuestion = query, numResults, freshness, country, lang, location, signal }) {
    if (!this.hasAnyProvider) {
      return {
        ok: false,
        error: { message: "Web search is not configured on the server.", provider: "none" }
      };
    }

    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    const normalizedQuestion = typeof originalQuestion === "string" ? originalQuestion.trim() : normalizedQuery;
    const resultLimit = Math.min(8, numResults || this.config.maxResults);
    if (!normalizedQuery) {
      return {
        ok: false,
        error: { message: "Search query is required.", provider: "none" }
      };
    }

    const chain = this.resolveChain();
    let lastError = null;

    for (const [providerIndex, providerName] of chain.entries()) {
      if (!this.providerAvailable(providerName)) continue;
      const healthy = this.health[providerName].isHealthy();
      if (!healthy) {
        lastError = {
          message: `Provider ${providerName} is in cooldown.`,
          provider: providerName
        };
        continue;
      }

      try {
        const raw = await this.callProvider(providerName, {
          query: normalizedQuery,
          originalQuestion: normalizedQuestion,
          numResults: resultLimit,
          freshness,
          country,
          lang,
          location,
          signal
        });

        // SearXNG returns HTTP 200 even when every selected upstream engine is
        // suspended. Only spend the paid fallback in that explicit case.
        if (providerName === "searxng" && !(raw.results || []).length) {
          const unavailable = Array.isArray(raw.unresponsiveEngines) ? raw.unresponsiveEngines : [];
          const selected = Array.isArray(this.config.searxng?.engines) ? this.config.searxng.engines : [];
          const unavailableNames = new Set(unavailable.map((entry) => Array.isArray(entry) ? entry[0] : entry?.engine || entry?.name));
          if (selected.length && selected.every((name) => unavailableNames.has(name))) {
            throw new WebSearchError("All configured SearXNG engines are unavailable.", {
              status: 502,
              provider: "searxng",
              retryable: true,
              details: unavailable
            });
          }
        }

        const cleanResults = selectRelevantResults(
          this.filterDeniedDomains(raw.results || []),
          normalizedQuery,
          normalizedQuestion,
          resultLimit
        );
        if (!cleanResults.length && chain.slice(providerIndex + 1).some((name) => this.providerAvailable(name))) {
          continue;
        }
        const payload = {
          query: raw.query,
          provider: providerName,
          results: cleanResults,
          tokens: raw.tokens || null,
          fetchedAt: new Date().toISOString()
        };
        this.health[providerName].recordSuccess();
        return { ok: true, cached: false, ...payload };
      } catch (error) {
        const wrapped = error instanceof WebSearchError
          ? error
          : new WebSearchError(error?.message || "Provider failed.", { provider: providerName });

        if (wrapped.retryable || (wrapped.status && wrapped.status >= 500) || wrapped.status === 429) {
          this.health[providerName].recordFailure();
        }

        lastError = {
          message: wrapped.message,
          status: wrapped.status || null,
          provider: providerName,
          retryable: wrapped.retryable === true
        };

        if (signal?.aborted) break;
      }
    }

    return { ok: false, error: lastError || { message: "All search providers failed.", provider: "none" } };
  }

  /**
   * Direct URL read through the shared reader chain (TinyFetch, then
   * self-hosted Jina Reader, then hosted Jina Reader). Denied hosts are
   * rejected at the request boundary before network, and again on the
   * final URL the reader returns.
   */
  async readUrl({ url, signal }) {
    const denyDomains = this.effectiveDenyDomains();
    if (isDeniedUrl(url, denyDomains)) {
      return denyPolicyError("URL blocked by deny-domain policy.");
    }

    try {
      const data = await readWebPage({
        url,
        config: this.config,
        maxChars: this.config.pageContentChars,
        timeoutMs: this.config.fetchTimeoutMs,
        signal
      });
      if (isDeniedUrl(data.url, denyDomains)) {
        return denyPolicyError("Final URL blocked by deny-domain policy.");
      }
      const payload = {
        provider: data.provider,
        url: data.url,
        title: data.title,
        content: data.content,
        publishedAt: data.publishedAt,
        fetchedAt: new Date().toISOString()
      };
      return { ok: true, cached: false, ...payload };
    } catch (error) {
      const wrapped = error instanceof WebSearchError
        ? error
        : new WebSearchError(error?.message || "URL read failed.", { provider: "reader" });
      return {
        ok: false,
        error: {
          message: wrapped.message,
          status: wrapped.status || null,
          provider: wrapped.provider || "reader",
          retryable: wrapped.retryable === true
        }
      };
    }
  }

  providerAvailable(name) {
    if (name === "searxng") return Boolean(this.config.searxng?.baseUrl);
    if (name === "tinyfish") return this.tinyfishApiKeys().length > 0;
    /* s.jina.ai (search) requires an API key. r.jina.ai (reader) is the
       only Jina endpoint with a real anonymous tier, so readUrl can still
       call Jina without a key — but plain search cannot. */
    if (name === "jina") return Boolean(this.config.jina?.apiKey);
    if (name === "brave") return Boolean(this.config.brave?.apiKey);
    return false;
  }

  async callProvider(name, params) {
    if (name === "searxng") {
      return searxngSearch({
        ...params,
        baseUrl: this.config.searxng.baseUrl,
        engines: this.config.searxng.engines,
        timeoutMs: this.config.fetchTimeoutMs
      });
    }
    if (name === "tinyfish") {
      let lastError;
      for (const apiKey of this.tinyfishApiKeys()) {
        try {
          return await tinyfishSearch({ ...params, apiKey, timeoutMs: this.config.fetchTimeoutMs });
        } catch (error) {
          lastError = error;
          if (params.signal?.aborted) throw error;
        }
      }
      throw lastError || new WebSearchError("TinyFish Search API key is not configured.", { provider: "tinyfish" });
    }
    if (name === "jina") {
      return jinaSearch({
        ...params,
        engine: this.config.jina.engine,
        apiKey: this.config.jina.apiKey,
        pageContentChars: this.config.pageContentChars,
        totalContextChars: this.config.totalContextChars,
        timeoutMs: this.config.fetchTimeoutMs
      });
    }
    if (name === "brave") {
      return braveSearch({
        ...params,
        apiKey: this.config.brave.apiKey,
        pageContentChars: this.config.pageContentChars,
        totalContextChars: this.config.totalContextChars,
        timeoutMs: this.config.fetchTimeoutMs
      });
    }
    throw new WebSearchError(`Unknown provider: ${name}`, { provider: name });
  }
}

/* ── helpers used by the orchestrator + tool runner ── */

export function formatResultsForModel(results) {
  if (!Array.isArray(results) || !results.length) {
    return "No search results.";
  }
  return results
    .map((entry) => {
      const lines = [
        entry.title,
        `URL: ${entry.url}`,
        entry.publishedAt ? `Published: ${entry.publishedAt}` : null,
        entry.snippet ? `Snippet: ${entry.snippet}` : null,
        entry.content ? `Content:\n${entry.content}` : null
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

export function citationsFromResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((entry) => ({
    index: entry.index,
    title: entry.title,
    url: entry.url,
    snippet: entry.snippet || "",
    publishedAt: entry.publishedAt || null
  }));
}

export function filterCitationsForAnswer(citations, content, limit = 8) {
  const cited = new Set(
    [...String(content || "").matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]))
  );
  const seen = new Set();
  return (Array.isArray(citations) ? citations : [])
    .filter((citation) => citation?.read === true || cited.has(Number(citation?.index)))
    .filter((citation) => {
      try {
        const url = new URL(citation.url);
        if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) return false;
        seen.add(url.href);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, Math.min(8, Math.max(0, Number(limit) || 0)));
}
