import { enforceRateLimit } from "../http/rateLimit.js";
import { HttpError, parseJsonBody, sendJson } from "../http/responses.js";
import { hasActiveSubscription } from "../saas/entitlements.js";
import { authContext } from "./context.js";

// Invite codes while Klui is invite-only. `days: null` is Pro with no end date;
// a number is a pass that ends that many days after it's redeemed, once per account.
const INVITE_CODES = new Map([
  ["TRYKLUI", { days: null }],
  ["KLUIUOBD", { days: 30 }]
]);

const DAY_MS = 24 * 60 * 60 * 1000;

// One redemption per account at a time, so two codes sent together can't overwrite
// each other (the app runs as one Node process).
const redeeming = new Map();

function oncePerUser(userId, work) {
  const previous = redeeming.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  const settled = next.catch(() => {});
  redeeming.set(userId, settled);
  settled.then(() => {
    if (redeeming.get(userId) === settled) redeeming.delete(userId);
  });
  return next;
}

function usedCodes(invite) {
  const codes = Array.isArray(invite?.raw?.redeemed_codes) ? invite.raw.redeemed_codes : [];
  return invite?.raw?.invite_code ? [...new Set([...codes, invite.raw.invite_code])] : codes;
}

export async function handleRedeemInvite(req, res, config) {
  if (config.access.mode !== "testing") throw new HttpError(403, "Invite access is not available.");
  const { db, user } = await authContext(req, config);
  enforceRateLimit(req, "invite-redeem", 5, 15 * 60_000, user.id);
  const body = await parseJsonBody(req, 16 * 1024);
  const code = String(body.coupon || "").trim().toUpperCase();
  const invite = INVITE_CODES.get(code);
  if (!invite) throw new HttpError(400, "That invite code isn't valid.");
  const plan = config.plans.find((plan) => plan.id === "pro" && plan.active !== false);
  if (!plan) throw new HttpError(503, "Pro invites are not available right now.");

  const result = await oncePerUser(user.id, async () => {
    const latest = await db.getLatestSubscription(user.id, { signal: req.signal });
    if (hasActiveSubscription(latest) && latest.provider !== "invite") {
      throw new HttpError(409, "Your paid plan is already active. No invite is needed.");
    }
    // The account's invite row holds every code it has used, whatever came after it.
    const providerSubscriptionId = `invite:${user.id}`;
    const current = await db.getSubscriptionByProviderId(providerSubscriptionId, { signal: req.signal });
    const used = usedCodes(current);
    const save = (currentPeriodEnd, codes, inviteCode = code) => db.upsertSubscription({
      user_id: user.id,
      provider: "invite",
      provider_subscription_id: providerSubscriptionId,
      plan_id: plan.id,
      status: "active",
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: false,
      raw: { invite_code: inviteCode, redeemed_codes: codes },
      // Always now, so this row is the account's latest and decides its plan.
      updated_at: new Date().toISOString()
    }, { signal: req.signal });

    if (hasActiveSubscription(current)) {
      const upgrade = !invite.days && current.current_period_end;
      if (!upgrade) {
        // Pro from an invite is already on. If a newer (ended) paid row hides it, bring it back.
        if (latest?.provider_subscription_id !== providerSubscriptionId) {
          await save(current.current_period_end || null, used, current.raw?.invite_code || code);
        }
        return { redeemed: true, planId: current.plan_id, currentPeriodEnd: current.current_period_end || null };
      }
    } else if (invite.days && used.includes(code)) {
      throw new HttpError(409, "This invite has already been used on your account.");
    }
    const currentPeriodEnd = invite.days ? new Date(Date.now() + invite.days * DAY_MS).toISOString() : null;
    await save(currentPeriodEnd, [...new Set([...used, code])]);
    return { redeemed: true, planId: plan.id, currentPeriodEnd };
  });
  sendJson(res, 200, result);
}
