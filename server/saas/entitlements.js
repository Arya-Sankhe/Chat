import { HttpError } from "../http/responses.js";
import { findPlanById } from "./plans.js";

const activeStatuses = new Set(["active", "trialing"]);

function hasActiveSubscription(subscription) {
  return activeStatuses.has(subscription?.status);
}

function testingSubscription(planId) {
  return {
    id: null,
    provider: "testing",
    status: "testing",
    plan_id: planId,
    current_period_end: null,
    cancel_at_period_end: false
  };
}

export async function getCurrentEntitlement({ db, userId, plans, access, signal }) {
  if (access?.mode === "testing") {
    const plan = findPlanById(plans, access.testingPlanId) || plans[0];
    return {
      active: Boolean(plan),
      subscription: plan ? testingSubscription(plan.id) : null,
      plan: plan || null
    };
  }

  const subscription = await db.getLatestSubscription(userId, { signal });
  if (!hasActiveSubscription(subscription)) {
    return { active: false, subscription, plan: null };
  }

  const plan = findPlanById(plans, subscription.plan_id);
  return {
    active: Boolean(plan),
    subscription,
    plan: plan || null
  };
}

export async function requireActiveEntitlement({ db, userId, plans, access, signal }) {
  const entitlement = await getCurrentEntitlement({ db, userId, plans, access, signal });
  if (!entitlement.active || !entitlement.subscription) {
    throw new HttpError(402, "Choose a Smartyfy plan to start chatting.");
  }

  if (!entitlement.plan) {
    throw new HttpError(402, "Your subscription plan is not available. Contact support.");
  }

  return {
    subscription: entitlement.subscription,
    plan: entitlement.plan
  };
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
    subscription_id: subscription.id || null,
    plan_id: plan.id,
    event_type: "chat.completion",
    image_count: imageCount,
    status: "started"
  }, { signal });

  return usage;
}
