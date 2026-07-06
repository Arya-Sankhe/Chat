import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import {
  DEFAULT_GLOBAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT_SETTING_KEY,
  loadGlobalSystemPrompt,
  normalizeGlobalSystemPrompt,
  systemPromptSettingValue
} from "../saas/systemPrompt.js";
import { authContext, requireAdminContext } from "./context.js";

let adminSummaryCache = null;
const adminSummaryCacheTtlMs = 60 * 1000;

export function clearAdminSummaryCache() {
  adminSummaryCache = null;
}

function activeSubscriptionStatus(status) {
  return ["active", "trialing", "testing"].includes(String(status || "").toLowerCase());
}

function roundCredits(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0;
}

function buildAdminDashboardSummary(raw, config) {
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const subscriptions = Array.isArray(raw?.subscriptions) ? raw.subscriptions : [];
  const usageRows = Array.isArray(raw?.usage) ? raw.usage : [];
  const paymentRequests = Array.isArray(raw?.paymentRequests) ? raw.paymentRequests : [];
  const planNames = new Map((config.plans || []).map((plan) => [plan.id, plan.name || plan.id]));
  const profileEmails = new Map(profiles.map((profile) => [profile.id, profile.email || "Unknown"]));
  const latestSubscriptionByUser = new Map();
  for (const subscription of subscriptions) {
    if (!subscription?.user_id || latestSubscriptionByUser.has(subscription.user_id)) continue;
    latestSubscriptionByUser.set(subscription.user_id, subscription);
  }

  const usageByUser = new Map();
  for (const row of usageRows) {
    if (!row?.user_id) continue;
    const current = usageByUser.get(row.user_id) || {
      totalCreditsUsed: 0,
      latestWeek: null
    };
    current.totalCreditsUsed += Number(row.api_credit_used || 0);
    if (!current.latestWeek) current.latestWeek = row;
    usageByUser.set(row.user_id, current);
  }

  const planCounts = new Map();
  const users = profiles.map((profile) => {
    const subscription = latestSubscriptionByUser.get(profile.id) || null;
    const planId = subscription?.plan_id || "none";
    const active = activeSubscriptionStatus(subscription?.status);
    const usage = usageByUser.get(profile.id) || {};
    const latestWeek = usage.latestWeek || null;
    const plan = planCounts.get(planId) || {
      id: planId,
      name: planId === "none" ? "No plan" : (planNames.get(planId) || planId),
      users: 0,
      activeUsers: 0,
      creditsUsed: 0
    };
    plan.users += 1;
    if (active) plan.activeUsers += 1;
    plan.creditsUsed += Number(usage.totalCreditsUsed || 0);
    planCounts.set(planId, plan);

    return {
      id: profile.id,
      email: profile.email || "Unknown",
      role: profile.role || "user",
      createdAt: profile.created_at,
      planId,
      planName: plan.name,
      subscriptionStatus: subscription?.status || "none",
      currentPeriodEnd: subscription?.current_period_end || null,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
      totalCreditsUsed: roundCredits(usage.totalCreditsUsed),
      currentWeekUsed: roundCredits(latestWeek?.api_credit_used),
      currentWeekLimit: roundCredits(latestWeek?.api_credit_limit),
      currentWeekIndex: latestWeek?.week_index || null,
      lastUsageAt: latestWeek?.updated_at || null
    };
  });

  const totals = {
    users: profiles.length,
    admins: profiles.filter((profile) => profile.role === "admin").length,
    subscribedUsers: users.filter((user) => activeSubscriptionStatus(user.subscriptionStatus)).length,
    totalCreditsUsed: roundCredits(users.reduce((sum, user) => sum + user.totalCreditsUsed, 0)),
    currentWeekCreditsUsed: roundCredits(users.reduce((sum, user) => sum + user.currentWeekUsed, 0))
  };

  return {
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: Math.round(adminSummaryCacheTtlMs / 1000),
    cached: false,
    totals,
    pendingPayments: paymentRequests
      .filter((payment) => payment.status === "pending")
      .slice(0, 50)
      .map((payment) => ({
        id: payment.id,
        userId: payment.user_id,
        email: profileEmails.get(payment.user_id) || "Unknown",
        planId: payment.plan_id,
        planName: planNames.get(payment.plan_id) || payment.plan_id,
        amountAed: Number(payment.amount_aed || 0),
        currency: payment.currency || "AED",
        referenceCode: payment.reference_code,
        status: payment.status,
        createdAt: payment.created_at
      })),
    plans: Array.from(planCounts.values())
      .map((plan) => ({ ...plan, creditsUsed: roundCredits(plan.creditsUsed) }))
      .sort((a, b) => b.activeUsers - a.activeUsers || b.users - a.users || a.name.localeCompare(b.name)),
    users: users
      .sort((a, b) => b.totalCreditsUsed - a.totalCreditsUsed || String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 100)
  };
}

export async function handleAdminSummary(req, res, config) {
  const context = await authContext(req, config);
  if (context.profile?.role !== "admin") throw new HttpError(403, "Admin access is required.");
  const now = Date.now();
  if (adminSummaryCache && now - adminSummaryCache.createdAt < adminSummaryCacheTtlMs) {
    sendJson(res, 200, { ...adminSummaryCache.payload, cached: true });
    return;
  }

  const raw = await context.db.adminSummary({ signal: req.signal });
  const payload = buildAdminDashboardSummary(raw, config);
  adminSummaryCache = { createdAt: now, payload };
  sendJson(res, 200, payload);
}

export async function handleAdminSettings(req, res, config) {
  const context = await requireAdminContext(req, config);
  if (req.method === "GET") {
    sendJson(res, 200, {
      settings: {
        systemPrompt: await loadGlobalSystemPrompt(context.db, { signal: req.signal })
      }
    });
    return;
  }
  if (req.method !== "PATCH") throw new HttpError(405, "Method not allowed.");

  const body = await parseJsonBody(req, 64 * 1024);
  const systemPrompt = normalizeGlobalSystemPrompt(body.systemPrompt);
  if (!systemPrompt) throw new HttpError(400, "System prompt cannot be empty.");

  const row = await context.db.upsertAppSetting(
    SYSTEM_PROMPT_SETTING_KEY,
    systemPromptSettingValue(systemPrompt),
    context.user.id,
    { signal: req.signal }
  );

  sendJson(res, 200, {
    settings: {
      systemPrompt: normalizeGlobalSystemPrompt(row?.value) || DEFAULT_GLOBAL_SYSTEM_PROMPT
    }
  });
}
