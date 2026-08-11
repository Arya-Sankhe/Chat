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

export async function reserveApiUsage(client, params, { signal } = {}) {
  return client.rpc("klui_reserve_api_usage", {
    p_user_id: params.userId,
    p_request_id: params.requestId,
    p_subscription_id: params.subscriptionId || null,
    p_plan_id: params.planId,
    p_surface: params.surface,
    p_modality: params.modality,
    p_oauth_client_id: params.oauthClientId || null,
    p_provider: params.provider || null,
    p_model: params.model || null,
    p_period_start: params.periodStart,
    p_period_end: params.periodEnd,
    p_week_start: params.weekStart,
    p_week_end: params.weekEnd,
    p_week_index: params.weekIndex,
    p_weekly_credit_limit: params.weeklyLimit,
    p_reserved_credits: params.reservedCredits
  }, { signal });
}

export async function markApiUsageSubmitted(client, { userId, requestId, generationId }, { signal } = {}) {
  return client.rpc("klui_mark_api_usage_submitted", {
    p_user_id: userId,
    p_request_id: requestId,
    p_generation_id: generationId || null
  }, { signal });
}

export async function settleApiUsage(client, params, { signal } = {}) {
  return client.rpc("klui_settle_api_usage", {
    p_user_id: params.userId,
    p_request_id: params.requestId,
    p_cost_credits: params.costCredits,
    p_cost_source: params.costSource || "provider",
    p_usage: params.usage || {},
    p_generation_id: params.generationId || null,
    p_estimated: Boolean(params.estimated)
  }, { signal });
}

export async function releaseApiUsage(client, { userId, requestId }, { signal } = {}) {
  return client.rpc("klui_release_api_usage", {
    p_user_id: userId,
    p_request_id: requestId
  }, { signal });
}

export async function reconcileApiUsage(client, { signal } = {}) {
  return client.rpc("klui_reconcile_api_usage", {}, { signal });
}

export async function listSubmittedApiUsage(client, { olderThan, limit = 100, signal } = {}) {
  return client.request("usage_api_events", {
    query: {
      status: "eq.submitted",
      updated_at: `lt.${olderThan}`,
      select: "user_id,request_id,provider,generation_id,reserved_credits,updated_at",
      order: "updated_at.asc",
      limit: String(limit)
    },
    signal
  });
}
