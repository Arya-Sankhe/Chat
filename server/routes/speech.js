import { randomUUID } from "node:crypto";
import { HttpError, readRawBody, sendJson } from "../http/responses.js";
import { apiUsageWindow } from "../saas/billing.js";
import { requireChatContext } from "./context.js";
import { enforceRateLimit } from "../http/rateLimit.js";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const STT_MODEL = "x-ai/grok-stt-1.0";
export const STT_RESERVATION_CREDITS = 0.5;
export const STT_TIMEOUT_MS = 120_000;

function audioFormat(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("wav")) return "wav";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  return "webm";
}

export function speechUsage(payload, fallbackSeconds = 0) {
  const cost = Number(payload?.usage?.cost);
  const reported = Number(payload?.usage?.seconds ?? payload?.duration);
  return {
    credits: Number.isFinite(cost) && cost >= 0 ? cost : 0,
    durationSeconds: Number.isFinite(reported) && reported > 0 ? reported : Math.max(0, Number(fallbackSeconds) || 0)
  };
}

export async function transcribeAudio(config, audio, contentType, signal) {
  const provider = config.providers?.openrouter;
  if (!provider?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  const headers = {
    authorization: `Bearer ${provider.apiKey}`,
    "content-type": "application/json"
  };
  const body = JSON.stringify({
    model: STT_MODEL,
    input_audio: {
      data: Buffer.from(audio).toString("base64"),
      format: audioFormat(contentType)
    }
  });
  const url = `${provider.baseUrl}/audio/transcriptions`;
  let response = await fetch(url, { method: "POST", headers, body, signal });
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    response = await fetch(url, { method: "POST", headers, body, signal });
  }
  return response;
}

export async function handleSpeechToText(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!config.providers?.openrouter?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  enforceRateLimit(req, "web-stt", 30);

  const context = await requireChatContext(req, config);
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) throw new HttpError(415, "An audio recording is required.");

  const audio = await readRawBody(req, MAX_AUDIO_BYTES);
  if (!audio.length) throw new HttpError(400, "The audio recording is empty.");

  const enforce = config.desktop?.meteringMode === "enforce";
  const requestIdHeader = String(req.headers["x-klui-request-id"] || "").trim();
  const requestId = /^[0-9a-f-]{36}$/i.test(requestIdHeader) ? requestIdHeader : randomUUID();
  if (enforce) {
    const reservation = await context.db.reserveApiUsage({
      userId: context.user.id,
      requestId,
      subscriptionId: context.subscription?.id || null,
      planId: context.plan.id,
      surface: "web",
      modality: "stt",
      oauthClientId: null,
      provider: "openrouter",
      model: STT_MODEL,
      ...apiUsageWindow(context.subscription, context.plan),
      reservedCredits: STT_RESERVATION_CREDITS
    }, { signal: AbortSignal.timeout(15_000) });
    if (reservation?.duplicate) throw new HttpError(409, "This request ID has already been used.");
    if (!reservation?.allowed) throw new HttpError(429, "You've reached your weekly limit. You can continue after it resets.", { code: "usage_exhausted", retryable: false });
  }

  const signal = req.signal
    ? AbortSignal.any([req.signal, AbortSignal.timeout(STT_TIMEOUT_MS)])
    : AbortSignal.timeout(STT_TIMEOUT_MS);
  if (enforce) {
    try {
      await context.db.markApiUsageSubmitted({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) });
    } catch {
      await context.db.releaseApiUsage({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
      throw new HttpError(503, "Usage metering is temporarily unavailable.");
    }
  }
  let response;
  try {
    response = await transcribeAudio(config, audio, contentType, signal);
  } catch (error) {
    if (enforce) await context.db.settleApiUsage({
      userId: context.user.id,
      requestId,
      costCredits: 0,
      costSource: "openrouter_provider_failure",
      usage: { duration_seconds: 0 },
      estimated: true
    }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    if (signal.aborted) throw new HttpError(504, "Speech transcription timed out.");
    throw new HttpError(502, "Speech transcription is temporarily unavailable.");
  }

  if (!response.ok) {
    if (enforce) await context.db.settleApiUsage({
      userId: context.user.id,
      requestId,
      costCredits: 0,
      costSource: "openrouter_provider_failure",
      usage: { duration_seconds: 0 },
      estimated: true
    }, { signal: AbortSignal.timeout(15_000) });
    throw new HttpError(502, "Speech transcription failed.");
  }
  const payload = await response.json().catch(() => ({}));
  const transcript = String(payload?.text || "").trim();
  if (enforce) {
    const usage = speechUsage(payload);
    await context.db.settleApiUsage({
      userId: context.user.id,
      requestId,
      costCredits: usage.credits,
      costSource: "openrouter_stt",
      usage: { duration_seconds: usage.durationSeconds }
    }, { signal: AbortSignal.timeout(15_000) });
  }
  if (!transcript) throw new HttpError(502, "Speech transcription returned no text.");
  sendJson(res, 200, { transcript });
}
