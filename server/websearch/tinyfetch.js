import { WebSearchError, isAbortError, isPrivateHostname, requestSignal } from "./jina.js";

const ENDPOINT = "https://api.fetch.tinyfish.ai";
const MAX_URL_TIMEOUT_MS = 110_000;

export async function tinyfetchRead({ url, apiKey, timeoutMs = 8000, signal }) {
  const target = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new WebSearchError("URL is invalid.", { status: 400, provider: "tinyfetch" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebSearchError("Only http(s) URLs are supported.", { status: 400, provider: "tinyfetch" });
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new WebSearchError("URL points to a private or internal address.", { status: 400, provider: "tinyfetch" });
  }
  if (!apiKey) {
    throw new WebSearchError("TinyFetch API key is not configured.", { status: 503, provider: "tinyfetch" });
  }

  const budgetMs = Math.min(MAX_URL_TIMEOUT_MS, Math.max(1, Number(timeoutMs) || 8000));
  const failIfAborted = (error) => {
    if (signal?.aborted) throw error;
    if (isAbortError(error)) {
      throw new WebSearchError("TinyFetch timed out.", { status: 504, provider: "tinyfetch", retryable: true });
    }
  };

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ urls: [target], format: "markdown", per_url_timeout_ms: budgetMs }),
      signal: requestSignal(budgetMs, signal)
    });
  } catch (error) {
    failIfAborted(error);
    throw new WebSearchError(`TinyFetch request failed: ${error?.message || error}`, {
      status: 502,
      provider: "tinyfetch",
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const text = await response.text().catch((error) => {
      failIfAborted(error);
      return "";
    });
    throw new WebSearchError(`TinyFetch returned ${response.status}.`, {
      status: response.status,
      provider: "tinyfetch",
      retryable: response.status === 429 || response.status >= 500,
      details: text.slice(0, 2000)
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    failIfAborted(error);
    throw new WebSearchError("TinyFetch returned non-JSON.", {
      status: response.status,
      provider: "tinyfetch",
      details: error?.message
    });
  }

  const result = payload?.results?.[0];
  const content = String(result?.text || "").trim();
  if (!result || !content) {
    throw new WebSearchError(payload?.errors?.[0]?.error || "TinyFetch returned no content.", {
      status: 502,
      provider: "tinyfetch",
      retryable: true
    });
  }
  return {
    provider: "tinyfetch",
    url: String(result.final_url || result.url || target),
    title: String(result.title || target).slice(0, 300),
    content: String(result.text || ""),
    publishedAt: result.published_date || null
  };
}
