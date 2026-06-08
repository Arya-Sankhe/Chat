import { HttpError } from "../http/responses.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const OPENROUTER_FALLBACK_PRICING = {
  "deepseek/deepseek-v4-flash": { prompt: 0.28, completion: 0.42 },
  "deepseek/deepseek-v4-pro": { prompt: 1.20, completion: 2.40 },
  "xiaomi/mimo-v2.5": { prompt: 0.60, completion: 1.80 },
  "xiaomi/mimo-v2.5-pro": { prompt: 1.20, completion: 3.60 },
  "qwen/qwen3.7-plus": { prompt: 2.00, completion: 6.00 }
};

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonths(date, months) {
  const targetMonthStart = utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const day = Math.min(date.getUTCDate(), daysInUtcMonth(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth()));
  return utcDate(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth(), day);
}

function startOfUtcMonth(date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function daysBetween(start, end) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function billingPeriodForSubscription(subscription, now = new Date()) {
  const currentPeriodEnd = parseDate(subscription?.current_period_end);
  if (currentPeriodEnd && currentPeriodEnd > now) {
    return {
      periodStart: addMonths(currentPeriodEnd, -1),
      periodEnd: currentPeriodEnd
    };
  }

  const createdAt = parseDate(subscription?.created_at);
  if (createdAt) {
    let periodStart = utcDate(now.getUTCFullYear(), now.getUTCMonth(), createdAt.getUTCDate());
    let periodEnd = addMonths(periodStart, 1);
    if (periodStart > now) {
      periodEnd = periodStart;
      periodStart = addMonths(periodStart, -1);
    } else if (periodEnd <= now) {
      periodStart = periodEnd;
      periodEnd = addMonths(periodStart, 1);
    }
    return { periodStart, periodEnd };
  }

  const periodStart = startOfUtcMonth(now);
  return { periodStart, periodEnd: addMonths(periodStart, 1) };
}

export function apiUsageWindow(subscription, plan, now = new Date()) {
  const monthlyLimit = Number(plan?.monthlyApiCreditLimit);
  const weeklyLimit = Number.isFinite(monthlyLimit) && monthlyLimit > 0 ? monthlyLimit / 4 : 0;
  const { periodStart, periodEnd } = billingPeriodForSubscription(subscription, now);
  const totalDays = daysBetween(periodStart, periodEnd);
  const baseDays = Math.floor(totalDays / 4);
  const extraDays = totalDays % 4;

  let cursor = new Date(periodStart);
  for (let index = 0; index < 4; index++) {
    const length = baseDays + (index < extraDays ? 1 : 0);
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor.getTime() + length * MS_PER_DAY);
    if (now >= weekStart && (now < weekEnd || index === 3)) {
      return {
        periodStart: dateOnly(periodStart),
        periodEnd: dateOnly(periodEnd),
        weekStart: dateOnly(weekStart),
        weekEnd: dateOnly(weekEnd),
        weekIndex: index + 1,
        weeklyLimit
      };
    }
    cursor = weekEnd;
  }

  return {
    periodStart: dateOnly(periodStart),
    periodEnd: dateOnly(periodEnd),
    weekStart: dateOnly(periodStart),
    weekEnd: dateOnly(periodEnd),
    weekIndex: 1,
    weeklyLimit
  };
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function usageCostCredits(usage) {
  if (!usage || typeof usage !== "object") return null;
  return num(
    usage.cost
    ?? usage.costCredits
    ?? usage.total_cost
    ?? usage.totalCost
    ?? usage.usage
  );
}

export function estimateOpenRouterCostCredits({ model, usage }) {
  const pricing = OPENROUTER_FALLBACK_PRICING[String(model || "").trim()];
  if (!pricing || !usage) return null;
  const promptTokens = num(usage.promptTokens ?? usage.prompt_tokens) || 0;
  const completionTokens = num(usage.completionTokens ?? usage.completion_tokens) || 0;
  if (!promptTokens && !completionTokens) return null;
  return ((promptTokens * pricing.prompt) + (completionTokens * pricing.completion)) / 1_000_000;
}

export async function fetchOpenRouterGenerationCost({ apiKey, baseUrl, generationId, signal }) {
  const id = String(generationId || "").trim();
  if (!apiKey || !baseUrl || !id) return null;
  const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/generation?id=${encodeURIComponent(id)}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`
    },
    signal
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  return usageCostCredits(data);
}

export async function assertApiBudgetAvailable({ db, userId, subscription, plan, signal }) {
  const window = apiUsageWindow(subscription, plan);
  if (!(window.weeklyLimit > 0)) {
    throw new HttpError(403, "API usage is not enabled for your plan.");
  }
  const usage = await db.checkApiBudget({
    userId,
    planId: plan.id,
    ...window
  }, { signal });
  if (!usage?.allowed) {
    throw new HttpError(429, usage?.reason || "Weekly API limit reached.", usage);
  }
  return usage;
}
