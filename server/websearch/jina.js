/**
 * Jina AI Search Foundation client.
 *
 *   s.jina.ai → one call returns search results PLUS extracted page
 *               content for the top N URLs, all in LLM-friendly Markdown.
 *               This is the primary "web_search" backend.
 *
 *   r.jina.ai → URL-only reader. Used by the `read_url` tool when the
 *               model wants to deep-read a specific page.
 *
 * Both endpoints share the same JINA_API_KEY. The key is optional:
 * without it, you get the lower 100 RPM anonymous tier. With it,
 * you also get the 10M-token free trial and higher rate limits.
 */

import { HttpError } from "../http/responses.js";

const S_JINA_ENDPOINT = "https://s.jina.ai/";
const R_JINA_PREFIX = "https://r.jina.ai/";

class WebSearchError extends Error {
  constructor(message, { status, provider, retryable = false, details } = {}) {
    super(message);
    this.name = "WebSearchError";
    this.status = status;
    this.provider = provider;
    this.retryable = retryable;
    this.details = details;
  }
}

export { WebSearchError };

function buildSearchHeaders({ apiKey, engine }) {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-return-format": "markdown"
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (engine === "browser") headers["x-engine"] = "browser";
  else headers["x-engine"] = "direct";
  return headers;
}

function buildReadHeaders({ apiKey }) {
  const headers = {
    accept: "application/json",
    "x-return-format": "markdown",
    "x-engine": "direct"
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function clampContent(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated for context budget]`;
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

/**
 * Search the web via s.jina.ai. Returns an array of normalized results.
 * Each result already includes extracted page content — no second fetch
 * required.
 *
 * @returns {Promise<{
 *   provider: "jina",
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
export async function jinaSearch({
  query,
  numResults = 5,
  country = "us",
  lang = "en",
  location,
  freshness,
  backend = "google",
  engine = "direct",
  apiKey,
  pageContentChars = 4000,
  totalContextChars = 12000,
  timeoutMs = 8000,
  signal
}) {
  if (typeof query !== "string" || !query.trim()) {
    throw new WebSearchError("Search query is required.", { status: 400, provider: "jina" });
  }

  const body = {
    q: query.trim().slice(0, 400),
    num: Math.max(1, Math.min(20, Number(numResults) || 5)),
    gl: country || "us",
    hl: lang || "en",
    provider: backend === "bing" ? "bing" : "google",
    fallback: true
  };
  if (location) body.location = location;
  if (freshness && freshness !== "any") body.freshness = freshness;

  let response;
  try {
    response = await withTimeout(timeoutMs, (innerSignal) => fetch(S_JINA_ENDPOINT, {
      method: "POST",
      headers: buildSearchHeaders({ apiKey, engine }),
      body: JSON.stringify(body),
      signal: innerSignal
    }), signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new WebSearchError("Jina search timed out.", { status: 504, provider: "jina", retryable: true });
    }
    throw new WebSearchError(`Jina search request failed: ${error?.message || error}`, {
      provider: "jina",
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(`Jina search returned ${response.status}.`, {
      status: response.status,
      provider: "jina",
      retryable: response.status >= 500 || response.status === 429,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new WebSearchError("Jina search returned non-JSON.", {
      status: response.status,
      provider: "jina",
      details: error?.message
    });
  }

  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const normalized = [];
  let runningTotal = 0;

  for (let i = 0; i < data.length && normalized.length < body.num; i++) {
    const item = data[i] || {};
    const url = typeof item.url === "string" ? item.url : typeof item.link === "string" ? item.link : "";
    if (!url) continue;

    const remainingBudget = Math.max(0, totalContextChars - runningTotal);
    if (remainingBudget < 200) break;

    const perPage = Math.min(pageContentChars, remainingBudget);
    const content = clampContent(item.content || item.text || "", perPage);
    runningTotal += content.length;

    normalized.push({
      index: normalized.length + 1,
      title: String(item.title || item.name || url).slice(0, 300),
      url,
      snippet: String(item.description || item.snippet || "").slice(0, 500),
      content,
      publishedAt: item.publishedTime || item.published_at || item.date || null
    });
  }

  return {
    provider: "jina",
    query: body.q,
    results: normalized,
    tokens: payload?.meta?.usage?.tokens || payload?.usage?.tokens || null
  };
}

/**
 * Fetch a single URL through r.jina.ai. Returns plain Markdown content.
 * Used by the `read_url` tool.
 */
export async function jinaRead({
  url,
  apiKey,
  pageContentChars = 4000,
  timeoutMs = 8000,
  signal
}) {
  if (typeof url !== "string" || !url.trim()) {
    throw new WebSearchError("URL is required.", { status: 400, provider: "jina" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebSearchError("URL is invalid.", { status: 400, provider: "jina" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebSearchError("Only http(s) URLs are supported.", { status: 400, provider: "jina" });
  }

  const target = `${R_JINA_PREFIX}${parsed.toString()}`;
  let response;
  try {
    response = await withTimeout(timeoutMs, (innerSignal) => fetch(target, {
      method: "GET",
      headers: buildReadHeaders({ apiKey }),
      signal: innerSignal
    }), signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw new WebSearchError("Jina read timed out.", { status: 504, provider: "jina", retryable: true });
    }
    throw new WebSearchError(`Jina read request failed: ${error?.message || error}`, {
      provider: "jina",
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new WebSearchError(`Jina read returned ${response.status}.`, {
      status: response.status,
      provider: "jina",
      retryable: response.status >= 500 || response.status === 429,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text();
    payload = { data: { content: text, url: parsed.toString() } };
  }

  const data = payload?.data || payload || {};
  return {
    provider: "jina",
    url: parsed.toString(),
    title: String(data.title || parsed.hostname).slice(0, 300),
    content: clampContent(data.content || data.text || "", pageContentChars),
    publishedAt: data.publishedTime || data.published_at || data.date || null
  };
}
