import { single } from "./helpers.js";

export async function getAppSetting(client, key, { signal } = {}) {
  const rows = await client.request("app_settings", {
    query: {
      key: `eq.${key}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}

export async function upsertAppSetting(client, key, value, updatedBy, { signal } = {}) {
  const rows = await client.request("app_settings", {
    method: "POST",
    query: { on_conflict: "key" },
    body: {
      key,
      value,
      updated_by: updatedBy || null,
      updated_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=representation",
    signal
  });
  return single(rows);
}

export async function adminSummary(client, { signal } = {}) {
  const [profiles, subscriptions, usageRows, paymentRequests] = await Promise.all([
    client.request("profiles", {
      query: { select: "id,email,role,created_at", order: "created_at.desc", limit: "500" },
      signal
    }),
    client.request("subscriptions", {
      query: {
        select: "id,user_id,plan_id,status,cancel_at_period_end,current_period_end,updated_at",
        order: "updated_at.desc",
        limit: "1000"
      },
      signal
    }),
    client.request("usage_api_weekly", {
      query: {
        select: "user_id,plan_id,period_start,period_end,week_index,week_start,week_end,api_credit_used,api_credit_limit,updated_at",
        order: "updated_at.desc",
        limit: "2000"
      },
      signal
    }),
    client.request("payment_requests", {
      query: {
        select: "id,user_id,plan_id,amount_aed,currency,provider,reference_code,status,created_at,updated_at,approved_at",
        order: "created_at.desc",
        limit: "100"
      },
      signal
    })
  ]);

  return { profiles, subscriptions, usage: usageRows, paymentRequests };
}
