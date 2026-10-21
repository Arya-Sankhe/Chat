import { SupabaseRest } from "../db/supabaseRest.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const money = (amount) => `AED ${Number(amount).toFixed(2)}`;
const date = (value) => new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Dubai"
}).format(new Date(value));

export function subscriptionEmail({ planName, name, initialAmount, renewalAmount, nextPaymentAt, discounted, trialDays }) {
  const free = initialAmount === 0;
  const subject = free ? `Your ${planName} free trial is confirmed` : `Your ${planName} subscription is confirmed`;
  const thanks = `Thanks for starting your ${planName} ${free ? "free trial" : "subscription"}${name ? `, ${name}` : ""}`;
  const payment = free
    ? `${trialDays ? `Your ${trialDays % 7 ? `${trialDays}-day` : `${trialDays / 7}-week`} free trial has started.` : "Your first month is free."} You haven’t been charged for your subscription today.${nextPaymentAt ? ` The next charge of ${money(renewalAmount)} will be on ${date(nextPaymentAt)}.` : ` Your subscription will renew at ${money(renewalAmount)} per month.`}`
    : discounted
      ? `Your payment method has been charged ${money(initialAmount)} for your discounted first month.${nextPaymentAt ? ` The next charge of ${money(renewalAmount)} will be on ${date(nextPaymentAt)}.` : ` Your subscription will renew at ${money(renewalAmount)} per month.`}`
      : `Your payment method has been charged.${nextPaymentAt ? ` The next charge will be on ${date(nextPaymentAt)}.` : ""}`;
  const manage = "You can cancel your subscription anytime by visiting the Klui billing settings page.";
  const paragraphs = [thanks, payment, manage];
  return {
    subject,
    textContent: `Klui\n\n${paragraphs.join("\n\n")}\n\nChat with Klui: https://klui.ai/\nManage subscription: https://klui.ai/#settings\n\nArcscale Labs · Klui\nHelp: contact@arcscalelabs.com\nPrivacy: https://home.klui.ai/privacy/`,
    htmlContent: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;background:#ffffff;color:#35352f;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escape(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:44px 24px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td align="center" style="padding:0 0 40px"><a href="https://klui.ai/" style="text-decoration:none"><img src="https://klui.ai/assets/email/klui-header-v2.png" width="180" height="65" alt="Klui AI" style="display:block;width:180px;max-width:100%;height:auto;border:0"></a></td></tr><tr><td style="font-size:16px;line-height:1.65">${paragraphs.map((p) => {
      let html = escape(p).replace("billing settings", '<a href="https://klui.ai/#settings" style="color:#35352f;text-decoration:underline">billing settings</a>');
      if (nextPaymentAt) html = html.replace(date(nextPaymentAt), (value) => `<strong>${value}</strong>`);
      return `<p style="margin:0 0 20px">${html}</p>`;
    }).join("")}<table role="presentation" cellspacing="0" cellpadding="0" style="margin:30px 0 64px"><tr><td bgcolor="#161616" style="border-radius:7px"><a href="https://klui.ai/" style="display:inline-block;padding:10px 18px;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:bold">Chat with Klui</a></td></tr></table></td></tr><tr><td style="border-top:1px solid #e4e4e4;padding-top:28px;color:#858580;font-size:13px;line-height:1.8">Arcscale Labs · Klui<br><a href="mailto:contact@arcscalelabs.com" style="color:#858580">Help</a> · <a href="https://home.klui.ai/privacy/" style="color:#858580">Privacy</a></td></tr></table></td></tr></table></body></html>`
  };
}

// One confirmation per checkout, including repeated callbacks and the recovery sweep.
export async function queueSubscriptionEmail(link, { db, plans, config, signal }) {
  const enabledAt = Date.parse(config.billingEmail?.enabledAt);
  if (!Number.isFinite(enabledAt) || !(Date.parse(link.created_at) >= enabledAt)) return;
  const subscription = await db.getLatestSubscription(link.user_id, { signal });
  if (subscription?.provider !== "mamo" || !["active", "trialing"].includes(subscription.status)
    || subscription.raw?.payment_link_id !== link.id || subscription.cancel_at_period_end) return;
  const plan = plans.find((row) => row.id === link.plan_id);
  if (!plan) return;
  const profile = await db.getProfile(link.user_id, { signal });
  const email = profile?.email;
  if (!email) throw new Error("Subscription confirmation recipient is missing");
  // Coupon first_renewal_at is the access deadline: one Dubai calendar day after billing starts.
  const nextPaymentAt = link.coupon_code
    ? new Date(Date.parse(link.first_renewal_at) - 86400_000).toISOString()
    : paymentDate(subscription.raw?.next_payment_date);
  const message = subscriptionEmail({
    planName: plan.name, name: profile.display_name || "",
    initialAmount: Number(link.coupon_code ? link.initial_amount_aed : link.amount_aed),
    renewalAmount: Number(link.amount_aed), nextPaymentAt, discounted: Boolean(link.coupon_code),
    trialDays: link.coupon_code ? config.mamo?.coupons?.get(link.coupon_code)?.trialDays : undefined
  });
  await db.request("billing_email_deliveries", {
    method: "POST", query: { on_conflict: "payment_link_id" },
    prefer: "resolution=ignore-duplicates", signal,
    body: { payment_link_id: link.id, user_id: link.user_id, payload: {
      ...message, to: [{ email }],
      sender: { name: "Klui Billing", email: "billing@notify.arcscalelabs.com" },
      replyTo: { name: "Klui Support", email: "contact@arcscalelabs.com" },
      tags: ["subscription-confirmation"]
    } }
  });
}

function paymentDate(value) {
  const text = String(value || "").trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const normalized = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : text;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function deliverBillingEmails(config, db, { signal } = {}) {
  if (!config.billingEmail?.apiKey) return;
  const rows = await db.rpc("klui_claim_billing_emails", {}, { signal });
  for (const row of rows || []) {
    let patch;
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": config.billingEmail.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ ...row.payload, headers: { idempotencyKey: row.id } }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
      });
      const result = await response.json();
      if ((response.ok && result.messageId) || result.code === "duplicate_parameter") {
        patch = { status: "sent", message_id: result.messageId || null, sent_at: new Date().toISOString(), payload: {} };
      } else if (response.status >= 400 && response.status < 500 && row.attempt_count === 1) {
        // An explicit rejection did not send: safe to retry later, even beyond the idempotency TTL.
        patch = { status: "pending", first_attempt_at: null, attempt_count: 0, available_at: new Date(Date.now() + 3600_000).toISOString(), last_error: `Brevo HTTP ${response.status}` };
      } else throw new Error(`Brevo HTTP ${response.status}`);
    } catch {
      // shortcut: uncertain sends stop after 25 minutes; check Brevo logs before manually retrying.
      patch = { last_error: "Brevo delivery outcome unknown; retry uses the same idempotency key" };
    }
    await db.request("billing_email_deliveries", {
      method: "PATCH", query: { id: `eq.${row.id}`, lease_token: `eq.${row.lease_token}` }, body: patch, signal
    });
  }
}

export function startBillingEmailDelivery(config) {
  if (!config.billingEmail?.apiKey || !config.supabase?.serviceRoleKey) return () => {};
  const db = new SupabaseRest(config);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await deliverBillingEmails(config, db); }
    catch (error) { console.error("Billing email delivery failed", error?.message); }
    finally { running = false; }
  };
  const timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
  void run();
  return () => clearInterval(timer);
}
