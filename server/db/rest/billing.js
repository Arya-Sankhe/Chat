import { single } from "./helpers.js";

export async function checkApiBudget(client, {
  userId,
  planId,
  periodStart,
  periodEnd,
  weekStart,
  weekEnd,
  weekIndex,
  weeklyLimit
}, { signal } = {}) {
  return client.rpc("klui_check_api_budget", {
    p_user_id: userId,
    p_plan_id: planId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_week_start: weekStart,
    p_week_end: weekEnd,
    p_week_index: weekIndex,
    p_weekly_credit_limit: weeklyLimit
  }, { signal });
}

export async function recordApiUsageCost(client, {
  userId,
  subscriptionId,
  planId,
  model,
  provider,
  generationId,
  periodStart,
  periodEnd,
  weekStart,
  weekEnd,
  weekIndex,
  weeklyLimit,
  costCredits,
  costSource,
  usage,
  status = "completed"
}, { signal } = {}) {
  return client.rpc("klui_record_api_usage", {
    p_user_id: userId,
    p_subscription_id: subscriptionId,
    p_plan_id: planId,
    p_model: model || null,
    p_provider: provider || null,
    p_generation_id: generationId || null,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_week_start: weekStart,
    p_week_end: weekEnd,
    p_week_index: weekIndex,
    p_weekly_credit_limit: weeklyLimit,
    p_cost_credits: costCredits,
    p_cost_source: costSource || "unknown",
    p_usage: usage || {},
    p_status: status
  }, { signal });
}

export async function getApiWeeklyUsage(client, userId, { periodStart, weekIndex, signal } = {}) {
  const rows = await client.request("usage_api_weekly", {
    query: {
      user_id: `eq.${userId}`,
      period_start: `eq.${periodStart}`,
      week_index: `eq.${weekIndex}`,
      select: "*",
      limit: "1"
    },
    signal
  });
  return single(rows);
}
