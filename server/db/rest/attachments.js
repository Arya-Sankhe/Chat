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

export async function deleteAttachment(client, userId, attachmentId, { signal } = {}) {
  return client.request("attachments", {
    method: "DELETE",
    query: { id: `eq.${attachmentId}`, user_id: `eq.${userId}` },
    prefer: "return=minimal",
    signal
  });
}
