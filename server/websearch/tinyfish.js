import { WebSearchError, isAbortError, requestSignal } from "./jina.js";

const ENDPOINT = "https://api.search.tinyfish.ai";
const requestTimes = [];

function reserveRequest(now = Date.now()) {
  while (requestTimes.length && now - requestTimes[0] >= 60_000) requestTimes.shift();
  if (requestTimes.length >= 30) return false;
  requestTimes.push(now);
  return true;
}

function freshnessMinutes(value) {
  return { day: 1440, week: 10_080, month: 43_200, year: 525_600 }[value] || null;
}

export async function tinyfishSearch({
  query,
  originalQuestion = query,
  numResults = 5,
  country,
  lang,
  freshness,
  apiKey,
  timeoutMs = 8000,
  signal
}) {
  const searchQuery = String(query || "").trim().replace(/\s+/g, " ").slice(0, 400);
  if (!searchQuery) {
    throw new WebSearchError("Search query is required.", { status: 400, provider: "tinyfish" });
  }
  if (!apiKey) {
    throw new WebSearchError("TinyFish Search API key is not configured.", { status: 503, provider: "tinyfish" });
  }
  // ponytail: process-local guard matches today's single app container; TinyFish's
  // own HTTP 429 remains authoritative if the same key is later shared elsewhere.
  if (!reserveRequest()) {
    throw new WebSearchError("TinyFish search rate limit reached.", {
      status: 429,
      provider: "tinyfish",
      retryable: true
    });
  }

  const params = new URLSearchParams({ query: searchQuery });
  const purpose = String(originalQuestion || "").trim().slice(0, 2000);
  if (purpose && purpose !== searchQuery) params.set("purpose", purpose);
  if (country) params.set("location", String(country).trim().toUpperCase());
  if (lang) params.set("language", String(lang).trim().toLowerCase());
  const recency = freshnessMinutes(freshness);
  if (recency) params.set("recency_minutes", String(recency));

  let response;
  try {
    response = await fetch(`${ENDPOINT}?${params}`, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: requestSignal(timeoutMs, signal)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new WebSearchError(
      isAbortError(error) ? "TinyFish search timed out." : `TinyFish search request failed: ${error?.message || error}`,
      { status: isAbortError(error) ? 504 : 502, provider: "tinyfish", retryable: true, details: error }
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(`TinyFish search returned ${response.status}.`, {
      status: response.status,
      provider: "tinyfish",
      retryable: response.status === 429 || response.status >= 500,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new WebSearchError("TinyFish search returned non-JSON.", {
      status: response.status,
      provider: "tinyfish",
      details: error?.message
    });
  }

  const limit = Math.min(8, Math.max(1, Number(numResults) || 5));
  const results = [];
  for (const item of Array.isArray(payload?.results) ? payload.results : []) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url) continue;
    results.push({
      index: results.length + 1,
      title: String(item.title || url).replace(/\s+/g, " ").trim().slice(0, 300),
      url,
      snippet: String(item.snippet || "").replace(/\s+/g, " ").trim().slice(0, 500),
      content: "",
      publishedAt: typeof item.date === "string" && item.date.trim() ? item.date.trim() : null
    });
    if (results.length >= limit) break;
  }

  return { provider: "tinyfish", query: payload?.query || searchQuery, results, tokens: null };
}
