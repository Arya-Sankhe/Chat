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

const QUERY_STOPWORDS = new Set([
  "about", "again", "also", "and", "any", "are", "based", "best", "can", "could", "for", "from", "get",
  "give", "good", "great", "help", "how", "like", "look", "looking", "me", "more", "near", "now", "of",
  "on", "or", "please", "quick", "quickly", "show", "some", "stuff", "tell", "the", "these", "this",
  "those", "to", "top", "tops", "want", "what", "where", "who", "with", "you", "your"
]);

const TOKEN_ALIASES = new Map([
  ["restaraunt", "restaurant"],
  ["restaraunts", "restaurant"],
  ["restuarent", "restaurant"],
  ["restuarents", "restaurant"],
  ["resturant", "restaurant"],
  ["resturants", "restaurant"],
  ["restaurants", "restaurant"],
  ["restos", "restaurant"],
  ["perfumes", "perfume"],
  ["fragrances", "fragrance"]
]);

const NOISY_SOURCE_HOSTS = [
  "bestbuy.com",
  "bestbuy.ca",
  "dictionary.cambridge.org",
  "merriam-webster.com",
  "wordreference.com",
  "topsmarkets.com",
  "shop.topsmarkets.com",
  "canva.com"
];

function normalizeToken(value) {
  let token = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!token) return "";
  token = TOKEN_ALIASES.get(token) || token;
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    token = TOKEN_ALIASES.get(token.slice(0, -1)) || token.slice(0, -1);
  }
  return TOKEN_ALIASES.get(token) || token;
}

function tokenize(value, { keepStopwords = false } = {}) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(normalizeToken)
    .filter((token) => token.length >= 3)
    .filter((token) => keepStopwords || !QUERY_STOPWORDS.has(token));
}

function queryTerms(query) {
  return [...new Set(tokenize(query))].slice(0, 12);
}

function urlParts(value) {
  try {
    const parsed = new URL(value);
    return {
      host: parsed.hostname.replace(/^www\./, "").toLowerCase(),
      path: parsed.pathname.replace(/[/-]+/g, " ")
    };
  } catch {
    return { host: "", path: "" };
  }
}

function resultRelevance({ title, snippet, url }, terms) {
  if (!terms.length) return 1;
  const { host, path } = urlParts(url);
  const haystackText = `${title} ${snippet} ${host.replace(/\./g, " ")} ${path}`;
  const haystack = haystackText.toLowerCase();
  const tokens = new Set(tokenize(haystackText, { keepStopwords: true }));
  let score = 0;
  for (const term of terms) {
    if (tokens.has(term) || haystack.includes(term)) score += 1;
  }
  return score;
}

function isNoisyResult({ title, url }, score, terms) {
  const { host } = urlParts(url);
  const titleLower = String(title || "").toLowerCase();
  const noisyHost = NOISY_SOURCE_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
  const dictionaryResult = /\b(dictionary|definition|meaning)\b/.test(titleLower);
  if (dictionaryResult && !terms.some((term) => ["definition", "dictionary", "meaning"].includes(term))) return true;
  return noisyHost && score < Math.min(2, Math.max(1, terms.length));
}

function selectRelevantResults(candidates, query, limit) {
  const terms = queryTerms(query);
  if (!candidates.length) return [];

  const scored = candidates.map((result, originalIndex) => {
    const score = resultRelevance(result, terms);
    return {
      result,
      originalIndex,
      score,
      noisy: isNoisyResult(result, score, terms)
    };
  });

  const strictThreshold = terms.length <= 1 ? 1 : Math.min(2, terms.length);
  const strict = scored.filter((entry) => !entry.noisy && entry.score >= strictThreshold);
  const loose = scored.filter((entry) => !entry.noisy && entry.score >= 1);
  const clean = scored.filter((entry) => !entry.noisy);
  const selectedPool = [...strict];
  for (const entry of loose) {
    if (selectedPool.length >= limit) break;
    if (!selectedPool.includes(entry)) selectedPool.push(entry);
  }
  if (!selectedPool.length) selectedPool.push(...(clean.length ? clean : scored));

  const selected = selectedPool
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .slice(0, limit)
    .map((entry, index) => ({ ...entry.result, index: index + 1 }));

  return selected;
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
  const candidates = [];
  const seenUrls = new Set();
  const limit = Math.max(1, Math.min(20, Number(numResults) || 5));
  const scanLimit = Math.min(40, Math.max(limit * 4, limit));

  for (const item of data) {
    if (candidates.length >= scanLimit) break;
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const title = String(item.title || url).replace(/\s+/g, " ").trim();
    const snippet = String(item.content || item.snippet || "").replace(/\s+/g, " ").trim();
    candidates.push({
      index: candidates.length + 1,
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
    results: selectRelevantResults(candidates, params.get("q"), limit),
    tokens: null
  };
}
