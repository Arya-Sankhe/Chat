/**
 * Brave Search LLM Context API — fallback provider.
 *
 * Single call to /res/v1/llm/context returns pre-extracted, relevance-
 * ranked content chunks ready for grounding. Same normalized shape as
 * the Jina primary, so the orchestrator can swap providers seamlessly.
 *
 * Pricing: $5 / 1,000 requests, $5/month free credit (Search plan).
 */

import { WebSearchError } from "./jina.js";

const LLM_CONTEXT_ENDPOINT = "https://api.search.brave.com/res/v1/llm/context";

function buildHeaders({ apiKey }) {
  return {
    accept: "application/json",
    "accept-encoding": "gzip",
    "x-subscription-token": apiKey
  };
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

function clampContent(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated for context budget]`;
}

/**
 * @returns {Promise<{
 *   provider: "brave",
 *   query: string,
 *   results: Array<{
 *     index: number,
 *     title: string,
 *     url: string,
 *     snippet: string,
 *     content: string,
 *     publishedAt: string | null
 *   }>
 * }>}
 */
export async function braveSearch({
  query,
  numResults = 5,
  country = "us",
  lang = "en",
  freshness,
  apiKey,
  pageContentChars = 4000,
  totalContextChars = 12000,
  timeoutMs = 8000,
  signal
}) {
  if (!apiKey) {
    throw new WebSearchError("Brave Search API key is not configured.", {
      status: 503,
      provider: "brave"
    });
  }

  if (typeof query !== "string" || !query.trim()) {
    throw new WebSearchError("Search query is required.", { status: 400, provider: "brave" });
  }

  const params = new URLSearchParams({
    q: query.trim().slice(0, 400),
    country: country || "us",
    search_lang: lang || "en",
    count: String(Math.max(1, Math.min(20, Number(numResults) || 5))),
    maximum_number_of_urls: String(Math.max(1, Math.min(20, Number(numResults) || 5))),
    maximum_number_of_tokens: "4096",
    maximum_number_of_tokens_per_url: "2048",
    context_threshold_mode: "balanced"
  });
  if (freshness && freshness !== "any") {
    const map = { day: "pd", week: "pw", month: "pm", year: "py" };
    if (map[freshness]) params.set("freshness", map[freshness]);
  }

  let response;
  try {
    response = await withTimeout(timeoutMs, (innerSignal) => fetch(`${LLM_CONTEXT_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: buildHeaders({ apiKey }),
      signal: innerSignal
    }), signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new WebSearchError("Brave search timed out.", { status: 504, provider: "brave", retryable: true });
    }
    throw new WebSearchError(`Brave search request failed: ${error?.message || error}`, {
      provider: "brave",
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(`Brave search returned ${response.status}.`, {
      status: response.status,
      provider: "brave",
      retryable: response.status >= 500 || response.status === 429,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new WebSearchError("Brave search returned non-JSON.", {
      status: response.status,
      provider: "brave",
      details: error?.message
    });
  }

  /* Brave responses come either as {results:[{url,title,snippets:[…]}]}
     or with a top-level `web.results`. Normalize both shapes. */
  const items = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.web?.results)
      ? payload.web.results
      : [];

  const normalized = [];
  let runningTotal = 0;

  for (let i = 0; i < items.length && normalized.length < Number(numResults); i++) {
    const item = items[i] || {};
    const url = typeof item.url === "string" ? item.url : "";
    if (!url) continue;

    const snippetsArr = Array.isArray(item.snippets)
      ? item.snippets
      : Array.isArray(item.extra_snippets)
        ? item.extra_snippets
        : [];

    const combined = [
      item.description || "",
      ...snippetsArr.map((entry) => (typeof entry === "string" ? entry : entry?.text || ""))
    ]
      .filter(Boolean)
      .join("\n\n");

    const remainingBudget = Math.max(0, totalContextChars - runningTotal);
    if (remainingBudget < 200) break;

    const content = clampContent(combined || item.snippet || "", Math.min(pageContentChars, remainingBudget));
    runningTotal += content.length;

    normalized.push({
      index: normalized.length + 1,
      title: String(item.title || url).slice(0, 300),
      url,
      snippet: String(item.description || (snippetsArr[0]?.text || snippetsArr[0]) || "").slice(0, 500),
      content,
      publishedAt: item.age || item.page_age || null
    });
  }

  return {
    provider: "brave",
    query: params.get("q"),
    results: normalized,
    tokens: null
  };
}
