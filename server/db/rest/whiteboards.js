import { single } from "./helpers.js";

const BOARD_LIST_SELECT = "id,project_id,title,revision,created_at,updated_at";
const BOARD_SELECT = "id,user_id,project_id,title,scene,revision,created_at,updated_at";
const TURN_SELECT = "id,board_id,thread_id,parent_turn_id,client_request_id,mode,voice,question,context,answer,proposal,citations,status,error_code,created_at,finished_at";

export async function listStudyWhiteboards(client, userId, projectId, { signal } = {}) {
  return client.request("study_whiteboards", {
    // A negative revision marks a board being deleted.
    query: { user_id: `eq.${userId}`, project_id: `eq.${projectId}`, revision: "gte.0", select: BOARD_LIST_SELECT, order: "created_at.desc" },
    signal
  });
}

export async function getStudyWhiteboard(client, userId, id, { signal } = {}) {
  const rows = await client.request("study_whiteboards", {
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: BOARD_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyWhiteboard(client, userId, board, { signal } = {}) {
  const rows = await client.request("study_whiteboards", {
    method: "POST",
    body: { ...board, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

/**
 * Saves only when the board is still at `expectedRevision`, bumping it by one. Returns the saved
 * row, or null when nothing matched (the board is gone or someone else saved first).
 */
export async function saveStudyWhiteboard(client, userId, id, expectedRevision, patch, { signal } = {}) {
  const rows = await client.request("study_whiteboards", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, revision: `eq.${expectedRevision}`, select: "id,title,revision,updated_at" },
    body: { ...patch, revision: expectedRevision + 1, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

/** Renames without touching the drawing's revision. */
export async function renameStudyWhiteboard(client, userId, id, title, { signal } = {}) {
  const rows = await client.request("study_whiteboards", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: "id,title" },
    body: { title },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

/**
 * Marks a board as being deleted before its images are removed. Saves stop matching
 * and an image upload that lands meanwhile sees the mark and removes itself.
 */
export async function markStudyWhiteboardDeleting(client, userId, id, revision, { signal } = {}) {
  const rows = await client.request("study_whiteboards", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, revision: `eq.${revision}` },
    body: { revision: -revision - 1 },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

/** Undo only our deletion mark, preserving the drawing and its revision. */
export async function restoreStudyWhiteboard(client, userId, id, revision, { signal } = {}) {
  return client.request("study_whiteboards", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, revision: `eq.${-revision - 1}` },
    body: { revision },
    prefer: "return=minimal",
    signal
  });
}

export async function deleteStudyWhiteboard(client, userId, id, { signal } = {}) {
  return client.request("study_whiteboards", {
    method: "DELETE",
    query: { id: `eq.${id}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}

export async function listStudyWhiteboardFiles(client, userId, boardId, { signal } = {}) {
  return client.request("study_whiteboard_files", {
    query: {
      board_id: `eq.${boardId}`,
      user_id: `eq.${userId}`,
      select: "file_id,attachment_id,mime_type,created_at,attachments(id,object_key,size_bytes,status)",
      order: "created_at.asc"
    },
    signal
  });
}

export async function getStudyWhiteboardFile(client, userId, boardId, fileId, { signal } = {}) {
  const rows = await client.request("study_whiteboard_files", {
    query: {
      board_id: `eq.${boardId}`,
      user_id: `eq.${userId}`,
      file_id: `eq.${fileId}`,
      select: "file_id,attachment_id,mime_type,attachments(id,object_key,status)",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function createStudyWhiteboardFile(client, userId, file, { signal } = {}) {
  const rows = await client.request("study_whiteboard_files", {
    method: "POST",
    body: { ...file, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

/** Whether an attachment is an image on one of the user's boards. */
export async function isWhiteboardAttachment(client, userId, attachmentId, { signal } = {}) {
  const rows = await client.request("study_whiteboard_files", {
    query: { user_id: `eq.${userId}`, attachment_id: `eq.${attachmentId}`, select: "board_id", limit: "1" },
    signal
  });
  return Boolean(single(rows));
}

export async function listStudyWhiteboardTurns(client, userId, boardId, { before = "", limit = 50, signal } = {}) {
  return client.request("study_whiteboard_turns", {
    query: {
      board_id: `eq.${boardId}`,
      user_id: `eq.${userId}`,
      ...(before ? { created_at: `lt.${before}` } : {}),
      select: TURN_SELECT,
      order: "created_at.desc",
      limit: String(limit)
    },
    signal
  });
}

export async function listStudyWhiteboardThread(client, userId, boardId, threadId, { limit = 12, signal } = {}) {
  return client.request("study_whiteboard_turns", {
    query: {
      board_id: `eq.${boardId}`,
      user_id: `eq.${userId}`,
      thread_id: `eq.${threadId}`,
      select: TURN_SELECT,
      order: "created_at.desc",
      limit: String(limit)
    },
    signal
  });
}

export async function getStudyWhiteboardTurn(client, userId, boardId, id, { signal } = {}) {
  const rows = await client.request("study_whiteboard_turns", {
    query: { id: `eq.${id}`, board_id: `eq.${boardId}`, user_id: `eq.${userId}`, select: TURN_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function findStudyWhiteboardTurnByRequest(client, userId, boardId, clientRequestId, { signal } = {}) {
  const rows = await client.request("study_whiteboard_turns", {
    query: { board_id: `eq.${boardId}`, user_id: `eq.${userId}`, client_request_id: `eq.${clientRequestId}`, select: TURN_SELECT, limit: "1" },
    signal
  });
  return single(rows);
}

export async function createStudyWhiteboardTurn(client, userId, turn, { signal } = {}) {
  const rows = await client.request("study_whiteboard_turns", {
    method: "POST",
    body: { ...turn, user_id: userId },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateStudyWhiteboardTurn(client, userId, id, patch, { signal } = {}) {
  const rows = await client.request("study_whiteboard_turns", {
    method: "PATCH",
    query: { id: `eq.${id}`, user_id: `eq.${userId}`, select: TURN_SELECT },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}
