import { single } from "./helpers.js";

export async function getMessage(client, userId, messageId, { signal } = {}) {
  const rows = await client.request("messages", {
    query: {
      id: `eq.${messageId}`,
      user_id: `eq.${userId}`,
      select: "id,user_id,conversation_id,role,content,model,created_at",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function getOpenContentReport(client, reporterId, messageId, { signal } = {}) {
  const rows = await client.request("content_reports", {
    query: {
      reporter_id: `eq.${reporterId}`,
      message_id: `eq.${messageId}`,
      status: "eq.open",
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function createContentReport(client, row, { signal } = {}) {
  const rows = await client.request("content_reports", {
    method: "POST",
    body: row,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function getContentReport(client, id, { signal } = {}) {
  const rows = await client.request("content_reports", {
    query: {
      id: `eq.${id}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function resolveContentReport(client, id, resolvedBy, { signal } = {}) {
  const rows = await client.request("content_reports", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: {
      status: "done",
      resolved_by: resolvedBy || null,
      resolved_at: new Date().toISOString()
    },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}
