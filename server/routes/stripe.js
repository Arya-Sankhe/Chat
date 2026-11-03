import {
  HttpError,
  parseJsonBody,
  readRawBody,
  sendJson,
} from "../http/responses.js";
import { authContext, bearerContext } from "./context.js";
import { eligibleCoupon } from "./payments.js";
import {
  createStripeCheckout,
  processStripeEvent,
  resumeStripeCheckout,
  stripeClient,
  stripeOffer,
} from "../saas/stripe.js";

function checkoutEnabled(config) {
  if (config.paymentProvider !== "stripe")
    throw new HttpError(503, "Stripe checkout is not enabled.");
  if (!config.stripe?.webhookSecret)
    throw new HttpError(503, "Stripe webhook verification is not configured.");
}
export async function handleStripeCoupon(req, res, config) {
  checkoutEnabled(config);
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const coupon = await eligibleCoupon(context, config, body.coupon, req.signal);
  sendJson(res, 200, {
    coupon: {
      code: coupon.code,
      percentOff: coupon.percentOff,
      ...(coupon.trialDays ? { trialDays: coupon.trialDays } : {}),
    },
    offers: config.plans
      .filter((p) => p.active !== false && p.amountAed > 0)
      .map((p) => stripeOffer(p, coupon, config)),
  });
}
export async function handleStripeCheckout(req, res, config) {
  checkoutEnabled(config);
  const context = await authContext(req, config);
  const body = await parseJsonBody(req, 16 * 1024);
  const plan = config.plans.find(
    (p) => p.id === body.planId && p.active !== false && p.amountAed > 0,
  );
  if (!plan) throw new HttpError(400, "Choose a valid Klui plan.");
  const code = String(body.coupon || "")
    .trim()
    .toUpperCase();
  const resumed = await resumeStripeCheckout({
    ...context,
    plan,
    code,
    config,
  });
  if (resumed) {
    sendJson(res, 200, resumed);
    return;
  }
  const coupon = String(body.coupon || "").trim()
    ? await eligibleCoupon(context, config, body.coupon, req.signal)
    : null;
  try {
    sendJson(
      res,
      200,
      await createStripeCheckout({ ...context, config, plan, coupon }),
    );
  } catch (error) {
    if (error.status === 400 || error.status === 409)
      throw new HttpError(
        409,
        "A subscription, checkout, or coupon claim is already in progress. Finish it or try again after it expires.",
      );
    // Never return Stripe request bodies or secret-bearing SDK errors to clients.
    if (error.type?.startsWith("Stripe"))
      throw new HttpError(
        502,
        "Stripe checkout could not be opened. Please try again.",
      );
    throw error;
  }
}
export async function handleStripeWebhook(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!config.stripe?.webhookSecret)
    throw new HttpError(503, "Stripe webhook verification is not configured.");
  const stripe = stripeClient(config);
  const raw = await readRawBody(req, 256 * 1024);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      req.headers["stripe-signature"],
      config.stripe.webhookSecret,
    );
  } catch {
    throw new HttpError(400, "Invalid Stripe webhook signature.");
  }
  const { db } = bearerContext(config);
  try {
    await processStripeEvent(event, { db, config, stripe });
  } catch {
    throw new HttpError(503, "Stripe billing update will be retried.");
  }
  sendJson(res, 200, { received: true });
}
export async function handleStripePortal(req, res, config) {
  checkoutEnabled(config);
  if (!config.stripe.portalConfigurationId) throw new HttpError(503, "Stripe billing portal is not configured.");
  const { db, user } = await authContext(req, config);
  const row = (
    await db.request("stripe_customers", {
      query: { user_id: `eq.${user.id}`, limit: 1 },
    })
  )[0];
  if (!row) throw new HttpError(404, "No Stripe billing account was found.");
  const portal = await stripeClient(config).billingPortal.sessions.create({
    customer: row.customer_id,
    configuration: config.stripe.portalConfigurationId,
    return_url: config.appUrl,
  });
  sendJson(res, 200, { url: portal.url });
}
