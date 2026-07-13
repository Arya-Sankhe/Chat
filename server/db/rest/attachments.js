import { single } from "./helpers.js";

export async function createAttachment(client, attachment, { signal } = {}) {
  const rows = await client.request("attachments", {
    method: "POST",
    body: attachment,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function completeAttachment(client, userId, attachmentId, patch, { signal } = {}) {
  const rows = await client.request("attachments", {
    method: "PATCH",
    query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
    body: { ...patch, status: "uploaded", uploaded_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function updateAttachment(client, userId, attachmentId, patch, { signal } = {}) {
  const rows = await client.request("attachments", {
    method: "PATCH",
    query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
    body: patch,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getAttachment(client, userId, attachmentId, { signal } = {}) {
  const rows = await client.request("attachments", {
    query: {
      id: `eq.${attachmentId}`,
      user_id: `eq.${userId}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function listOrphanAttachments(client, { before, limit = 100, signal } = {}) {
  return client.request("attachments", {
    query: {
      conversation_id: "is.null",
      message_id: "is.null",
      or: "(project_id.is.null,and(project_id.not.is.null,status.eq.pending))",
      created_at: `lt.${before}`,
      select: "id,user_id,object_key,category,file_name,content_type,size_bytes,etag,created_at",
      order: "created_at.asc",
      limit: String(limit)
    },
    signal
  });
}

export async function deleteAttachment(client, userId, attachmentId, { signal } = {}) {
  return client.request("attachments", {
    method: "DELETE",
    query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}
