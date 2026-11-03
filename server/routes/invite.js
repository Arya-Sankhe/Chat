import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { hasActiveSubscription } from "../saas/entitlements.js";
import { authContext } from "./context.js";

export async function handleRedeemInvite(req, res, config) {
  if (config.access.mode !== "testing") throw new HttpError(403, "Invite access is not available.");
  const { db, user } = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  if (String(body.coupon || "").trim().toUpperCase() !== "TRYKLUI") {
    throw new HttpError(400, "That invite code isn't valid.");
  }
  const plan = config.plans.find((plan) => plan.id === "pro" && plan.active !== false);
  if (!plan) throw new HttpError(503, "Pro invites are not available right now.");
  const existing = await db.getLatestSubscription(user.id, { signal: req.signal });
  if (hasActiveSubscription(existing) && existing.provider !== "invite") {
    throw new HttpError(409, "Your paid plan is already active. No invite is needed.");
  }
  if (!hasActiveSubscription(existing)) {
    await db.upsertSubscription({
      user_id: user.id,
      provider: "invite",
      provider_subscription_id: `invite:${user.id}`,
      plan_id: plan.id,
      status: "active",
      current_period_end: null,
      cancel_at_period_end: false,
      raw: { invite_code: "TRYKLUI" },
      updated_at: new Date().toISOString()
    }, { signal: req.signal });
  }
  sendJson(res, 200, { redeemed: true, planId: plan.id });
}
