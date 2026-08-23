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

export async function reserveAttachment(client, {
  userId,
  maxBytes,
  category,
  objectKey,
  fileName,
  contentType,
  sizeBytes,
  conversationId = null,
  messageId = null,
  projectId = null
}, { signal } = {}) {
  return client.rpc("klui_reserve_attachment", {
    p_user_id: userId,
    p_max_bytes: maxBytes,
    p_category: category,
    p_object_key: objectKey,
    p_file_name: fileName,
    p_content_type: contentType,
    p_size_bytes: sizeBytes,
    p_conversation_id: conversationId,
    p_message_id: messageId,
    p_project_id: projectId
  }, { signal });
}

export async function completeReservedAttachment(client, {
  userId,
  attachmentId,
  sizeBytes,
  etag = null,
  maxBytes
}, { signal } = {}) {
  return client.rpc("klui_complete_attachment", {
    p_user_id: userId,
    p_attachment_id: attachmentId,
    p_size_bytes: sizeBytes,
    p_etag: etag,
    p_max_bytes: maxBytes
  }, { signal });
}

export async function accountStorageUsed(client, userId, { excludeId = null, signal } = {}) {
  return client.rpc("klui_account_storage_used", {
    p_user_id: userId,
    p_exclude_id: excludeId
  }, { signal });
}

export async function listUserStorageAttachments(client, userId, { limit = 200, signal } = {}) {
  return client.request("attachments", {
    query: {
      user_id: `eq.${userId}`,
      status: "in.(pending,uploaded)",
      select: "id,file_name,content_type,category,status,size_bytes,created_at,conversation_id,message_id,project_id,conversations(id,title),messages(conversation_id,conversations(id,title)),projects(id,name),document_files(source,processing_status)",
      order: "size_bytes.desc,created_at.desc",
      limit: String(limit)
    },
    signal
  });
}

export async function listAccountObjectKeys(client, userId, { signal } = {}) {
  const scoped = { user_id: `eq.${userId}`, limit: "5000" };
  const [attachments, documents, pages] = await Promise.all([
    client.request("attachments", { query: { ...scoped, select: "object_key" }, signal }),
    client.request("document_files", { query: { ...scoped, select: "extraction_key,preview_key" }, signal }),
    client.request("document_pages", { query: { ...scoped, select: "image_key" }, signal })
  ]);
  const keys = [];
  for (const row of attachments || []) {
    if (row.object_key) keys.push(row.object_key);
  }
  for (const row of documents || []) {
    if (row.extraction_key) keys.push(row.extraction_key);
    if (row.preview_key) keys.push(row.preview_key);
  }
  for (const row of pages || []) {
    if (row.image_key) keys.push(row.image_key);
  }
  return keys;
}

export async function listConversationStorageTotals(client, userId, { signal } = {}) {
  return client.rpc("klui_conversation_storage_totals", { p_user_id: userId }, { signal });
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

export async function listStalePendingAttachments(client, { before, limit = 100, signal } = {}) {
  return client.request("attachments", {
    query: {
      status: "eq.pending",
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
