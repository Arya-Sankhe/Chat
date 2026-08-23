import { single } from "./helpers.js";

export async function getModelCache(client, id, { signal } = {}) {
  const rows = await client.request("model_cache", {
    query: { id: `eq.${id}`, select: "*", limit: "1" },
    signal
  });
  return single(rows);
}

export async function upsertModelCache(client, id, payload, { signal } = {}) {
  const rows = await client.request("model_cache", {
    method: "POST",
    query: { on_conflict: "id" },
    body: {
      id,
      payload,
      fetched_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=representation",
    signal
  });
  return single(rows);
}
