import { randomUUID } from "node:crypto";
import { HttpError, readRawBody, sendJson } from "../http/responses.js";
import { apiUsageWindow } from "../saas/billing.js";
import { MAX_AUDIO_SECONDS, validatedAudioDuration } from "../speech/audio.js";
import { requireChatContext } from "./context.js";
import { enforceRateLimit } from "../http/rateLimit.js";

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const STT_MODEL = "microsoft/mai-transcribe-2";
// OpenRouter lists MAI-Transcribe 2 at $0.10/audio hour: ten minutes is
// $0.0167, so $0.02 holds the full request with a small fee/rounding margin.
export const STT_RESERVATION_CREDITS = 0.02;
export const STT_CREDITS_PER_SECOND = 0.10 / (60 * 60);
export const STT_TIMEOUT_MS = 120_000;

function audioFormat(contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("wav")) return "wav";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  return "webm";
}

export function speechUsage(payload, fallbackSeconds = 0) {
  const rawCost = payload?.usage?.cost;
  const cost = Number(rawCost);
  const hasProviderCost = rawCost !== null
    && rawCost !== undefined
    && String(rawCost).trim() !== ""
    && Number.isFinite(cost)
    && cost >= 0;
  const reported = Number(payload?.usage?.seconds ?? payload?.duration);
  const durationSeconds = Number.isFinite(reported) && reported > 0
    ? reported
    : Math.max(0, Number(fallbackSeconds) || 0);
  return {
    credits: hasProviderCost ? cost : durationSeconds * STT_CREDITS_PER_SECOND,
    durationSeconds,
    estimated: !hasProviderCost
  };
}

export async function transcribeAudio(config, audio, contentType, signal, model = STT_MODEL) {
  const provider = config.providers?.openrouter;
  if (!provider?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  const headers = {
    authorization: `Bearer ${provider.apiKey}`,
    "content-type": "application/json"
  };
  const body = JSON.stringify({
    model,
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

export async function settleSpeechUsage(context, { requestId, durationSeconds, payload = {}, ok, signal }) {
  const usage = speechUsage(payload, durationSeconds);
  const costCredits = ok ? usage.credits : 0;
  await context.db.settleApiUsage({
    userId: context.user.id,
    requestId,
    costCredits,
    costSource: ok ? "openrouter_stt" : "openrouter_provider_failure",
    usage: { duration_seconds: usage.durationSeconds },
    estimated: !ok || usage.estimated
  }, { signal });
  return usage;
}

// Live voice turns (tutor calls, chat voice mode). Grok STT takes the browser's WebM/Opus
// recording as is, so there is no client-side WAV conversion and no extra latency.
export const LIVE_STT_MODEL = "x-ai/grok-stt-1.0";
// $0.10 per audio hour; a spoken turn is capped at five minutes, which costs about $0.008.
const LIVE_STT_RESERVATION = 0.01;
// Browsers record Opus at up to ~128 kbps by default, about 4.8 MB for five minutes.
const LIVE_STT_MAX_BYTES = 8 * 1024 * 1024;
const LIVE_STT_MAX_SECONDS = 5 * 60;

/** Meters and transcribes one live recording from the request body. Returns { text, seconds }. */
export async function transcribeLiveRecording(req, context, config) {
  if (!config.providers?.openrouter?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) throw new HttpError(415, "An audio recording is required.");
  const audio = await readRawBody(req, LIVE_STT_MAX_BYTES);
  if (!audio.length) throw new HttpError(400, "The audio recording is empty.");
  // Live MediaRecorder WebM has no duration header; the byte cap bounds it and billing uses
  // the seconds Grok reports.
  let durationSeconds = 0;
  try {
    durationSeconds = validatedAudioDuration(audio, contentType, { maxSeconds: LIVE_STT_MAX_SECONDS });
  } catch (error) {
    if (error?.status === 413) throw error;
  }

  const requestId = randomUUID();
  const reservation = await context.db.reserveApiUsage({
    userId: context.user.id,
    requestId,
    subscriptionId: context.subscription?.id || null,
    planId: context.plan.id,
    surface: "web",
    modality: "stt",
    oauthClientId: null,
    provider: "openrouter",
    model: LIVE_STT_MODEL,
    ...apiUsageWindow(context.subscription, context.plan),
    reservedCredits: LIVE_STT_RESERVATION
  }, { signal: AbortSignal.timeout(15_000) });
  if (reservation?.duplicate) throw new HttpError(409, "This request ID has already been used.");
  if (reservation?.reason === "usage_metering_disabled") throw new HttpError(503, "Usage metering is temporarily unavailable.");
  if (!reservation?.allowed) throw new HttpError(429, "You've reached your weekly limit. You can continue after it resets.", { code: "usage_exhausted", retryable: false });

  const signal = AbortSignal.any([req.signal || new AbortController().signal, AbortSignal.timeout(60_000)]);
  const settle = (fields) => settleSpeechUsage(context, { requestId, durationSeconds, signal: AbortSignal.timeout(15_000), ...fields });
  try {
    await context.db.markApiUsageSubmitted({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) });
  } catch {
    await context.db.releaseApiUsage({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new HttpError(503, "Usage metering is temporarily unavailable.");
  }
  let response;
  try {
    response = await transcribeAudio(config, audio, contentType, signal, LIVE_STT_MODEL);
  } catch {
    await settle({ ok: false }).catch(() => {});
    throw new HttpError(signal.aborted ? 504 : 502, "Speech transcription is temporarily unavailable.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    await settle({ ok: false }).catch(() => {});
    throw new HttpError(502, "Speech transcription failed.");
  }
  const payload = await response.json().catch(() => ({}));
  // Settling does not hold up the transcript: the next turn is waiting on it.
  void settle({ payload, ok: true }).catch(() => {});
  return { text: String(payload?.text || "").trim(), seconds: Number(payload?.usage?.seconds) || durationSeconds || 0 };
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
  const durationSeconds = validatedAudioDuration(audio, contentType, { maxSeconds: MAX_AUDIO_SECONDS });

  const requestIdHeader = String(req.headers["x-klui-request-id"] || "").trim();
  const requestId = /^[0-9a-f-]{36}$/i.test(requestIdHeader) ? requestIdHeader : randomUUID();
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
  if (reservation?.reason === "usage_metering_disabled") throw new HttpError(503, "Usage metering is temporarily unavailable.");
  if (!reservation?.allowed) throw new HttpError(429, "You've reached your weekly limit. You can continue after it resets.", { code: "usage_exhausted", retryable: false });

  const signal = req.signal
    ? AbortSignal.any([req.signal, AbortSignal.timeout(STT_TIMEOUT_MS)])
    : AbortSignal.timeout(STT_TIMEOUT_MS);
  try {
    await context.db.markApiUsageSubmitted({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) });
  } catch {
    await context.db.releaseApiUsage({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new HttpError(503, "Usage metering is temporarily unavailable.");
  }
  let response;
  try {
    response = await transcribeAudio(config, audio, contentType, signal);
  } catch (error) {
    await settleSpeechUsage(context, { requestId, durationSeconds, ok: false, signal: AbortSignal.timeout(15_000) }).catch(() => {});
    if (signal.aborted) throw new HttpError(504, "Speech transcription timed out.");
    throw new HttpError(502, "Speech transcription is temporarily unavailable.");
  }

  if (!response.ok) {
    await settleSpeechUsage(context, { requestId, durationSeconds, ok: false, signal: AbortSignal.timeout(15_000) });
    throw new HttpError(502, "Speech transcription failed.");
  }
  const payload = await response.json().catch(() => ({}));
  const transcript = String(payload?.text || "").trim();
  await settleSpeechUsage(context, { requestId, durationSeconds, payload, ok: true, signal: AbortSignal.timeout(15_000) });
  if (!transcript) throw new HttpError(502, "Speech transcription returned no text.");
  sendJson(res, 200, { transcript });
}
