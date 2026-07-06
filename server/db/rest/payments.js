import { single } from "./helpers.js";

export async function createPaymentRequest(client, row, { signal } = {}) {
  const rows = await client.request("payment_requests", {
    method: "POST",
    body: row,
    prefer: "return=representation",
    signal
  });
  return single(rows);
}

export async function listPaymentRequests(client, userId, { signal } = {}) {
  return client.request("payment_requests", {
    query: {
      user_id: `eq.${userId}`,
      select: "*",
      order: "created_at.desc",
      limit: "10"
    },
    signal
  });
}

export async function listPendingPaymentRequests(client, { signal } = {}) {
  return client.request("payment_requests", {
    query: {
      status: "eq.pending",
      select: "*",
      order: "created_at.asc",
      limit: "100"
    },
    signal
  });
}

export async function getPaymentRequest(client, id, { signal } = {}) {
  const rows = await client.request("payment_requests", {
    query: {
      id: `eq.${id}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function updatePaymentRequest(client, id, patch, { signal } = {}) {
  const rows = await client.request("payment_requests", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: "return=representation",
    signal
  });
  return single(rows);
}
