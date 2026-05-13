import { HttpError } from "../http/responses.js";
import { findPlanById, hasActiveSubscription } from "./plans.js";

export async function requireActiveEntitlement({ db, userId, plans, signal }) {
  const subscription = await db.getLatestSubscription(userId, { signal });
  if (!hasActiveSubscription(subscription)) {
    throw new HttpError(402, "Choose a Smartyfy plan to start chatting.");
  }

  const plan = findPlanById(plans, subscription.plan_id);
  if (!plan) {
    throw new HttpError(402, "Your subscription plan is not available. Contact support.");
  }

  return { subscription, plan };
}

export async function consumeUsageOrThrow({ db, userId, subscription, plan, imageCount, signal }) {
  const usage = await db.consumeUsage({
    userId,
    planId: plan.id,
    dailyMessageLimit: plan.dailyMessageLimit,
    monthlyImageLimit: plan.monthlyImageLimit,
    imageCount
  }, { signal });

  if (!usage?.allowed) {
    throw new HttpError(429, usage?.reason || "Your plan limit has been reached.", usage);
  }

  await db.recordUsageEvent({
    user_id: userId,
    subscription_id: subscription.id,
    plan_id: plan.id,
    event_type: "chat.completion",
    image_count: imageCount,
    status: "started"
  }, { signal });

  return usage;
}
