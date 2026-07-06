import { single } from "./helpers.js";

export async function upsertProfile(client, user, { signal } = {}) {
  const payload = {
    id: user.id,
    email: user.email || null,
    updated_at: new Date().toISOString()
  };

  const rows = await client.request("profiles", {
    method: "POST",
    query: { on_conflict: "id" },
    body: payload,
    prefer: "resolution=merge-duplicates,return=representation",
    signal
  });

  return single(rows);
}

export async function updateProfile(client, userId, patch, { signal } = {}) {
  const rows = await client.request("profiles", {
    method: "PATCH",
    query: { id: `eq.${userId}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });

  return single(rows);
}

export async function getProfile(client, userId, { signal } = {}) {
  const rows = await client.request("profiles", {
    query: { id: `eq.${userId}`, select: "*" },
    signal
  });
  return single(rows);
}
