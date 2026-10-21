import { HttpError } from "../http/responses.js";

// Free days start at midnight in Dubai, where Klui bills.
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_LABELS = { messages: "messages", images: "image uploads" };

export function isFreePlan(plan) {
  return plan?.free === true;
}

export function freeUsageDay(now = new Date()) {
  return new Date(now.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function freeUsageResetsAt(now = new Date()) {
  const dubaiMidnight = Date.parse(`${freeUsageDay(now)}T00:00:00Z`) - DUBAI_OFFSET_MS;
  return new Date(dubaiMidnight + DAY_MS).toISOString();
}

// The free plan has no subscription row; usage metering still needs one for its window.
export function freeSubscription() {
  return {
    id: null,
    provider: "free",
    status: "free",
    plan_id: "free",
    current_period_end: null,
    cancel_at_period_end: false
  };
}

export function upgradeRequired(message = "Upgrade to Plus or Pro to use this.") {
  return new HttpError(402, message, { code: "upgrade_required" });
}

function limitFor(plan, kind) {
  return kind === "images" ? Number(plan.dailyImageLimit) : Number(plan.dailyMessageLimit);
}

// Counts one use against today's allowance, or refuses once the day's allowance is spent.
export async function consumeFreeAllowance({ db, userId, plan, kind, amount = 1, now = new Date(), signal }) {
  if (!isFreePlan(plan)) return null;
  const limit = limitFor(plan, kind);
  const result = await db.consumeFreeUsage({ userId, day: freeUsageDay(now), kind, amount, limit }, { signal });
  if (!result?.allowed) {
    throw new HttpError(429, `You've used today's ${limit} free ${KIND_LABELS[kind]}. Upgrade for more, or come back tomorrow.`, {
      code: "free_limit",
      kind,
      used: Number(result?.used ?? limit),
      limit,
      resetsAt: freeUsageResetsAt(now),
      retryable: false
    });
  }
  return result;
}

export async function freeUsageSummary({ db, userId, plan, now = new Date(), signal }) {
  const row = await db.getFreeUsage(userId, freeUsageDay(now), { signal }).catch(() => null);
  const item = (kind, used) => {
    const limit = limitFor(plan, kind);
    return { used: Math.min(limit, Number(used) || 0), limit, remaining: Math.max(0, limit - (Number(used) || 0)) };
  };
  return {
    messages: item("messages", row?.messages),
    images: item("images", row?.images),
    resetsAt: freeUsageResetsAt(now)
  };
}

// What a free chat turn may ask for: Think, typed text and images. Everything else is a paid feature.
export function assertFreeChatTurn({ role, voice = false, skillIds = [], research = false, project = null, documentCount = 0 }) {
  if (voice) throw upgradeRequired("Voice is on Plus and Pro. Upgrade to talk with Klui.");
  if (role === "compare" || role === "council") throw upgradeRequired(`${role === "compare" ? "Compare" : "Council"} is on Plus and Pro. Upgrade to use it.`);
  if (role !== "think") throw upgradeRequired("The free plan chats with Think. Upgrade to use other models.");
  if (skillIds.length) throw upgradeRequired("Tools like slides, docs and visuals are on Plus and Pro.");
  if (research) throw upgradeRequired("Deep Research is on Plus and Pro.");
  if (project) throw upgradeRequired("Dojo and projects are on Plus and Pro.");
  if (documentCount > 0) throw upgradeRequired("Documents are on Plus and Pro. The free plan can attach images.");
}
