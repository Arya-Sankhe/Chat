import { randomUUID } from "node:crypto";
import { HttpError, readRawBody, sendJson } from "../http/responses.js";
import { apiUsageWindow } from "../saas/billing.js";
import { validatedAudioDuration } from "../speech/audio.js";
import { requireChatContext } from "./context.js";
import { enforceRateLimit } from "../http/rateLimit.js";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

function audioExtension(contentType) {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

export async function callSarvam(config, audio, contentType, signal) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `speech.${audioExtension(contentType)}`);
  form.append("model", "saaras:v3");
  form.append("mode", "codemix");
  form.append("language_code", "unknown");

  return fetch(`${config.speech.baseUrl}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": config.speech.apiKey },
    body: form,
    signal
  });
}

export async function handleSpeechToText(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!config.speech?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  enforceRateLimit(req, "web-stt", 30);

  const context = await requireChatContext(req, config);
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) throw new HttpError(415, "An audio recording is required.");

  const audio = await readRawBody(req, MAX_AUDIO_BYTES);
  if (!audio.length) throw new HttpError(400, "The audio recording is empty.");

  const enforce = config.desktop?.meteringMode === "enforce";
  const durationSeconds = enforce ? validatedAudioDuration(audio, contentType, { maxSeconds: 30 }) : 0;
  const requestIdHeader = String(req.headers["x-klui-request-id"] || "").trim();
  const requestId = /^[0-9a-f-]{36}$/i.test(requestIdHeader) ? requestIdHeader : randomUUID();
  const credits = durationSeconds * Number(config.speech.creditsPerSecond || 0);
  if (enforce) {
    const reservation = await context.db.reserveApiUsage({
      userId: context.user.id,
      requestId,
      subscriptionId: context.subscription?.id || null,
      planId: context.plan.id,
      surface: "web",
      modality: "stt",
      oauthClientId: null,
      provider: "sarvam",
      model: "saaras:v3",
      ...apiUsageWindow(context.subscription, context.plan),
      reservedCredits: credits
    }, { signal: AbortSignal.timeout(15_000) });
    if (reservation?.duplicate) throw new HttpError(409, "This request ID has already been used.");
    if (!reservation?.allowed) throw new HttpError(429, "Voice and chat share your weekly allowance.");
  }

  const signal = enforce ? AbortSignal.timeout(45_000) : AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]);
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
    response = await callSarvam(config, audio, contentType, signal);
    if (!enforce && (response.status === 429 || response.status >= 500)) {
      await response.body?.cancel();
      response = await callSarvam(config, audio, contentType, signal);
    }
  } catch (error) {
    if (enforce) await context.db.settleApiUsage({
      userId: context.user.id,
      requestId,
      costCredits: 0,
      costSource: "sarvam_provider_failure",
      usage: { duration_seconds: durationSeconds },
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
      costSource: "sarvam_provider_failure",
      usage: { duration_seconds: durationSeconds },
      estimated: true
    }, { signal: AbortSignal.timeout(15_000) });
    throw new HttpError(502, "Speech transcription failed.");
  }
  const payload = await response.json().catch(() => ({}));
  const transcript = String(payload.transcript || "").trim();
  if (enforce) {
    await context.db.settleApiUsage({
      userId: context.user.id,
      requestId,
      costCredits: credits,
      costSource: "sarvam_duration",
      usage: { duration_seconds: durationSeconds }
    }, { signal: AbortSignal.timeout(15_000) });
  }
  if (!transcript) throw new HttpError(502, "Speech transcription returned no text.");
  sendJson(res, 200, { transcript });
}
