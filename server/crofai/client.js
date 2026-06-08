import { HttpError } from "../http/responses.js";
import { adaptChatRequestForProvider } from "../providers.js";

/* Transient upstream failures we auto-retry. These are connection or
   capacity errors that typically succeed on a second attempt — unlike
   4xx capability/auth errors, which fail deterministically and are
   surfaced immediately so callers (e.g. the tool loop's graceful
   degradation) can react. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 8000;

function isAbortError(error) {
  return error?.name === "AbortError";
}

function retryDelayMs(attempt, retryAfterHeader) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  const base = Math.min(400 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return base + Math.floor(Math.random() * 250);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * POST /chat/completions with bounded retry + backoff for transient
 * failures. Returns the raw Response (body untouched) so streaming
 * callers can pipe it and non-streaming callers can parse it.
 */
async function postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const isLast = attempt === maxAttempts - 1;

    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          ...authHeaders(apiKey),
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal
      });
    } catch (error) {
      /* Network/transport failure (DNS, reset, etc.). The user aborting
         is terminal; everything else is worth another attempt. */
      if (isAbortError(error)) throw error;
      lastError = error;
      if (isLast) throw error;
      await sleep(retryDelayMs(attempt), signal);
      continue;
    }

    if (response.ok) return response;

    if (RETRYABLE_STATUS.has(response.status) && !isLast) {
      const retryAfter = response.headers.get("retry-after");
      await response.text().catch(() => {});
      await sleep(retryDelayMs(attempt, retryAfter), signal);
      continue;
    }

    throw await crofaiError(response);
  }

  throw lastError || new HttpError(502, "Upstream chat request failed after retries.");
}

function authHeaders(apiKey) {
  const headers = {
    accept: "application/json"
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function crofaiError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(text);
      return new HttpError(response.status, json?.error?.message || json?.error || `Klui request failed with ${response.status}.`, json);
    } catch {
      return new HttpError(response.status, `Klui request failed with ${response.status}.`, text.slice(0, 2000));
    }
  }

  return new HttpError(response.status, text.slice(0, 2000) || `Klui request failed with ${response.status}.`);
}

export async function listModels({ apiKey, baseUrl, signal }) {
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: authHeaders(apiKey),
    signal
  });

  if (!response.ok) {
    throw await crofaiError(response);
  }

  return response.json();
}

export async function streamChatCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts }) {
  const requestBody = {
    ...adaptChatRequestForProvider(body, providerId),
    stream: true,
    /* Ask the provider to emit a final usage chunk so we record the
       model's own tokenizer count (prompt + completion + reasoning)
       instead of relying on a client-side char estimate. */
    stream_options: { include_usage: true }
  };
  return postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
}

export async function chatCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts, onResponsePayload }) {
  const requestBody = { ...adaptChatRequestForProvider(body, providerId), stream: false };
  const response = await postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
  const payload = await response.json();
  if (typeof onResponsePayload === "function") onResponsePayload(payload);
  return payload?.choices?.[0]?.message?.content || "";
}
