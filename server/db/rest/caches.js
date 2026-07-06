import { single } from "./helpers.js";

export async function getSearchCache(client, queryHash, { signal } = {}) {
  if (!client.configured) return null;
  try {
    const rows = await client.request("search_cache", {
      query: { query_hash: `eq.${queryHash}`, select: "*", limit: "1" },
      signal
    });
    return single(rows);
  } catch {
    return null;
  }
}

export async function upsertSearchCache(client, row, { signal } = {}) {
  if (!client.configured) return null;
  return client.request("search_cache", {
    method: "POST",
    query: { on_conflict: "query_hash" },
    body: row,
    prefer: "resolution=merge-duplicates,return=minimal",
    signal
  });
}

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
