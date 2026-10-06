import { HttpError } from "../http/responses.js";
import {
  adaptChatRequestForProvider,
  assertAllowedChatModels,
  OPENROUTER_IMAGE_MODEL,
  OPENROUTER_PRO_FALLBACK_MODEL,
  OPENROUTER_PRO_MODEL,
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_VISION_MODEL,
  OPENROUTER_VOICE_MODEL,
  refreshDeepSeekProviderOrder
} from "../providers.js";
import { stripLeakedReasoningMarkup } from "../saas/messages/content.js";

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
    return Math.min(Math.max(seconds * 1000, 1000), MAX_RETRY_DELAY_MS);
  }
  const base = Math.min(800 * 2 ** attempt, MAX_RETRY_DELAY_MS);
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
  assertAllowedChatModels(requestBody);
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

    const retryable = RETRYABLE_STATUS.has(response.status)
      || (response.status >= 520 && response.status <= 527);
    if (retryable && !isLast) {
      const retryAfter = response.headers.get("retry-after");
      await response.text().catch(() => {});
      await sleep(retryDelayMs(attempt, retryAfter), signal);
      continue;
    }

    // Attribution for the next diagnosis (upstream failures only — 4xx is
    // caller error, not provider weather). OpenRouter doesn't reliably report
    // which backend failed, so log the model plus the ordered candidates we sent.
    if (response.status >= 500) {
      const order = requestBody?.provider?.order;
      console.warn(`[chat] upstream ${response.status} model=${requestBody?.model || "?"} order=${Array.isArray(order) ? order.join(",") : "-"} attempts=${attempt + 1}`);
    }
    throw await providerError(response);
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

async function providerError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (response.status >= 500) {
    return new HttpError(response.status, "The model service is temporarily unavailable. Please try again.");
  }

  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(text);
      const message = json?.error?.metadata?.raw
        || json?.error?.message
        || json?.error
        || `Model request failed with ${response.status}.`;
      return new HttpError(response.status, message, json);
    } catch {
      return new HttpError(response.status, `Model request failed with ${response.status}.`, text.slice(0, 2000));
    }
  }

  return new HttpError(response.status, text.slice(0, 2000) || `Model request failed with ${response.status}.`);
}

export async function listModels({ apiKey, baseUrl, signal }) {
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: authHeaders(apiKey),
    signal
  });

  if (!response.ok) {
    throw await providerError(response);
  }

  return response.json();
}

// Pro falls back to MiniMax. Think's flex-only Luna falls back to MiMo, Think's usual model.
function proFallbackBody(body) {
  const { provider: _provider, flex_only: flexOnly, ...rest } = body;
  return { ...rest, model: flexOnly === true ? OPENROUTER_VISION_MODEL : OPENROUTER_PRO_FALLBACK_MODEL };
}

/* Mercury (voice) sometimes accepts a stream and never starts it; OpenRouter only moves to
   the fallback model after about 12 seconds, too long for a spoken reply. Mercury usually
   starts within 2 seconds, so after VOICE_HEDGE_MS DeepSeek Flash is asked too and the
   first one to start answering wins; the other is cancelled. */
const VOICE_HEDGE_MS = 2500;

// Resolves once the stream's first data line arrives (OpenRouter's keep-alive comments
// don't count), with the bytes read so far replayed at the front of the returned body.
function openStreamUntilData({ apiKey, baseUrl, requestBody, signal, maxAttempts }) {
  const controller = new AbortController();
  const forward = () => controller.abort(signal.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener("abort", forward, { once: true });
  const ready = (async () => {
    const response = await postChatCompletion({ apiKey, baseUrl, requestBody, signal: controller.signal, maxAttempts });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const held = [];
    let text = "";
    while (!/(^|\n)data:/.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      held.push(value);
      text += decoder.decode(value, { stream: true });
    }
    const body = new ReadableStream({
      start(stream) {
        for (const chunk of held) stream.enqueue(chunk);
      },
      async pull(stream) {
        const { value, done } = await reader.read();
        if (done) stream.close();
        else stream.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    });
    return new Response(body, { status: response.status, headers: response.headers });
  })();
  ready.catch(() => {});
  return {
    ready,
    cancel() {
      signal?.removeEventListener("abort", forward);
      controller.abort();
    }
  };
}

function streamBody(body, providerId) {
  return {
    ...adaptChatRequestForProvider(body, providerId),
    stream: true,
    stream_options: { include_usage: true }
  };
}

async function streamVoiceCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts }) {
  const mercury = openStreamUntilData({ apiKey, baseUrl, requestBody: streamBody(body, providerId), signal, maxAttempts: 1 });
  const early = await Promise.race([
    mercury.ready.catch(() => null),
    sleep(VOICE_HEDGE_MS, signal).then(() => null)
  ]);
  if (early) return early;
  await refreshDeepSeekProviderOrder({ apiKey, baseUrl });
  const { sticky_provider: _host, ...rest } = body;
  const deepseek = openStreamUntilData({
    apiKey,
    baseUrl,
    requestBody: streamBody({ ...rest, model: OPENROUTER_TEXT_MODEL }, providerId),
    signal,
    maxAttempts
  });
  try {
    const winner = await Promise.any([
      mercury.ready.then((response) => ({ response, loser: deepseek })),
      deepseek.ready.then((response) => ({ response, loser: mercury }))
    ]);
    winner.loser.cancel();
    return winner.response;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw error.errors?.at(-1) || error;
  }
}

export async function streamChatCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts }) {
  assertAllowedChatModels(body);
  if (providerId === "openrouter" && body?.model === OPENROUTER_VOICE_MODEL) {
    return streamVoiceCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts });
  }
  if (providerId === "openrouter" && String(body?.model || "").startsWith("deepseek/")) {
    await refreshDeepSeekProviderOrder({ apiKey, baseUrl });
  }
  let requestBody = {
    ...adaptChatRequestForProvider(body, providerId),
    stream: true,
    /* Ask the provider to emit a final usage chunk so we record the
       model's own tokenizer count (prompt + completion + reasoning)
       instead of relying on a client-side char estimate. */
    stream_options: { include_usage: true }
  };
  try {
    return await postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
  } catch (error) {
    if (error?.name === "AbortError" || providerId !== "openrouter" || body?.model !== OPENROUTER_PRO_MODEL) throw error;
    requestBody = {
      ...adaptChatRequestForProvider(proFallbackBody(body), providerId),
      stream: true,
      stream_options: { include_usage: true }
    };
    return postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
  }
}

export async function chatCompletion({ apiKey, baseUrl, body, signal, providerId, maxAttempts, onResponseStarted, onResponsePayload }) {
  assertAllowedChatModels(body);
  if (providerId === "openrouter" && String(body?.model || "").startsWith("deepseek/")) {
    await refreshDeepSeekProviderOrder({ apiKey, baseUrl });
  }
  let requestBody = { ...adaptChatRequestForProvider(body, providerId), stream: false };
  let response;
  try {
    response = await postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
  } catch (error) {
    if (error?.name === "AbortError" || providerId !== "openrouter" || body?.model !== OPENROUTER_PRO_MODEL) throw error;
    requestBody = {
      ...adaptChatRequestForProvider(proFallbackBody(body), providerId),
      stream: false
    };
    response = await postChatCompletion({ apiKey, baseUrl, requestBody, signal, maxAttempts });
  }
  if (typeof onResponseStarted === "function") await onResponseStarted(response);
  const payload = await response.json();
  if (typeof onResponsePayload === "function") onResponsePayload(payload);
  return stripLeakedReasoningMarkup(payload?.choices?.[0]?.message?.content || "", requestBody.model);
}

export async function imageGeneration({
  apiKey,
  baseUrl,
  body,
  signal,
  onResponseStarted,
  onResponsePayload
}) {
  if (body?.model !== OPENROUTER_IMAGE_MODEL) throw new HttpError(400, `Image model is not approved for Klui: ${body?.model}`);
  const response = await fetch(`${baseUrl}/images`, {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw await providerError(response);
  if (typeof onResponseStarted === "function") await onResponseStarted(response);
  const payload = await response.json();
  if (typeof onResponsePayload === "function") onResponsePayload(payload);
  return payload;
}
