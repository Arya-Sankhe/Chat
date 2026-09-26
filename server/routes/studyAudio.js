import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import {
  enqueueCourseAudio,
  listCourseTranscriptions,
  presignCourseAudio,
  publicAudioSource,
  retryCourseTranscription
} from "../study/audio.js";
import { requireChatContext } from "./context.js";
import { requireCourse } from "./study.js";

// POST /api/study/courses/:id/audio           -> presigned upload for a lecture or recording
// POST /api/study/courses/:id/audio/complete  -> the upload landed; queue it for transcription
export async function handleStudyCourseAudio(req, res, config, courseId, action = "") {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  const body = await parseJsonBody(req);
  if (action === "complete") {
    enforceRateLimit(req, "study-audio-complete", 20, 60_000, context.user.id);
    sendJson(res, 201, await enqueueCourseAudio({ context, config, course, body, signal: req.signal }));
    return;
  }
  if (action) throw new HttpError(404, "Not found.");
  enforceRateLimit(req, "study-audio-presign", 20, 60_000, context.user.id);
  sendJson(res, 200, await presignCourseAudio({ context, config, course, body, signal: req.signal }));
}

// GET  /api/study/courses/:id/transcriptions             -> queue state for the Sources panel
// POST /api/study/courses/:id/transcriptions/:docId/retry -> put a failed one back in line
export async function handleStudyCourseTranscriptions(req, res, config, courseId, documentFileId = "", action = "") {
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  if (req.method === "GET" && !documentFileId) {
    sendJson(res, 200, { jobs: await listCourseTranscriptions({ context, course, signal: req.signal }) });
    return;
  }
  if (req.method === "POST" && documentFileId && action === "retry") {
    enforceRateLimit(req, "study-audio-retry", 10, 60_000, context.user.id);
    const documentFile = await context.db.getDocumentFile(context.user.id, documentFileId, { signal: req.signal });
    if (!documentFile || documentFile.project_id !== course.id || documentFile.kind !== "audio") {
      throw new HttpError(404, "Recording not found.");
    }
    sendJson(res, 200, { job: await retryCourseTranscription({ context, config, documentFileId, signal: req.signal }) });
    return;
  }
  throw new HttpError(405, "Method not allowed.");
}

// GET /api/study/audio/:documentFileId -> transcript lines + signed audio link for the player
export async function handleStudyAudioSource(req, res, config, documentFileId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const documentFile = await context.db.getDocumentFile(context.user.id, documentFileId, { signal: req.signal });
  if (!documentFile || documentFile.kind !== "audio") throw new HttpError(404, "Recording not found.");
  sendJson(res, 200, { audio: publicAudioSource(documentFile, context.r2) });
}
