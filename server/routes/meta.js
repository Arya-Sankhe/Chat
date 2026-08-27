import { listModels } from "../crofai/client.js";
import { normalizeBaseUrl } from "../crofai/constants.js";
import { configuredServices } from "../config.js";
import { HttpError, sendJson } from "../http/responses.js";
import { apiUsageWindow } from "../saas/billing.js";
import { getCurrentEntitlement } from "../saas/entitlements.js";
import { publicPlan } from "../saas/plans.js";
import { storageUsage } from "../saas/storageQuota.js";
import { loadGlobalSystemPrompt } from "../saas/systemPrompt.js";
import { publicChatRoles } from "../models.js";
import { listComposerSkills } from "../saas/composerSkills.js";
import { providerAvailability } from "../providers.js";
import { authContext, requireChatContext } from "./context.js";

export const modelCache = new Map();
export const modelCacheTtlMs = 5 * 60 * 1000;

function accountName(user) {
  const meta = user?.raw?.user_metadata || {};
  return String(meta.full_name || meta.name || meta.display_name || "").trim();
}

function publicMe({ user, profile, subscription, plan, usage, config, settings }) {
  return {
    user: { id: user.id, email: user.email, name: accountName(user) },
    profile: {
      role: profile?.role || "user"
    },
    subscription: subscription ? {
      status: subscription.status,
      planId: subscription.plan_id,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      provider: subscription.provider || null
    } : null,
    plan: plan ? publicPlan(plan, Boolean(config.mamo?.apiKey)) : null,
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

export function handleBuild(req, res, config) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate",
    pragma: "no-cache",
    expires: "0"
  });
  res.end(JSON.stringify({ buildId: config.buildId }));
}

export function handleConfig(req, res, config) {
  sendJson(res, 200, {
    app: "klui-chat",
    buildId: config.buildId,
    supabaseUrl: config.supabase.url,
    supabaseAnonKey: config.supabase.anonKey,
    auth: config.auth,
    defaultBaseUrl: config.defaultBaseUrl,
    services: configuredServices(config),
    providers: providerAvailability(config),
    roles: publicChatRoles(),
    skills: listComposerSkills().filter((skill) => skill.id !== "illustration" || config.illustrations?.enabled)
  });
}

export function handlePlans(req, res, config) {
  sendJson(res, 200, { plans: config.plans.map((plan) => publicPlan(plan, Boolean(config.mamo?.apiKey))) });
}

export async function handleMe(req, res, config) {
  const context = await authContext(req, config);
  if (req.method === "DELETE") {
    if (typeof context.r2.deletePrefix === "function") {
      await context.r2.deletePrefix(`users/${context.user.id}/`, { signal: req.signal });
    } else if (typeof context.db.listAccountObjectKeysBatch === "function") {
      let cursors = {};
      for (;;) {
        const batch = await context.db.listAccountObjectKeysBatch(context.user.id, {
          cursors,
          signal: req.signal
        });
        if (batch.keys.length) await context.r2.deleteObjects(batch.keys, { signal: req.signal });
        cursors = batch.cursors;
        if (!batch.hasMore) break;
      }
    } else {
      const keys = await context.db.listAccountObjectKeys(context.user.id, { signal: req.signal });
      if (keys.length) await context.r2.deleteObjects(keys, { signal: req.signal });
    }
    await context.db.deleteAuthUser(context.user.id, { signal: req.signal });
    sendJson(res, 200, { deleted: true });
    return;
  }
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const entitlement = await getCurrentEntitlement({
    db: context.db,
    userId: context.user.id,
    plans: config.plans,
    access: config.access,
    signal: req.signal
  });
  const window = entitlement.plan ? apiUsageWindow(entitlement.subscription, entitlement.plan) : null;
  const [apiUsageRow, usedBytes, systemPrompt] = await Promise.all([
    window ? context.db.getApiWeeklyUsage(context.user.id, {
      periodStart: window.periodStart,
      weekIndex: window.weekIndex,
      signal: req.signal
    }).catch(() => null) : null,
    entitlement.plan
      ? context.db.accountStorageUsed(context.user.id, { signal: req.signal }).catch(() => 0)
      : null,
    context.profile?.role === "admin"
      ? loadGlobalSystemPrompt(context.db, { signal: req.signal })
      : null
  ]);
  const used = Number(apiUsageRow?.api_credit_used || 0);
  const reserved = Number(apiUsageRow?.api_credit_reserved || 0);
  const limit = Number(apiUsageRow?.api_credit_limit || window?.weeklyLimit || 0);
  const apiUsage = window ? {
    used,
    reserved,
    remaining: Math.max(0, limit - used),
    limit,
    percent: limit > 0 ? Math.max(0, Math.floor((used / limit) * 100)) : 0,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    weekStart: window.weekStart,
    weekEnd: window.weekEnd,
    weekIndex: window.weekIndex
  } : null;
  const storageUsageRow = entitlement.plan
    ? storageUsage(usedBytes, entitlement.plan.maxStorageBytes)
    : null;
  const usage = {
    ...(apiUsage ? { api: apiUsage } : {}),
    ...(storageUsageRow ? { storage: storageUsageRow } : {})
  };
  sendJson(res, 200, publicMe({
    ...context,
    subscription: entitlement.subscription,
    plan: entitlement.plan,
    usage,
    config,
    settings: systemPrompt === null ? {} : { systemPrompt }
  }));
}

function publicAccountExport(user, profile, raw = {}) {
  const messagesByConversation = new Map();
  for (const message of raw.messages || []) {
    const conversationId = message.conversation_id;
    const list = messagesByConversation.get(conversationId) || [];
    list.push({
      id: message.id,
      role: message.role,
      content: message.content,
      model: message.model || null,
      reasoning: message.reasoning || "",
      toolCalls: message.tool_calls || [],
      finishReason: message.finish_reason || null,
      error: message.error || null,
      createdAt: message.created_at
    });
    messagesByConversation.set(conversationId, list);
  }
  return {
    exportedAt: new Date().toISOString(),
    truncated: Boolean(raw.truncated),
    account: {
      id: user.id,
      email: user.email || "",
      name: accountName(user),
      createdAt: profile?.created_at || null
    },
    memory: {
      enabled: Boolean(raw.memory?.enabled),
      content: String(raw.memory?.content || ""),
      updatedAt: raw.memory?.updated_at || null
    },
    conversations: (raw.conversations || []).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      projectId: conversation.project_id || null,
      model: conversation.model || null,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      deletedAt: conversation.deleted_at || null,
      messages: messagesByConversation.get(conversation.id) || []
    })),
    files: (raw.files || []).map((file) => ({
      id: file.id,
      fileName: file.file_name,
      contentType: file.content_type,
      category: file.category,
      status: file.status,
      sizeBytes: file.size_bytes,
      conversationId: file.conversation_id || null,
      projectId: file.project_id || null,
      createdAt: file.created_at
    })),
    projects: (raw.projects || []).map((project) => ({
      id: project.id,
      name: project.name,
      kind: project.kind,
      instructions: project.instructions || "",
      createdAt: project.created_at,
      updatedAt: project.updated_at
    })),
    billing: {
      subscriptions: (raw.subscriptions || []).map((subscription) => ({
        id: subscription.id,
        planId: subscription.plan_id,
        status: subscription.status,
        provider: subscription.provider,
        providerCustomerId: subscription.provider_customer_id || null,
        providerSubscriptionId: subscription.provider_subscription_id || null,
        currentPeriodEnd: subscription.current_period_end || null,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        createdAt: subscription.created_at,
        updatedAt: subscription.updated_at
      })),
      payments: (raw.payments || []).map((payment) => ({
        id: payment.id,
        planId: payment.plan_id,
        amountAed: payment.amount_aed,
        currency: payment.currency,
        provider: payment.provider,
        status: payment.status,
        referenceCode: payment.reference_code,
        createdAt: payment.created_at
      })),
      usage: (raw.usage || []).map((row) => ({
        planId: row.plan_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        weekIndex: row.week_index,
        weekStart: row.week_start,
        weekEnd: row.week_end,
        used: Number(row.api_credit_used || 0),
        reserved: Number(row.api_credit_reserved || 0),
        limit: Number(row.api_credit_limit || 0)
      }))
    }
  };
}

export async function handleMeExport(req, res, config) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  const context = await authContext(req, config);
  const raw = await context.db.exportAccountData(context.user.id, { signal: req.signal });
  const payload = publicAccountExport(context.user, context.profile, raw);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": "attachment; filename=\"klui-data.json\""
  });
  res.end(JSON.stringify(payload));
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
