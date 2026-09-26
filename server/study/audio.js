import { HttpError } from "../http/responses.js";
import { mapStorageRpcError } from "../saas/storageQuota.js";

// Browsers report a lot of audio MIME types (and sometimes none); the extension decides
// when the type is missing or generic. Everything is stored as audio/* so the queue
// accepts it, and ffmpeg in the transcriber reads the real container.
const AUDIO_EXTENSIONS = new Map([
  [".mp3", "audio/mpeg"],
  [".m4a", "audio/mp4"],
  [".mp4", "audio/mp4"],
  [".aac", "audio/aac"],
  [".wav", "audio/wav"],
  [".webm", "audio/webm"],
  [".ogg", "audio/ogg"],
  [".oga", "audio/ogg"],
  [".opus", "audio/ogg"],
  [".flac", "audio/flac"],
  [".caf", "audio/x-caf"],
  [".aiff", "audio/aiff"],
  [".aif", "audio/aiff"]
]);

export const AUDIO_SOURCE_KINDS = ["upload", "recording"];

function extensionOf(fileName) {
  const match = /\.[a-z0-9]+$/i.exec(String(fileName || ""));
  return match ? match[0].toLowerCase() : "";
}

export function audioContentType({ fileName, contentType }) {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (type.startsWith("audio/")) return type;
  // Recorders on some browsers label audio-only captures as video/webm or video/mp4.
  if (type === "video/webm") return "audio/webm";
  if (type === "video/mp4") return "audio/mp4";
  return AUDIO_EXTENSIONS.get(extensionOf(fileName)) || "";
}

export function isAudioUpload(input) {
  return Boolean(audioContentType(input));
}

function cleanTitle(value, fallback) {
  const title = String(value || "").replace(/[\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
  return (title || fallback).slice(0, 120);
}

function titleFromFileName(fileName) {
  return String(fileName || "").replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").trim();
}

function cleanDuration(value, maxSeconds) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (seconds > maxSeconds) {
    throw new HttpError(413, `Recordings can be up to ${Math.round(maxSeconds / 3600)} hours long.`);
  }
  return Math.round(seconds * 100) / 100;
}

function requireAudioEnabled(config) {
  if (!config.studyAudio?.enabled) throw new HttpError(503, "Audio sources are not available right now.");
}

function uploadLimitMessage(maxBytes) {
  return `Audio files can be up to ${Math.round(maxBytes / (1024 * 1024))} MB.`;
}

export async function presignCourseAudio({ context, config, course, body, signal }) {
  requireAudioEnabled(config);
  const fileName = String(body?.fileName || "").trim().slice(0, 200) || "Recording.webm";
  const contentType = audioContentType({ fileName, contentType: body?.contentType });
  if (!contentType) throw new HttpError(400, "Choose an audio file such as MP3, M4A, WAV, or WebM.");
  const sizeBytes = Number(body?.sizeBytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw new HttpError(400, "This audio file is empty.");
  const maxBytes = config.studyAudio.maxUploadBytes;
  if (sizeBytes > maxBytes) throw new HttpError(413, uploadLimitMessage(maxBytes));
  cleanDuration(body?.durationSeconds, config.studyAudio.maxSeconds);

  const objectKey = context.r2.objectKey({ userId: context.user.id, fileName });
  let attachment;
  try {
    attachment = await context.db.reserveAttachment({
      userId: context.user.id,
      maxBytes: context.plan.maxStorageBytes,
      category: "document",
      objectKey,
      fileName,
      contentType,
      sizeBytes,
      projectId: course.id
    }, { signal });
  } catch (error) {
    mapStorageRpcError(error);
  }
  return {
    uploadId: attachment.id,
    uploadUrl: context.r2.uploadUrl(objectKey, config.studyAudio.uploadExpiresSeconds, { contentLength: sizeBytes, contentType }),
    method: "PUT",
    headers: context.r2.uploadHeaders(contentType),
    category: "document",
    contentType
  };
}

function mapEnqueueError(error) {
  const text = String(error?.message || "");
  if (text.includes("project_storage_limit_exceeded")) {
    throw new HttpError(413, "This course is full. Remove sources to free up space.");
  }
  if (text.includes("transcription_queue_full")) {
    throw new HttpError(429, "You already have several recordings in the queue. Add more once one finishes.");
  }
  if (text.includes("invalid_audio_attachment") || text.includes("invalid_attachment_size")) {
    throw new HttpError(400, "This upload could not be added. Please try again.");
  }
  mapStorageRpcError(error);
}

export async function enqueueCourseAudio({ context, config, course, body, signal }) {
  requireAudioEnabled(config);
  const uploadId = typeof body?.uploadId === "string" ? body.uploadId.trim() : "";
  if (!uploadId) throw new HttpError(400, "uploadId is required.");
  const attachment = await context.db.getAttachment(context.user.id, uploadId, { signal });
  if (!attachment || attachment.project_id !== course.id) throw new HttpError(404, "Upload not found.");
  const source = AUDIO_SOURCE_KINDS.includes(body?.source) ? body.source : "upload";
  const queued = attachment.status === "uploaded";
  if (!queued && attachment.status !== "pending") throw new HttpError(409, "This recording was already added.");
  try {
    const duration = cleanDuration(body?.durationSeconds, config.studyAudio.maxSeconds);
    // A retried request for an upload that is already queued gets the same answer back.
    const head = queued ? { sizeBytes: Number(attachment.size_bytes), etag: attachment.etag } : await context.r2.headObject(attachment.object_key, { signal });
    const sizeBytes = Number(head.sizeBytes);
    if (!Number.isInteger(sizeBytes) || sizeBytes !== Number(attachment.size_bytes)) {
      throw new HttpError(400, "The upload did not finish. Please try again.");
    }
    const fallback = source === "recording"
      ? `Recording · ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : titleFromFileName(attachment.file_name) || "Audio";
    const result = await context.db.rpc("klui_enqueue_transcription", {
      p_user_id: context.user.id,
      p_attachment_id: attachment.id,
      p_project_id: course.id,
      p_title: cleanTitle(body?.title, fallback),
      p_audio_source: source,
      p_duration_hint: duration,
      p_size_bytes: sizeBytes,
      p_etag: head.etag || null,
      p_project_max_bytes: context.plan.maxProjectBytes,
      p_max_active: config.studyAudio.maxActivePerUser,
      p_queue: config.studyAudio.queue,
      p_account_max_bytes: context.plan.maxStorageBytes
    }, { signal });
    return { document: result?.document, job: publicJob(result?.job) };
  } catch (error) {
    const released = !queued && await releaseIfNotQueued(context, config, attachment);
    let problem = error;
    if (!(error instanceof HttpError)) {
      try { mapEnqueueError(error); } catch (mapped) { problem = mapped; }
    }
    // Tell the browser its upload is gone, so its retry starts over instead of reusing it.
    if (released && problem instanceof HttpError) problem.details = { ...problem.details, uploadReleased: true };
    throw problem;
  }
}

// An error doesn't prove nothing was queued: the enqueue may still be running, or it
// committed and only the response was lost. The database decides under the attachment's
// row lock, so a queued upload is never removed. A released object is also on the cleanup
// list, so if this delete fails the transcriber removes it later. Returns whether the
// upload was released.
async function releaseIfNotQueued(context, config, attachment) {
  try {
    const key = await context.db.rpc("klui_release_pending_audio", {
      p_user_id: context.user.id, p_attachment_id: attachment.id, p_queue: config.studyAudio.queue
    });
    if (!key) return false;
    await context.r2.deleteObjects([key]).catch(() => {});
    return true;
  } catch {
    // Leave it for the pending-upload sweep and the cleanup list.
    return false;
  }
}

export function publicJob(row) {
  if (!row) return null;
  return {
    documentFileId: row.document_file_id,
    status: row.status,
    stage: row.stage || null,
    progress: Number(row.progress) || 0,
    durationSeconds: Number(row.duration_seconds) || 0,
    error: row.error?.message || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null
  };
}

export async function listCourseTranscriptions({ context, course, signal }) {
  const rows = await context.db.rpc("klui_transcription_status", {
    p_user_id: context.user.id, p_project_id: course.id
  }, { signal });
  return (rows || []).map(publicJob);
}

export async function retryCourseTranscription({ context, config, documentFileId, signal }) {
  requireAudioEnabled(config);
  try {
    return publicJob(await context.db.rpc("klui_retry_transcription_job", {
      p_user_id: context.user.id, p_document_file_id: documentFileId,
      p_max_active: config.studyAudio.maxActivePerUser
    }, { signal }));
  } catch (error) {
    const text = String(error?.message || "");
    if (text.includes("transcription_not_retryable")) {
      throw new HttpError(409, "This recording is not waiting for a retry.");
    }
    if (text.includes("transcription_queue_full")) {
      throw new HttpError(429, "You already have several recordings in the queue. Retry once one finishes.");
    }
    throw error;
  }
}

export async function cancelCourseTranscription(context, documentFileId, signal) {
  await context.db.rpc("klui_cancel_transcription_job", {
    p_user_id: context.user.id, p_document_file_id: documentFileId
  }, { signal });
}

// The player needs the transcript lines and a signed link to the compact audio copy.
export function publicAudioSource(documentFile, r2) {
  const attachment = Array.isArray(documentFile.attachments) ? documentFile.attachments[0] : documentFile.attachments;
  const meta = documentFile.metadata && typeof documentFile.metadata === "object" ? documentFile.metadata : {};
  const segments = Array.isArray(meta.segments) ? meta.segments : [];
  const ready = documentFile.processing_status === "ready";
  const contentType = attachment?.content_type || "audio/mp4";
  const title = meta.title || titleFromFileName(attachment?.file_name) || "Audio";
  return {
    id: documentFile.id,
    title,
    source: meta.audio_source || "upload",
    status: documentFile.processing_status,
    durationSeconds: Number(meta.duration_seconds) || 0,
    wordCount: Number(documentFile.word_count) || 0,
    createdAt: documentFile.created_at,
    transcript: segments
      .filter((line) => Array.isArray(line) && line.length >= 3)
      .map(([start, end, text]) => ({ start: Number(start) || 0, end: Number(end) || 0, text: String(text || "") })),
    audioUrl: ready && attachment ? r2.readUrl(attachment.object_key, { disposition: "inline", contentType }) : "",
    downloadUrl: ready && attachment ? r2.readUrl(attachment.object_key, { fileName: `${title}.m4a`, contentType }) : ""
  };
}
