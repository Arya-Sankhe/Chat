import { WebSearchError, isAbortError, requestSignal } from "./jina.js";

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for", "from", "how",
  "i", "in", "is", "it", "me", "of", "on", "or", "the", "this", "to", "what", "with", "you"
]);

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 400);
}

function normalizePublishedAt(item) {
  const value = item?.publishedDate || item?.published_at || item?.date || item?.pubdate;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function freshnessToTimeRange(freshness) {
  const value = String(freshness || "").toLowerCase();
  return ["day", "week", "month", "year"].includes(value) ? value : "";
}

function normalizeEngines(engines) {
  const values = Array.isArray(engines) ? engines : String(engines || "").split(",");
  return values.map((entry) => String(entry || "").trim()).filter(Boolean);
}

function terms(value) {
  return [...new Set(
    String(value || "").toLowerCase().match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 2 && !STOPWORDS.has(token)) || []
  )];
}

function resultHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function overlapScore(result, queryTerms, questionTerms, exactQuery) {
  const title = String(result.title || "").toLowerCase();
  const body = `${result.title || ""} ${result.snippet || ""} ${result.url || ""}`.toLowerCase();
  const queryHits = queryTerms.filter((term) => body.includes(term)).length;
  const questionHits = questionTerms.filter((term) => body.includes(term)).length;
  const titleHits = queryTerms.filter((term) => title.includes(term)).length;
  // Cross-engine agreement is a ranking boost, never a requirement.
  const engineBoost = Array.isArray(result.engines) && result.engines.length > 1 ? 1 : 0;
  return {
    queryHits,
    score: queryHits * 3 + titleHits * 2 + Math.min(questionHits, 3) + engineBoost + (exactQuery && body.includes(exactQuery) ? 4 : 0)
  };
}

export function selectRelevantResults(candidates, query, originalQuestion = query, limit = 8) {
  const queryTerms = terms(query).slice(0, 16);
  const questionTerms = terms(originalQuestion).slice(0, 24);
  const exactQuery = normalizeQuery(query).toLowerCase();
  // Queries made of stopwords/short tokens produce no terms; don't filter on them.
  const minHits = queryTerms.length ? (queryTerms.length >= 3 ? 2 : 1) : 0;
  const perHost = new Map();

  return candidates
    .map((result, order) => ({ result, order, ...overlapScore(result, queryTerms, questionTerms, exactQuery) }))
    .filter((entry) => entry.queryHits >= minHits || (exactQuery.length >= 8 && String(entry.result.title || "").toLowerCase().includes(exactQuery)))
    .sort((a, b) => b.score - a.score || Number(b.result.score || 0) - Number(a.result.score || 0) || a.order - b.order)
    .filter(({ result }) => {
      const host = resultHost(result.url);
      const count = perHost.get(host) || 0;
      if (count >= 2) return false;
      perHost.set(host, count + 1);
      return true;
    })
    .slice(0, Math.min(8, Math.max(1, Number(limit) || 5)))
    .map((entry, index) => ({ ...entry.result, index: index + 1 }));
}

export async function searxngSearch({
  query,
  originalQuestion = query,
  numResults = 5,
  lang = "en",
  freshness,
  baseUrl,
  engines = [],
  timeoutMs = 8000,
  signal
}) {
  const searchQuery = normalizeQuery(query);
  if (!searchQuery) {
    throw new WebSearchError("Search query is required.", { status: 400, provider: "searxng" });
  }

  const root = cleanUrl(baseUrl);
  if (!root) {
    throw new WebSearchError("SearXNG base URL is not configured.", { status: 503, provider: "searxng" });
  }

  const params = new URLSearchParams({
    q: searchQuery,
    format: "json",
    categories: "general",
    language: lang || "en",
    safesearch: "2"
  });
  const selectedEngines = normalizeEngines(engines);
  if (selectedEngines.length) params.set("engines", selectedEngines.join(","));
  const timeRange = freshnessToTimeRange(freshness);
  if (timeRange) params.set("time_range", timeRange);

  let response;
  try {
    response = await fetch(`${root}/search?${params}`, {
      headers: {
        accept: "application/json",
        "user-agent": "Klui/1.0 (+https://klui.ai)",
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "127.0.0.1"
      },
      signal: requestSignal(timeoutMs, signal)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WebSearchError(
      isAbortError(error) ? "SearXNG search timed out." : `SearXNG search request failed: ${error?.message || error}`,
      { status: isAbortError(error) ? 504 : 502, provider: "searxng", retryable: true, details: error }
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(
      response.status === 403
        ? "SearXNG rejected JSON search. Enable `search.formats: [html, json]` in settings.yml."
        : `SearXNG search returned ${response.status}.`,
      {
        status: response.status,
        provider: "searxng",
        retryable: response.status >= 500 || response.status === 429,
        details: text.slice(0, 2000)
      }
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error)) {
      throw new WebSearchError("SearXNG search timed out.", { status: 504, provider: "searxng", retryable: true });
    }
    throw new WebSearchError("SearXNG search returned non-JSON.", {
      status: response.status,
      provider: "searxng",
      details: error?.message
    });
  }

  const candidates = [];
  const seenUrls = new Set();
  const limit = Math.min(8, Math.max(1, Number(numResults) || 5));
  for (const item of Array.isArray(payload?.results) ? payload.results : []) {
    if (candidates.length >= Math.max(24, limit * 4)) break;
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    candidates.push({
      index: candidates.length + 1,
      title: String(item.title || url).replace(/\s+/g, " ").trim().slice(0, 300),
      url,
      snippet: String(item.content || item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 500),
      content: "",
      publishedAt: normalizePublishedAt(item),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      engine: String(item.engine || "").trim() || null,
      engines: Array.isArray(item.engines) ? item.engines.map(String) : []
    });
  }

  return {
    provider: "searxng",
    query: searchQuery,
    results: selectRelevantResults(candidates, searchQuery, originalQuestion, limit),
    tokens: null
  };
}
