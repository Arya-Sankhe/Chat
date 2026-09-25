import { randomUUID } from "node:crypto";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { startSse, writeSse } from "../chat/shared.js";
import { apiUsageWindow } from "../saas/billing.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { validatedAudioDuration } from "../speech/audio.js";
import { endTutorSession, prepareTutorSession, publicTutorSession, runTutorTurn } from "../study/tutor.js";
import { requireChatContext } from "./context.js";
import { settleSpeechUsage, transcribeAudio } from "./speech.js";
import { cleanDeckTitle, endStudySse, requireCourse, requireCourseSource } from "./study.js";

// Grok STT takes the browser's WebM/Opus recording as is, so no client-side WAV conversion.
export const TUTOR_STT_MODEL = "x-ai/grok-stt-1.0";
// $0.10 per audio hour; a spoken answer is capped at three minutes, which costs $0.005.
const TUTOR_STT_RESERVATION = 0.01;
const TUTOR_STT_MAX_BYTES = 4 * 1024 * 1024;
const TUTOR_STT_MAX_SECONDS = 180;
const TURN_TIMEOUT_MS = 90_000;
const PREPARE_TIMEOUT_MS = 5 * 60_000;

// ponytail: in-process only, like study generation locks. One turn per call at a time; a new turn
// waits for the previous one (possibly interrupted) to save its transcript first.
const turnChains = new Map();

async function requireTutorSession(context, sessionId, signal) {
  const session = await context.db.getStudyTutorSession(context.user.id, sessionId, { signal });
  if (!session) throw new HttpError(404, "Tutor session not found.");
  await requireCourse(context, session.project_id, signal);
  return session;
}

function linkedAbort(req, res, timeoutMs) {
  const controller = new AbortController();
  const abort = (reason) => { if (!controller.signal.aborted) controller.abort(reason); };
  const timer = setTimeout(() => abort(new Error("timeout")), timeoutMs);
  const onReqAbort = () => abort(req.signal?.reason);
  const onClose = () => { if (!res.writableEnded) abort(new Error("client_closed")); };
  if (req.signal?.aborted) abort(req.signal.reason);
  else req.signal?.addEventListener("abort", onReqAbort, { once: true });
  res.on("close", onClose);
  return {
    signal: controller.signal,
    stop() {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onReqAbort);
      if (typeof res.off === "function") res.off("close", onClose);
    }
  };
}

export async function handleStudyCourseTutor(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  const source = await requireCourseSource(context, course, body, req.signal);
  enforceRateLimit(req, "study-tutor-prepare", 20, 60 * 60_000, context.user.id);
  await createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode
  }).checkBudget(req.signal);

  const run = linkedAbort(req, res, PREPARE_TIMEOUT_MS);
  const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat" }), 15_000);
  let warning = null;
  try {
    startSse(res);
    const session = await prepareTutorSession({
      context,
      config,
      course,
      source,
      options: body,
      signal: run.signal,
      onWarning: (message) => { warning = message || warning; },
      onStage: (stage) => writeSse(res, { type: "status", stage })
    });
    writeSse(res, { type: "complete", result: { type: "tutor", session: publicTutorSession(session), ...(warning ? { warning } : {}) } });
  } catch (error) {
    const aborted = run.signal.aborted || error?.name === "AbortError";
    writeSse(res, { type: "error", error: aborted ? "Preparation cancelled." : (error instanceof HttpError ? error.message : "Could not prepare the lesson. Try again.") });
  } finally {
    clearInterval(heartbeat);
    run.stop();
    endStudySse(res);
  }
}

export async function handleStudyTutorById(req, res, config, sessionId) {
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const session = await requireTutorSession(context, sessionId, req.signal);
  if (req.method === "PATCH") {
    const title = cleanDeckTitle((await parseJsonBody(req)).title);
    const updated = await context.db.updateStudyTutorSession(context.user.id, session.id, { title }, { signal: req.signal });
    sendJson(res, 200, { title: updated?.title || title });
    return;
  }
  if (req.method === "DELETE") {
    await context.db.deleteStudyTutorSession(context.user.id, session.id, { signal: req.signal });
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 200, { session: publicTutorSession(session) });
}

export async function handleStudyTutorTurn(req, res, config, sessionId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  enforceRateLimit(req, "study-tutor-turn", 40, 60_000, context.user.id);
  const body = await parseJsonBody(req);
  const mode = ["start", "reply", "nudge", "closing"].includes(body.mode) ? body.mode : "reply";

  const previous = turnChains.get(sessionId) || Promise.resolve();
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  turnChains.set(sessionId, done);
  const run = linkedAbort(req, res, TURN_TIMEOUT_MS);
  try {
    await Promise.race([previous, new Promise((resolve) => setTimeout(resolve, 20_000))]);
    // Read after the previous turn saved, so this turn sees the whole conversation.
    const session = await requireTutorSession(context, sessionId, run.signal);
    startSse(res);
    await runTutorTurn({
      context,
      config,
      session,
      mode,
      text: body.text,
      elapsed: body.elapsed,
      signal: run.signal,
      emit: (event) => writeSse(res, event)
    });
  } catch (error) {
    if (!res.headersSent) throw error;
    if (!run.signal.aborted) {
      writeSse(res, {
        type: "error",
        error: error instanceof HttpError ? error.message : "The tutor could not answer. Try again.",
        ...(error?.details?.code ? { code: error.details.code } : {})
      });
    }
  } finally {
    run.stop();
    release();
    if (turnChains.get(sessionId) === done) turnChains.delete(sessionId);
    if (res.headersSent) endStudySse(res);
  }
}

export async function handleStudyTutorTranscribe(req, res, config, sessionId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  if (!config.providers?.openrouter?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");
  enforceRateLimit(req, "study-tutor-stt", 90, 60_000, context.user.id);
  const session = await requireTutorSession(context, sessionId, req.signal);
  if (session.status === "ended") throw new HttpError(409, "This tutor session has ended.");
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) throw new HttpError(415, "An audio recording is required.");
  const audio = await readRawBody(req, TUTOR_STT_MAX_BYTES);
  if (!audio.length) throw new HttpError(400, "The audio recording is empty.");
  // Live MediaRecorder WebM has no duration header; the byte cap bounds it and billing uses
  // the seconds Grok reports.
  let durationSeconds = 0;
  try {
    durationSeconds = validatedAudioDuration(audio, contentType, { maxSeconds: TUTOR_STT_MAX_SECONDS });
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
    model: TUTOR_STT_MODEL,
    ...apiUsageWindow(context.subscription, context.plan),
    reservedCredits: TUTOR_STT_RESERVATION
  }, { signal: AbortSignal.timeout(15_000) });
  if (reservation?.duplicate) throw new HttpError(409, "This request ID has already been used.");
  if (reservation?.reason === "usage_metering_disabled") throw new HttpError(503, "Usage metering is temporarily unavailable.");
  if (!reservation?.allowed) throw new HttpError(429, "You've reached your weekly limit. You can continue after it resets.", { code: "usage_exhausted", retryable: false });

  const signal = AbortSignal.any([req.signal || new AbortController().signal, AbortSignal.timeout(30_000)]);
  const settle = (fields) => settleSpeechUsage(context, { requestId, durationSeconds, signal: AbortSignal.timeout(15_000), ...fields });
  try {
    await context.db.markApiUsageSubmitted({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) });
  } catch {
    await context.db.releaseApiUsage({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new HttpError(503, "Usage metering is temporarily unavailable.");
  }
  let response;
  try {
    response = await transcribeAudio(config, audio, contentType, signal, TUTOR_STT_MODEL);
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
  await settle({ payload, ok: true }).catch(() => {});
  sendJson(res, 200, { text: String(payload?.text || "").trim(), seconds: Number(payload?.usage?.seconds) || durationSeconds || 0 });
}

export async function handleStudyTutorEnd(req, res, config, sessionId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  // Let an in-flight turn save first so the recap sees the last exchange.
  await Promise.race([turnChains.get(sessionId) || null, new Promise((resolve) => setTimeout(resolve, 10_000))]);
  const session = await requireTutorSession(context, sessionId, req.signal);
  if (session.status === "ended" && session.summary) {
    sendJson(res, 200, { session: publicTutorSession(session) });
    return;
  }
  const ended = await endTutorSession({ context, config, session, elapsed: body.elapsed, signal: req.signal });
  sendJson(res, 200, { session: publicTutorSession(ended || session) });
}
