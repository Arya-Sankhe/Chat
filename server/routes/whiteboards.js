import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { enforceRateLimit } from "../http/rateLimit.js";
import { startSse, writeSse } from "../chat/shared.js";
import { createModelUsageMeter } from "../saas/usageMeter.js";
import { stripImageMetadata } from "../storage/stripImageMetadata.js";
import { mapStorageRpcError } from "../saas/storageQuota.js";
import { assertRaster, normalizeAsk, publicTurn, runWhiteboardAsk } from "../study/whiteboard.js";
import { LIMITS, SceneError, cleanTitle, validateScene } from "../../public/js/whiteboard/schema.js";
import { requireChatContext } from "./context.js";
import { endStudySse, requireCourse } from "./study.js";

const ASK_TIMEOUT_MS = 90_000;
const FILE_MAX_BYTES = 4 * 1024 * 1024;
const TURN_PAGE = 50;
const FILE_ID = /^[\w-]{1,64}$/;
// ponytail: in-process, like the tutor's turn chains. One ask per board at a time.
const activeAsks = new Set();

export function publicBoard(board) {
  return {
    id: board.id,
    courseId: board.project_id,
    title: board.title || "Whiteboard",
    scene: board.scene || { schemaVersion: 1, elements: [], appState: {} },
    revision: Number(board.revision) || 0,
    createdAt: board.created_at,
    updatedAt: board.updated_at
  };
}

const isDeleting = (board) => Number(board?.revision) < 0;

async function requireBoard(context, boardId, signal, { deleting = false } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(String(boardId))) throw new HttpError(404, "Whiteboard not found.");
  const board = await context.db.getStudyWhiteboard(context.user.id, boardId, { signal });
  // A board marked for deletion is gone for everything except finishing that deletion.
  if (!board || (isDeleting(board) && !deleting)) throw new HttpError(404, "Whiteboard not found.");
  const course = await requireCourse(context, board.project_id, signal);
  return { board, course };
}

/**
 * Deletes a board's images from R2 and their attachment rows (the bytes stop counting). The board
 * row (and so its file rows, the record of what to clean up) stays until this has succeeded.
 */
export async function deleteBoardFiles(context, boardId, signal) {
  const files = await context.db.listStudyWhiteboardFiles(context.user.id, boardId, { signal }) || [];
  const attachments = files.map((file) => (Array.isArray(file.attachments) ? file.attachments[0] : file.attachments)).filter(Boolean);
  const keys = attachments.map((attachment) => attachment.object_key).filter(Boolean);
  if (keys.length) await context.r2.deleteObjects(keys, { signal });
  for (const attachment of attachments) await context.db.deleteAttachment(context.user.id, attachment.id, { signal });
}

export async function handleCourseWhiteboards(req, res, config, courseId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const course = await requireCourse(context, courseId, req.signal);
  enforceRateLimit(req, "study-whiteboard-create", 30, 60 * 60_000, context.user.id);
  const body = await parseJsonBody(req);
  const board = await context.db.createStudyWhiteboard(context.user.id, {
    project_id: course.id,
    title: cleanTitle(body.title, "Untitled board")
  }, { signal: req.signal });
  sendJson(res, 201, { board: publicBoard(board) });
}

export async function handleWhiteboardById(req, res, config, boardId) {
  if (!["GET", "PATCH", "DELETE"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  if (req.method === "PATCH") {
    enforceRateLimit(req, "study-whiteboard-save", 240, 60_000, context.user.id);
    const body = await parseJsonBody(req, LIMITS.sceneBytes + 64 * 1024);
    const { board } = await requireBoard(context, boardId, req.signal);
    if (body.scene === undefined) {
      if (body.title === undefined) throw new HttpError(400, "Nothing to save.");
      const renamed = await context.db.renameStudyWhiteboard(context.user.id, board.id, cleanTitle(body.title, board.title), { signal: req.signal });
      sendJson(res, 200, { title: renamed?.title || board.title, revision: Number(board.revision) || 0 });
      return;
    }
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw new HttpError(400, "expectedRevision is required.");
    let scene;
    try {
      scene = validateScene(body.scene);
    } catch (error) {
      if (error instanceof SceneError) throw new HttpError(422, error.message, { code: "invalid_scene" });
      throw error;
    }
    // Images must be ones uploaded to this board.
    const fileIds = new Set(scene.elements.filter((element) => element.type === "image" && element.fileId).map((element) => element.fileId));
    if (fileIds.size) {
      const owned = new Set((await context.db.listStudyWhiteboardFiles(context.user.id, board.id, { signal: req.signal }) || []).map((file) => file.file_id));
      if ([...fileIds].some((fileId) => !owned.has(fileId))) throw new HttpError(422, "An image on this board hasn't finished uploading.", { code: "invalid_scene" });
    }
    const patch = { scene, ...(body.title !== undefined ? { title: cleanTitle(body.title, board.title) } : {}) };
    const saved = await context.db.saveStudyWhiteboard(context.user.id, board.id, body.expectedRevision, patch, { signal: req.signal });
    if (!saved) {
      // Distinguish "deleted meanwhile" from "saved elsewhere first".
      const current = await context.db.getStudyWhiteboard(context.user.id, board.id, { signal: req.signal });
      if (!current || isDeleting(current)) throw new HttpError(404, "Whiteboard not found.");
      throw new HttpError(409, "This board was changed somewhere else.", { code: "revision_conflict", revision: Number(current.revision) || 0 });
    }
    sendJson(res, 200, { revision: saved.revision, title: saved.title, updatedAt: saved.updated_at });
    return;
  }
  const { board } = await requireBoard(context, boardId, req.signal, { deleting: req.method === "DELETE" });
  if (req.method === "DELETE") {
    // Mark first: an image registered after the file listing below then cleans itself up.
    const originalRevision = Number(board.revision);
    if (!isDeleting(board)) {
      const marked = await context.db.markStudyWhiteboardDeleting(context.user.id, board.id, originalRevision, { signal: req.signal });
      if (!marked) throw new HttpError(409, "This board changed while deleting. Try again.");
    }
    try {
      await deleteBoardFiles(context, board.id, req.signal);
      await context.db.deleteStudyWhiteboard(context.user.id, board.id, { signal: req.signal });
    } catch (error) {
      // Put the board back (with its remaining images listed) so deleting can be tried again.
      if (originalRevision >= 0) {
        await context.db.restoreStudyWhiteboard(context.user.id, board.id, originalRevision, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
      }
      throw error;
    }
    sendJson(res, 200, { ok: true });
    return;
  }
  const [files, turns] = await Promise.all([
    context.db.listStudyWhiteboardFiles(context.user.id, board.id, { signal: req.signal }),
    context.db.listStudyWhiteboardTurns(context.user.id, board.id, { limit: TURN_PAGE + 1, signal: req.signal })
  ]);
  sendJson(res, 200, {
    board: publicBoard(board),
    files: (files || []).map((file) => ({ fileId: file.file_id, mimeType: file.mime_type })),
    turns: (turns || []).slice(0, TURN_PAGE).map(publicTurn),
    moreTurns: (turns || []).length > TURN_PAGE
  });
}

export async function handleWhiteboardTurns(req, res, config, boardId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  const { board } = await requireBoard(context, boardId, req.signal);
  const before = new URL(req.url, "http://local").searchParams.get("before") || "";
  if (before && Number.isNaN(Date.parse(before))) throw new HttpError(400, "before must be a timestamp.");
  const turns = await context.db.listStudyWhiteboardTurns(context.user.id, board.id, { before, limit: TURN_PAGE + 1, signal: req.signal }) || [];
  sendJson(res, 200, { turns: turns.slice(0, TURN_PAGE).map(publicTurn), more: turns.length > TURN_PAGE });
}

/** One answer with the full context it was asked about, so a reopened thread can redraw it. */
export async function handleWhiteboardTurn(req, res, config, boardId, turnId) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  if (!/^[0-9a-f-]{36}$/i.test(String(turnId))) throw new HttpError(404, "Answer not found.");
  const context = await requireChatContext(req, config);
  const { board } = await requireBoard(context, boardId, req.signal);
  const turn = await context.db.getStudyWhiteboardTurn(context.user.id, board.id, turnId, { signal: req.signal });
  if (!turn) throw new HttpError(404, "Answer not found.");
  const stored = turn.context || {};
  sendJson(res, 200, {
    turn: publicTurn(turn),
    context: {
      captureMode: stored.captureMode,
      rect: stored.rect || null,
      elements: Array.isArray(stored.elements) ? stored.elements : [],
      sceneRevision: Number(stored.sceneRevision) || 0
    }
  });
}

export async function handleWhiteboardFiles(req, res, config, boardId, fileId) {
  if (!["GET", "POST"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
  if (!FILE_ID.test(String(fileId || ""))) throw new HttpError(400, "That image id is not valid.");
  const context = await requireChatContext(req, config);
  const { board, course } = await requireBoard(context, boardId, req.signal);
  if (req.method === "GET") {
    const file = await context.db.getStudyWhiteboardFile(context.user.id, board.id, fileId, { signal: req.signal });
    const attachment = Array.isArray(file?.attachments) ? file.attachments[0] : file?.attachments;
    if (!attachment?.object_key) throw new HttpError(404, "Image not found.");
    const bytes = await context.r2.getObject(attachment.object_key, { signal: req.signal });
    res.writeHead(200, {
      "content-type": file.mime_type,
      "content-length": String(bytes.length),
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox"
    });
    res.end(bytes);
    return;
  }
  enforceRateLimit(req, "study-whiteboard-file", 60, 60 * 60_000, context.user.id);
  const existing = await context.db.getStudyWhiteboardFile(context.user.id, board.id, fileId, { signal: req.signal });
  if (existing) {
    sendJson(res, 200, { fileId, mimeType: existing.mime_type });
    return;
  }
  const files = await context.db.listStudyWhiteboardFiles(context.user.id, board.id, { signal: req.signal }) || [];
  if (files.length >= LIMITS.files) throw new HttpError(409, `A board holds at most ${LIMITS.files} images.`);
  const raw = await readRawBody(req, FILE_MAX_BYTES);
  const info = assertRaster(raw, { maxBytes: FILE_MAX_BYTES });
  const bytes = info.mime === "image/gif" ? raw : stripImageMetadata(raw);
  const ext = info.mime.split("/")[1].replace("jpeg", "jpg");
  const fileName = `whiteboard-${fileId}.${ext}`;
  const objectKey = context.r2.objectKey({ userId: context.user.id, fileName });
  let attachment = null;
  try {
    // Filed under the course without a source document, so it counts toward storage, goes with
    // the course, and is never transcribed into course notes.
    attachment = await context.db.reserveAttachment({
      userId: context.user.id,
      maxBytes: context.plan.maxStorageBytes,
      category: "image",
      objectKey,
      fileName,
      contentType: info.mime,
      sizeBytes: bytes.length,
      projectId: course.id
    }, { signal: req.signal });
    const uploaded = await context.r2.putObject(objectKey, bytes, { contentType: info.mime, signal: req.signal });
    await context.db.completeReservedAttachment({
      userId: context.user.id,
      attachmentId: attachment.id,
      sizeBytes: bytes.length,
      etag: uploaded?.etag || null,
      maxBytes: context.plan.maxStorageBytes
    }, { signal: req.signal });
    await context.db.createStudyWhiteboardFile(context.user.id, { board_id: board.id, file_id: fileId, attachment_id: attachment.id, mime_type: info.mime }, { signal: req.signal });
    // The board may have started deleting after it was checked above; its cleanup may already
    // have listed the files, so this image removes itself.
    const still = await context.db.getStudyWhiteboard(context.user.id, board.id, { signal: req.signal });
    if (!still || isDeleting(still)) throw new HttpError(404, "Whiteboard not found.");
  } catch (error) {
    if (attachment?.id) {
      await context.r2.deleteObjects([objectKey]).catch(() => {});
      await context.db.deleteAttachment(context.user.id, attachment.id).catch(() => {});
    }
    // A second upload of the same image won the race; that copy is the one kept.
    if (error?.details?.code === "23505") {
      sendJson(res, 200, { fileId, mimeType: info.mime });
      return;
    }
    if (error instanceof HttpError) throw error;
    // The board row went away before the file row could point at it.
    if (error?.details?.code === "23503") throw new HttpError(404, "Whiteboard not found.");
    mapStorageRpcError(error);
  }
  sendJson(res, 201, { fileId, mimeType: info.mime });
}

export async function handleWhiteboardAsk(req, res, config, boardId) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  const context = await requireChatContext(req, config);
  if (config.desktop?.meteringMode !== "enforce") throw new HttpError(503, "Whiteboard answers need enforced usage metering.");
  if (!config.providers?.openrouter?.apiKey) throw new HttpError(503, "AI answers are not configured on the server.");
  enforceRateLimit(req, "study-whiteboard-ask", 30, 60_000, context.user.id);
  const body = await parseJsonBody(req, 3 * 1024 * 1024);
  const request = normalizeAsk(body);
  const { board, course } = await requireBoard(context, boardId, req.signal);
  await createModelUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    signal: req.signal,
    meteringMode: config.desktop.meteringMode
  }).checkBudget(req.signal);
  if (activeAsks.has(board.id)) throw new HttpError(409, "Klui is still answering on this board.");
  activeAsks.add(board.id);

  const controller = new AbortController();
  const abort = (reason) => { if (!controller.signal.aborted) controller.abort(reason); };
  const timer = setTimeout(() => abort(new Error("timeout")), ASK_TIMEOUT_MS);
  const onClose = () => { if (!res.writableEnded) abort(new Error("client_closed")); };
  res.on("close", onClose);
  const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat" }), 15_000);
  try {
    startSse(res);
    await runWhiteboardAsk({ context, config, course, board, request, signal: controller.signal, emit: (event) => writeSse(res, event) });
  } catch (error) {
    if (!controller.signal.aborted) {
      writeSse(res, {
        type: "error",
        code: error?.details?.code || (error instanceof HttpError ? `http_${error.status}` : "failed"),
        error: error instanceof HttpError ? error.message : "Klui could not answer. Try again."
      });
    }
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    res.off?.("close", onClose);
    activeAsks.delete(board.id);
    endStudySse(res);
  }
}
