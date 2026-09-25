// Chat voice mode: the browser records a turn, Grok transcribes it, the reply streams through
// the normal chat pipeline (with the voice prompt), and the browser speaks it sentence by
// sentence through this Kokoro endpoint while the model is still writing.
import { createHash } from "node:crypto";
import { extractBearerToken } from "../auth/supabase.js";
import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { resolveProvider } from "../providers.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { normalizeVoiceModeSpeed, normalizeVoiceModeVoice } from "../speech/voices.js";
import { TTS_CREDITS_PER_CHAR, TTS_MODEL, speakable, synthesizeSpeech } from "../study/podcast.js";
import { requireChatContext } from "./context.js";
import { transcribeLiveRecording } from "./speech.js";

// A voice turn makes several quick requests (transcribe, then one per spoken sentence). Checking
// the session, profile and plan costs ~0.6 s each time, so the resolved context is reused for a
// minute per token. Every request still reserves and settles its own usage.
const CONTEXT_TTL_MS = 60_000;
const CONTEXT_CACHE_MAX = 500;
const contextCache = new Map();

export function clearVoiceContextCache() {
  contextCache.clear();
}

function voiceContext(req, config) {
  const token = extractBearerToken(req.headers || {});
  if (!token) return requireChatContext(req, config);
  const key = createHash("sha256").update(token).digest("hex");
  const hit = contextCache.get(key);
  if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return hit.promise;
  // Not tied to this request's signal: other requests may share the lookup.
  const promise = requireChatContext({ headers: req.headers }, config);
  contextCache.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (contextCache.get(key)?.promise === promise) contextCache.delete(key); });
  while (contextCache.size > CONTEXT_CACHE_MAX) contextCache.delete(contextCache.keys().next().value);
  return promise;
}

// Called when voice mode opens, so the first turn skips the session check.
export async function handleVoiceWarm(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  enforceRateLimit(req, "voice-warm", 30);
  await voiceContext(req, config);
  sendJson(res, 200, { ok: true });
}

// One chunk is a sentence or two; the longest a client should ever send.
export const VOICE_SPEECH_MAX_CHARS = 700;
// 700 characters of Kokoro cost well under a tenth of a cent.
const VOICE_SPEECH_RESERVATION = 0.002;

export async function handleVoiceTranscribe(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await voiceContext(req, config);
  enforceRateLimit(req, "voice-stt", 90, 60_000, context.user.id);
  const { text } = await transcribeLiveRecording(req, context, config);
  sendJson(res, 200, { text });
}

export async function handleVoiceSpeech(req, res, config, { tts = synthesizeSpeech } = {}) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await voiceContext(req, config);
  enforceRateLimit(req, "voice-tts", 240, 60_000, context.user.id);
  const body = await parseJsonBody(req, 16 * 1024);
  const text = speakable(body.text);
  if (!text) throw new HttpError(400, "Nothing to say.");
  if (text.length > VOICE_SPEECH_MAX_CHARS) throw new HttpError(413, "That is too much to say at once.");
  const voice = normalizeVoiceModeVoice(body.voice);
  const speed = normalizeVoiceModeSpeed(body.speed);
  const provider = resolveProvider("openrouter", config);
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: VOICE_SPEECH_RESERVATION
  });
  await meter.runReserved({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, providerId: "openrouter", body: { model: TTS_MODEL }, signal: req.signal }, async () => {
    let audio;
    try {
      audio = await tts({ config, text, voice, speed, signal: req.signal });
    } catch (error) {
      if (req.signal?.aborted) throw error;
      throw new HttpError(502, "Could not speak that. Try again.");
    }
    // The audio goes out before the usage settles, so playback never waits on metering.
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": audio.length,
      "cache-control": "no-store"
    });
    res.end(audio);
    return { result: null, usage: { cost: text.length * TTS_CREDITS_PER_CHAR, characters: text.length } };
  }).catch((error) => {
    if (!res.headersSent) throw error; // a late metering failure cannot take back sent audio
  });
}
