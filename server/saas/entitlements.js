import { HttpError } from "../http/responses.js";
import { freeSubscription, upgradeRequired } from "./freePlan.js";
import { findPlanById } from "./plans.js";

const activeStatuses = new Set(["active", "trialing"]);
const inPeriodStatuses = new Set(["active", "trialing", "past_due"]);

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function hasActiveSubscription(subscription, now = new Date()) {
  if (subscription?.provider === "ziina" && subscription.raw?.beta_retired === true) return false;
  const status = subscription?.status;
  if (["mamo", "stripe"].includes(subscription?.provider)) {
    if (!inPeriodStatuses.has(status)) return false;
    const end = parseDate(subscription.current_period_end);
    return Boolean(end && end > now);
  }
  return activeStatuses.has(status);
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

// `freePlan` is passed only by routes the free plan may use; anywhere else an account
// without a subscription is asked to choose a plan.
// A free account outside those routes is told the feature is paid (`upgrade_required`).
export async function requireActiveEntitlement({ db, userId, plans, access, freePlan = null, freePlanOffered = false, signal }) {
  const entitlement = await getCurrentEntitlement({ db, userId, plans, access, signal });
  if (!entitlement.active && access?.mode === "subscription") {
    if (freePlan) return { subscription: freeSubscription(), plan: freePlan };
    if (freePlanOffered) throw upgradeRequired();
  }
  if (!entitlement.active || !entitlement.subscription) {
    throw new HttpError(402, "Choose a Klui plan to start chatting.");
  }

  if (!entitlement.plan) {
    throw new HttpError(402, "Your subscription plan is not available. Contact support.");
  }

  return {
    subscription: entitlement.subscription,
    plan: entitlement.plan
  };
}
