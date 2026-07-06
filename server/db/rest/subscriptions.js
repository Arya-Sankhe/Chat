import { single } from "./helpers.js";

export async function getLatestSubscription(client, userId, { signal } = {}) {
  const rows = await client.request("subscriptions", {
    query: {
      user_id: `eq.${userId}`,
      select: "*",
      order: "updated_at.desc",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function upsertSubscription(client, subscription, { signal } = {}) {
  const rows = await client.request("subscriptions", {
    method: "POST",
    query: { on_conflict: "provider_subscription_id" },
    body: subscription,
    prefer: "resolution=merge-duplicates,return=representation",
    signal
  });
  return single(rows);
}
