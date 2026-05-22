/**
 * Web search orchestrator. Picks a provider, handles caching, runs the
 * fallback chain, and reports a normalized result shape regardless of
 * which provider answered.
 *
 * Provider chain (default):
 *   1. Jina  (s.jina.ai)        — primary, search + extracted content in one call
 *   2. Brave (LLM Context)      — fallback when Jina fails or is rate-limited
 *
 * A tiny circuit breaker flips to the fallback for 5 minutes if the
 * primary returns 3 consecutive 5xx/429 within 60 seconds.
 */

import { braveSearch } from "./brave.js";
import { hashKey, SearchCache } from "./cache.js";
import { jinaRead, jinaSearch, WebSearchError } from "./jina.js";

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
   * @param {object} options.config              - config.websearch slice
   * @param {object} [options.persistentCache]   - optional { get, set } backing
   *                                                store (Supabase REST)
   */
  constructor({ config, persistentCache = null } = {}) {
    this.config = config;
    this.cache = new SearchCache({
      maxEntries: config.cacheMaxEntries,
      ttlMs: config.cacheTtlSeconds * 1000,
      persistent: persistentCache
    });
    this.health = {
      jina: new ProviderHealth("jina"),
      brave: new ProviderHealth("brave")
    };
  }

  get hasAnyProvider() {
    return Boolean(this.config.jina.apiKey || this.config.brave.apiKey);
  }

  resolveChain() {
    const requested = this.config.primaryProvider === "brave" ? "brave" : "jina";
    const primary = this.providerAvailable(requested)
      ? requested
      : (requested === "jina" ? "brave" : "jina");
    const fallback = primary === "jina" ? "brave" : "jina";
    return [primary, fallback];
  }

  filterDeniedDomains(results) {
    const deny = this.config.denyDomains || [];
    if (!deny.length) return results;
    return results.filter((entry) => {
      try {
        const host = new URL(entry.url).hostname.toLowerCase();
        return !deny.some((domain) => host === domain || host.endsWith(`.${domain}`));
      } catch {
        return true;
      }
    });
  }

  /**
   * Run a search through the provider chain with caching + circuit breaker.
   * Always returns a result object — never throws to the caller. Failures
   * surface as { ok: false, error }.
   */
  async search({ query, numResults, freshness, country, lang, location, signal }) {
    if (!this.hasAnyProvider) {
      return {
        ok: false,
        error: { message: "Web search is not configured on the server.", provider: "none" }
      };
    }

    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    if (!normalizedQuery) {
      return {
        ok: false,
        error: { message: "Search query is required.", provider: "none" }
      };
    }

    const cacheKey = hashKey({
      kind: "search",
      query: normalizedQuery.toLowerCase(),
      numResults: numResults || this.config.maxResults,
      freshness: freshness || null,
      country: country || "us",
      lang: lang || "en"
    });

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return { ok: true, cached: true, ...cached };
    }

    /* `beforeNetwork` is invoked exactly once before any provider call.
       The orchestrator caller uses this to charge the per-user quota
       only on real network hits (cache hits stay free). */
    if (typeof this.beforeNetwork === "function") {
      try {
        await this.beforeNetwork({ query: normalizedQuery });
      } catch (error) {
        return {
          ok: false,
          error: {
            message: error?.message || "Search not permitted.",
            provider: "quota",
            status: error?.status || 429
          }
        };
      }
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
          numResults: numResults || this.config.maxResults,
          freshness,
          country,
          lang,
          location,
          signal
        });

        const cleanResults = this.filterDeniedDomains(raw.results || []);
        const payload = {
          query: raw.query,
          provider: providerName,
          results: cleanResults,
          tokens: raw.tokens || null,
          fetchedAt: new Date().toISOString()
        };
        this.health[providerName].recordSuccess();
        await this.cache.set(cacheKey, payload, { query: normalizedQuery, provider: providerName });
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
   */
  async readUrl({ url, signal }) {
    const cacheKey = hashKey({ kind: "read", url });
    const cached = await this.cache.get(cacheKey);
    if (cached) return { ok: true, cached: true, ...cached };

    if (typeof this.beforeNetwork === "function") {
      try {
        await this.beforeNetwork({ url });
      } catch (error) {
        return {
          ok: false,
          error: {
            message: error?.message || "Read not permitted.",
            provider: "quota",
            status: error?.status || 429
          }
        };
      }
    }

    try {
      const data = await jinaRead({
        url,
        apiKey: this.config.jina.apiKey,
        pageContentChars: this.config.pageContentChars,
        timeoutMs: this.config.fetchTimeoutMs,
        signal
      });
      const payload = {
        provider: "jina",
        url: data.url,
        title: data.title,
        content: data.content,
        publishedAt: data.publishedAt,
        fetchedAt: new Date().toISOString()
      };
      await this.cache.set(cacheKey, payload, { query: url, provider: "jina-read" });
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
    /* s.jina.ai (search) requires an API key. r.jina.ai (reader) is the
       only Jina endpoint with a real anonymous tier, so readUrl can still
       call Jina without a key — but plain search cannot. */
    if (name === "jina") return Boolean(this.config.jina.apiKey);
    if (name === "brave") return Boolean(this.config.brave.apiKey);
    return false;
  }

  async callProvider(name, params) {
    if (name === "jina") {
      return jinaSearch({
        ...params,
        backend: this.config.jina.backend,
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
        `[${entry.index}] ${entry.title}`,
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
