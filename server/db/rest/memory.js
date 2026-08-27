import { single } from "./helpers.js";

export async function getUserMemory(client, userId, { signal } = {}) {
  const rows = await client.request("user_memory_profiles", {
    query: { user_id: `eq.${userId}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function upsertUserMemory(client, row, { signal } = {}) {
  const rows = await client.request("user_memory_profiles", {
    method: "POST",
    query: { on_conflict: "user_id" },
    body: row,
    prefer: "resolution=merge-duplicates,return=representation",
    signal
  });
  return single(rows);
}

export async function updateUserMemory(client, userId, version, patch, { signal } = {}) {
  const rows = await client.request("user_memory_profiles", {
    method: "PATCH",
    query: { user_id: `eq.${userId}`, version: `eq.${version}` },
    body: { ...patch, version: version + 1, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listUserMemoryMessages(client, userId, after, { signal, limit = 100 } = {}) {
  return client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      role: "eq.user",
      created_at: `gt.${after}`,
      select: "id,content,created_at,conversation_id",
      order: "created_at.asc,id.asc",
      limit: String(limit)
    },
    signal
  });
}

export async function listConversationUserMessagesBefore(
  client,
  userId,
  conversationIds,
  after,
  before,
  { signal, limit = 6 } = {}
) {
  const ids = [...new Set((conversationIds || []).filter(Boolean))];
  if (!ids.length || !after || !before) return [];
  const rows = await Promise.all(ids.map((conversationId) => client.request("messages", {
    query: {
      user_id: `eq.${userId}`,
      role: "eq.user",
      conversation_id: `eq.${conversationId}`,
      and: `(created_at.gt.${after},created_at.lte.${before})`,
      select: "id,content,created_at,conversation_id",
      order: "created_at.desc,id.desc",
      limit: String(limit)
    },
    signal
  })));
  return rows.flat();
}
