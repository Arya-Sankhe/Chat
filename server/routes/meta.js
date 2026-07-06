import { listModels } from "../crofai/client.js";
import { normalizeBaseUrl } from "../crofai/constants.js";
import { configuredServices } from "../config.js";
import { HttpError, sendJson } from "../http/responses.js";
import { apiUsageWindow } from "../saas/billing.js";
import { getCurrentEntitlement } from "../saas/entitlements.js";
import { publicPlan } from "../saas/plans.js";
import { loadGlobalSystemPrompt } from "../saas/systemPrompt.js";
import { providerAvailability } from "../providers.js";
import { authContext, requireChatContext } from "./context.js";

export const modelCache = new Map();
export const modelCacheTtlMs = 5 * 60 * 1000;

function publicMe({ user, profile, subscription, plan, usage, config, settings }) {
  return {
    user: { id: user.id, email: user.email },
    profile: {
      role: profile?.role || "user"
    },
    subscription: subscription ? {
      status: subscription.status,
      planId: subscription.plan_id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    } : null,
    plan: plan ? publicPlan(plan) : null,
    usage: usage || {},
    access: {
      mode: config.access.mode,
      active: Boolean(plan)
    },
    settings: settings || {},
    services: configuredServices(config)
  };
}

export function requireServerCrofKey(config) {
  if (!config.serverApiKey) {
    throw new HttpError(503, "Klui model API key is not configured on the server.");
  }
}

function urlSafeSearch(req, key) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    return url.searchParams.get(key);
  } catch {
    return "";
  }
}

export function modelFromPayload(payload, modelId) {
  const list = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(list)) return null;
  return list.find((model) => model?.id === modelId) || null;
}

export function handleHealth(req, res, config) {
  sendJson(res, 200, {
    ok: true,
    app: "klui-chat",
    services: configuredServices(config)
  });
}

export function handleConfig(req, res, config) {
  sendJson(res, 200, {
    app: "klui-chat",
    supabaseUrl: config.supabase.url,
    supabaseAnonKey: config.supabase.anonKey,
    auth: config.auth,
    defaultBaseUrl: config.defaultBaseUrl,
    services: configuredServices(config),
    providers: providerAvailability(config)
  });
}

export function handlePlans(req, res, config) {
  sendJson(res, 200, { plans: config.plans.map(publicPlan) });
}

export async function handleMe(req, res, config) {
  const context = await authContext(req, config);
  const entitlement = await getCurrentEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
    access: config.access,
    signal: req.signal
  });
  let apiUsage = null;
  if (entitlement.plan) {
    const window = apiUsageWindow(entitlement.subscription, entitlement.plan);
    const row = await context.db.getApiWeeklyUsage(context.user.id, {
      periodStart: window.periodStart,
      weekIndex: window.weekIndex,
      signal: req.signal
    }).catch(() => null);
    const used = Number(row?.api_credit_used || 0);
    const limit = Number(row?.api_credit_limit || window.weeklyLimit || 0);
    apiUsage = {
      used,
      limit,
      percent: limit > 0 ? Math.max(0, Math.floor((used / limit) * 100)) : 0,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      weekIndex: window.weekIndex
    };
  }
  const usage = apiUsage ? { api: apiUsage } : {};
  const settings = context.profile?.role === "admin"
    ? { systemPrompt: await loadGlobalSystemPrompt(context.db, { signal: req.signal }) }
    : {};
  sendJson(res, 200, publicMe({
    ...context,
    subscription: entitlement.subscription,
    plan: entitlement.plan,
    usage,
    config,
    settings
  }));
}

export async function handleModels(req, res, config) {
  requireServerCrofKey(config);
  const context = await requireChatContext(req, config);

  const baseUrl = normalizeBaseUrl(urlSafeSearch(req, "baseUrl") || config.defaultBaseUrl);
  const cached = modelCache.get(baseUrl);
  if (cached && Date.now() - cached.fetchedAt < modelCacheTtlMs) {
    sendJson(res, 200, cached.payload);
    return;
  }

  const dbCached = await context.db.getModelCache(baseUrl, { signal: req.signal });
  if (dbCached && Date.now() - new Date(dbCached.fetched_at).getTime() < modelCacheTtlMs) {
    modelCache.set(baseUrl, { payload: dbCached.payload, fetchedAt: new Date(dbCached.fetched_at).getTime() });
    sendJson(res, 200, dbCached.payload);
    return;
  }

  const payload = await listModels({ apiKey: config.serverApiKey, baseUrl, signal: req.signal });
  modelCache.set(baseUrl, { payload, fetchedAt: Date.now() });
  await context.db.upsertModelCache(baseUrl, payload, { signal: req.signal });
  sendJson(res, 200, payload);
}
