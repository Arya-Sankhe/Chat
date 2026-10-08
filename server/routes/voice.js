// Chat voice mode: the browser records a turn, Grok transcribes it, the reply streams through
// the normal chat pipeline (with the voice prompt), and the browser speaks it sentence by
// sentence through this Kokoro endpoint while the model is still writing.
import { createHash } from "node:crypto";
import { extractBearerToken } from "../auth/supabase.js";
import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { resolveProvider } from "../providers.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { createSessionStore, createSpeechSession, pocketPool } from "../speech/engine.js";
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

const speechSessions = createSessionStore();

export function clearVoiceContextCache() {
  contextCache.clear();
  speechSessions.clear();
}

// The browser hanging up (the user interrupted) cancels the synthesis, including a queued one.
// Set up before the first await, so a hang-up during sign-in checks is not missed.
function closeSignal(req, res) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(new Error("client_closed")); };
  if (res.destroyed || req.destroyed) abort();
  else res.on?.("close", abort);
  return req.signal ? AbortSignal.any([req.signal, controller.signal]) : controller.signal;
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

export async function handleVoiceSpeech(req, res, config, { tts = synthesizeSpeech, pool = pocketPool(config) } = {}) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const signal = closeSignal(req, res);
  const context = await voiceContext(req, config);
  enforceRateLimit(req, "voice-tts", 240, 60_000, context.user.id);
  const body = await parseJsonBody(req, 16 * 1024);
  const text = speakable(body.text);
  if (!text) throw new HttpError(400, "Nothing to say.");
  if (text.length > VOICE_SPEECH_MAX_CHARS) throw new HttpError(413, "That is too much to say at once.");
  const voice = normalizeVoiceModeVoice(body.voice);
  const speed = normalizeVoiceModeSpeed(body.speed);
  // Clients that predate Pocket send no session and keep Kokoro, which matches their bundled previews.
  const sessionId = typeof body.session === "string" && /^[\w-]{8,64}$/.test(body.session) ? body.session : "";
  const speech = sessionId
    ? speechSessions.get(`${context.user.id}:${sessionId}`, () => createSpeechSession({ pool, kokoro: tts }))
    : createSpeechSession({ pool: null, kokoro: tts });
  const reply = Number.isSafeInteger(body.reply) ? body.reply : 0;
  // Requests of one reply share its number. A request from an older reply comes from speech the
  // user already cut off; it must not touch the current reply's engine state.
  if (reply < (speech.clientReply ?? -1)) throw new HttpError(409, "That reply was interrupted.");
  if (reply > (speech.clientReply ?? -1)) {
    speech.clientReply = reply;
    speech.beginReply();
  }
  if (signal.aborted) return; // hung up during the checks: nothing to say, nothing to bill
  const provider = resolveProvider("openrouter", config);
  const meter = createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal,
    meteringMode: config.desktop.meteringMode,
    reservationCredits: VOICE_SPEECH_RESERVATION
  });
  await meter.runReserved({ apiKey: provider.apiKey, baseUrl: provider.baseUrl, providerId: "openrouter", body: { model: TTS_MODEL }, signal }, async () => {
    let audio;
    let engine;
    try {
      ({ audio, engine } = await speech.speak({ config, text, voice, speed, signal }));
    } catch (error) {
      if (signal.aborted) throw error;
      throw new HttpError(502, "Could not speak that. Try again.");
    }
    if (signal.aborted) throw signal.reason; // nobody is listening any more: release, do not bill
    // The audio goes out before the usage settles, so playback never waits on metering.
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": audio.length,
      "cache-control": "no-store",
      // Which voice set this conversation uses, so the voice picker previews the right one.
      "x-speech-engine": engine
    });
    res.end(audio);
    return { result: null, usage: { cost: text.length * TTS_CREDITS_PER_CHAR, characters: text.length, engine } };
  }).catch((error) => {
    if (!res.headersSent) throw error; // a late metering failure cannot take back sent audio
  });
}
