import { WebSearchError } from "./jina.js";

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

async function withTimeout(timeoutMs, fn, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function normalizePublishedAt(item) {
  const value = item?.publishedDate || item?.published_at || item?.date || item?.pubdate;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function freshnessToTimeRange(freshness) {
  if (!freshness || freshness === "any") return "";
  const normalized = String(freshness).toLowerCase();
  return ["day", "week", "month", "year"].includes(normalized) ? normalized : "";
}

function normalizeEngines(engines) {
  if (Array.isArray(engines)) return engines.map((entry) => String(entry || "").trim()).filter(Boolean);
  return String(engines || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Search through an internal SearXNG instance. This is intentionally a
 * SERP/snippet provider only; exact page extraction stays with read_url.
 */
export async function searxngSearch({
  query,
  numResults = 5,
  lang = "en",
  freshness,
  baseUrl,
  engines = [],
  timeoutMs = 8000,
  signal
}) {
  if (typeof query !== "string" || !query.trim()) {
    throw new WebSearchError("Search query is required.", { status: 400, provider: "searxng" });
  }

  const root = cleanUrl(baseUrl);
  if (!root) {
    throw new WebSearchError("SearXNG base URL is not configured.", { status: 503, provider: "searxng" });
  }

  const params = new URLSearchParams({
    q: query.trim().slice(0, 400),
    format: "json",
    categories: "general",
    language: lang || "en"
  });

  const selectedEngines = normalizeEngines(engines);
  if (selectedEngines.length) params.set("engines", selectedEngines.join(","));

  const timeRange = freshnessToTimeRange(freshness);
  if (timeRange) params.set("time_range", timeRange);

  let response;
  try {
    response = await withTimeout(timeoutMs, (innerSignal) => fetch(`${root}/search?${params.toString()}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "Klui/1.0 (+https://klui.ai)",
        "x-forwarded-for": "127.0.0.1",
        "x-real-ip": "127.0.0.1"
      },
      signal: innerSignal
    }), signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new WebSearchError("SearXNG search timed out.", { status: 504, provider: "searxng", retryable: true });
    }
    throw new WebSearchError(`SearXNG search request failed: ${error?.message || error}`, {
      provider: "searxng",
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const message = response.status === 403
      ? "SearXNG rejected JSON search. Enable `search.formats: [html, json]` in settings.yml."
      : `SearXNG search returned ${response.status}.`;
    throw new WebSearchError(message, {
      status: response.status,
      provider: "searxng",
      retryable: response.status >= 500 || response.status === 429,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new WebSearchError("SearXNG search returned non-JSON.", {
      status: response.status,
      provider: "searxng",
      details: error?.message
    });
  }

  const data = Array.isArray(payload?.results) ? payload.results : [];
  const normalized = [];
  const seenUrls = new Set();
  const limit = Math.max(1, Math.min(20, Number(numResults) || 5));

  for (const item of data) {
    if (normalized.length >= limit) break;
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const title = String(item.title || url).replace(/\s+/g, " ").trim();
    const snippet = String(item.content || item.snippet || "").replace(/\s+/g, " ").trim();
    normalized.push({
      index: normalized.length + 1,
      title: title.slice(0, 300),
      url,
      snippet: snippet.slice(0, 500),
      content: "",
      publishedAt: normalizePublishedAt(item)
    });
  }

  return {
    provider: "searxng",
    query: params.get("q"),
    results: normalized,
    tokens: null
  };
}
