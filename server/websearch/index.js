/**
 * Web search orchestrator. Picks a provider, runs the fallback chain, and
 * reports a normalized result shape regardless of which provider answered.
 *
 * Provider chain (default):
 *   1. SearXNG                  — primary, cheap SERP/snippet discovery
 *   2. Jina  (s.jina.ai)        — fallback, search + extracted content
 *   3. Brave (LLM Context)      — fallback when paid/search providers fail
 *
 * A tiny circuit breaker flips to the fallback for 5 minutes if the
 * primary returns 3 consecutive 5xx/429 within 60 seconds.
 *
 * There is no search cache. Each call hits a provider; queries are not
 * stored or shared across users.
 */

import { braveSearch } from "./brave.js";
import {
  filterDeniedDomains as applyDenyDomainFilter,
  isDeniedUrl,
  mergeDenyDomains
} from "./deny-domains.js";
import { jinaRead, jinaSearch, WebSearchError } from "./jina.js";
import { searxngSearch, selectRelevantResults } from "./searxng.js";

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
      jina: new ProviderHealth("jina"),
      brave: new ProviderHealth("brave")
    };
  }

  get hasAnyProvider() {
    return Boolean(this.config.searxng?.baseUrl || this.config.jina?.apiKey || this.config.brave?.apiKey);
  }

  resolveChain() {
    const providers = ["searxng", "jina", "brave"];
    const requested = providers.includes(this.config.primaryProvider)
      ? this.config.primaryProvider
      : "searxng";
    if (requested === "jina") return ["jina", "brave", "searxng"];
    if (requested === "brave") return ["brave", "searxng", "jina"];
    return ["searxng", "jina", "brave"];
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

    for (const providerName of chain) {
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

        const cleanResults = selectRelevantResults(
          this.filterDeniedDomains(raw.results || []),
          normalizedQuery,
          normalizedQuestion,
          resultLimit
        );
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
   * Direct URL read via r.jina.ai. Falls back to nothing — Brave doesn't
   * expose a generic URL reader. If Jina is unavailable, return an error.
   * Denied hosts are rejected at the request boundary before network,
   * and again on the final URL Jina returns.
   */
  async readUrl({ url, signal }) {
    const denyDomains = this.effectiveDenyDomains();
    if (isDeniedUrl(url, denyDomains)) {
      return denyPolicyError("URL blocked by deny-domain policy.");
    }

    try {
      const data = await jinaRead({
        url,
        apiKey: this.config.jina.apiKey,
        baseUrl: this.config.jina.readerBaseUrl,
        fallbackUrl: this.config.jina.readerFallbackUrl,
        pageContentChars: this.config.pageContentChars,
        timeoutMs: this.config.fetchTimeoutMs,
        signal
      });
      if (isDeniedUrl(data.url, denyDomains)) {
        return denyPolicyError("Final URL blocked by deny-domain policy.");
      }
      const payload = {
        provider: "jina",
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
        : new WebSearchError(error?.message || "URL read failed.", { provider: "jina" });
      return {
        ok: false,
        error: {
          message: wrapped.message,
          status: wrapped.status || null,
          provider: "jina",
          retryable: wrapped.retryable === true
        }
      };
    }
  }

  providerAvailable(name) {
    if (name === "searxng") return Boolean(this.config.searxng?.baseUrl);
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
