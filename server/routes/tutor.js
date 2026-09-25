import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { startSse, writeSse } from "../chat/shared.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { endTutorSession, prepareTutorSession, publicTutorSession, runTutorTurn } from "../study/tutor.js";
import { requireChatContext } from "./context.js";
import { transcribeLiveRecording } from "./speech.js";
import { cleanDeckTitle, endStudySse, requireCourse, requireCourseSource } from "./study.js";

const TURN_TIMEOUT_MS = 90_000;
const PREPARE_TIMEOUT_MS = 5 * 60_000;

// ponytail: in-process only, like study generation locks. One turn per call at a time; a new turn
// waits for the previous one (possibly interrupted) to save its transcript first. The wait never
// times out into overlap: every turn is bounded by TURN_TIMEOUT_MS and always releases.
const turnChains = new Map();

function afterPrevious(previous, signal) {
  if (!previous) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const stop = () => reject(new HttpError(409, "The previous tutor turn is still finishing."));
    if (signal?.aborted) return stop();
    signal?.addEventListener("abort", stop, { once: true });
    previous.then(() => { signal?.removeEventListener("abort", stop); resolve(); });
  });
}

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

  const previous = turnChains.get(sessionId) || null;
  let release;
  const done = new Promise((resolve) => { release = resolve; });
  turnChains.set(sessionId, done);
  const run = linkedAbort(req, res, TURN_TIMEOUT_MS);
  try {
    await afterPrevious(previous, run.signal);
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
  sendJson(res, 200, await transcribeLiveRecording(req, context, config));
}

export async function handleStudyTutorEnd(req, res, config, sessionId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const body = await parseJsonBody(req);
  // Let an in-flight turn save first so the recap sees the last exchange.
  await afterPrevious(turnChains.get(sessionId), req.signal);
  const session = await requireTutorSession(context, sessionId, req.signal);
  if (session.status === "ended" && session.summary) {
    sendJson(res, 200, { session: publicTutorSession(session) });
    return;
  }
  const ended = await endTutorSession({ context, config, session, elapsed: body.elapsed, signal: req.signal });
  sendJson(res, 200, { session: publicTutorSession(ended || session) });
}
