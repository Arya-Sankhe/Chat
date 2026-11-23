/* The pricing screen's data and actions: pending Ziina payment requests, the
   applied coupon (or invite code), and checkout. shell/PaywallView.tsx draws it. */
import { create } from "zustand";
import { session } from "../app/runtime";
import { checkMamoCoupon, createMamoCheckout, createZiinaPaymentRequest, fetchZiinaPaymentRequests, redeemInvite } from "../islands/api.js";
import { clearPendingCoupon, pendingCoupon, savePendingCoupon, takeCouponFromUrl } from "../islands/inviteLink.js";
import { isNative, openExternal } from "../islands/platform/index.js";
import { renderShell, showToast, useApp } from "./app";
import { loadMe } from "./boot";

export type PaymentRequest = { id?: string; planId: string; status: string; referenceCode?: string; paymentUrl?: string };
export type CouponOffer = { planId: string; code: string; trialDays?: number; initialAmountAed?: number; initialChargeAed?: number; renewalChargeAed?: number };
export type MamoCoupon = { coupon: { code: string; percentOff: number; trialDays?: number }; offers?: CouponOffer[] };

type Billing = {
  paymentRequests: PaymentRequest[];
  mamoCoupon: MamoCoupon | null;
  /** The code field is open (the ticket link was tapped). */
  couponOpen: boolean;
  couponCode: string;
  couponStatus: string;
  couponBusy: boolean;
};

const EMPTY: Billing = { paymentRequests: [], mamoCoupon: null, couponOpen: false, couponCode: "", couponStatus: "", couponBusy: false };

export const useBilling = create<Billing>(() => ({ ...EMPTY }));
const set = useBilling.setState;
const get = useBilling.getState;

/** Sign-out drops the last account's requests and coupon. */
export function resetBilling() {
  set({ ...EMPTY });
}

export const inviteOnly = () => useApp.getState().me?.access?.mode === "testing";

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let paymentRequestsPromise: Promise<void> = Promise.resolve();

export async function loadPaymentRequests() {
  const current = session.current();
  if (!current?.access_token) {
    set({ paymentRequests: [] });
    return;
  }
  try {
    const payload = await fetchZiinaPaymentRequests(current);
    set({ paymentRequests: payload.paymentRequests || [] });
  } catch {
    set({ paymentRequests: [] });
  }
}

/** bootstrap(): Ziina checkout waits for the pending requests before it opens a new one. */
export function trackPaymentRequests() {
  paymentRequestsPromise = loadPaymentRequests();
}

/** Back from Mamo or Stripe checkout: poll /api/me until the plan is active. */
export async function refreshAfterMamoReturn() {
  const params = new URLSearchParams(window.location.search);
  const stripeReturn = params.get("stripe") === "success";
  const mamoReturn = ["captured", "card_verified"].includes(params.get("status") || "") && params.get("transactionId");
  if (!session.current() || (!stripeReturn && !mamoReturn)) return;
  const planId = params.get("planId");
  // Redirect parameters trigger polling only; access always comes from authenticated /api/me.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const me = useApp.getState().me;
    if (me?.billingIssue) { showToast(me.billingIssue as string); return; }
    if (me?.access?.active && (!planId || me?.subscription?.planId === planId)) return;
    if (attempt === 0) showToast("Confirming your payment…");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (!session.current()) return;
    await withTimeout(loadMe(), 4000, "Payment confirmation").catch(() => {});
    renderShell();
  }
  if (!useApp.getState().me?.access?.active) showToast("Payment confirmation is still pending. Refresh in a moment.");
}

let couponCheck: Promise<void> | null = null;

export async function startMamoPayment(planId: string) {
  if (isNative()) return;
  const current = session.current();
  if (!current) return;
  try {
    // A coupon still being checked (e.g. from a ?coupon= link) must land before checkout opens.
    await couponCheck;
    const plans = useApp.getState().plans || [];
    const payload = await createMamoCheckout(current, planId, get().mamoCoupon?.coupon?.code || "", plans.find((plan: any) => plan.id === planId)?.checkout as string | undefined);
    if (payload.paymentUrl) await openExternal(payload.paymentUrl);
  } catch (error: any) {
    showToast(error?.message);
  }
}

export async function startZiinaPayment(planId: string) {
  if (isNative()) return;
  const current = session.current();
  if (!current) return;
  await paymentRequestsPromise;
  const plan = (useApp.getState().plans || []).find((candidate: any) => candidate.id === planId);
  if (!plan) return;
  const existing = get().paymentRequests.find((request) => request.planId === planId && request.status === "pending");
  if (existing) {
    if (existing.paymentUrl) await openExternal(existing.paymentUrl);
    return;
  }
  try {
    const payload = await createZiinaPaymentRequest(current, planId);
    const request = payload.paymentRequest as PaymentRequest;
    set({ paymentRequests: [request, ...get().paymentRequests] });
    if (request.paymentUrl) await openExternal(request.paymentUrl);
  } catch (error: any) {
    showToast(error?.message);
  }
}

export function setCouponCode(couponCode: string) {
  set({ couponCode });
}

export function openCouponForm() {
  set({ couponOpen: true });
}

export function removeCoupon() {
  set({ mamoCoupon: null, couponCode: "", couponStatus: "", couponOpen: false });
}

async function checkCouponCode() {
  const current = session.current();
  if (!current) return;
  const code = get().couponCode.trim().toUpperCase();
  if (!code) {
    set({ couponStatus: "Enter a coupon code." });
    return;
  }
  set({ couponBusy: true });
  try {
    if (inviteOnly()) {
      await redeemInvite(current, code);
      await loadMe();
      set({ mamoCoupon: null, couponStatus: "Pro is now active for free. No payment required.", couponOpen: false });
      renderShell();
      showToast("Invite accepted. You now have Pro for free.");
      return;
    }
    const plans = useApp.getState().plans || [];
    const mamoCoupon = await checkMamoCoupon(current, code, plans.find((plan: any) => plan.checkout === "stripe") ? "stripe" : "mamo");
    set({ mamoCoupon, couponStatus: "", couponOpen: false });
  } catch (error: any) {
    set({ mamoCoupon: null, couponStatus: error?.message || "That coupon code isn't valid." });
  } finally {
    set({ couponBusy: false });
  }
}

export function applyCoupon() {
  const check = checkCouponCode().finally(() => { if (couponCheck === check) couponCheck = null; });
  couponCheck = check;
  return check;
}

// klui.ai/?coupon=CODE (see islands/inviteLink.js). Read at load, before any route sync
// can rewrite the address. Saved for sign-up; also kept here for browsers that block storage.
let linkCoupon = takeCouponFromUrl();
if (linkCoupon) savePendingCoupon(linkCoupon);

const savedLinkCoupon = () => pendingCoupon() || linkCoupon;

function forgetLinkCoupon() {
  linkCoupon = "";
  clearPendingCoupon();
}

/** The code this page was opened with, for asking a guest to sign up. */
export const couponLinkOnLoad = linkCoupon;

/** showPaywall(): a code from the link fills the field and is checked once. */
export function applyCouponFromUrl() {
  const code = savedLinkCoupon();
  if (!code || get().mamoCoupon || isNative()) return;
  forgetLinkCoupon();
  set({ couponCode: code, couponOpen: true });
  void applyCoupon();
}

let inviteRedeem: Promise<void> | null = null;

/** Signed in with a code from the link while Klui is invite-only: Pro is applied
    straight away, without the pricing screen. Paid plans wait for applyCouponFromUrl(). */
export function redeemPendingInvite() {
  inviteRedeem ||= (async () => {
    const current = session.current();
    const code = savedLinkCoupon();
    if (!current || !code || isNative() || !inviteOnly()) return;
    const me = useApp.getState().me as any;
    if (me?.subscription?.provider === "invite" && me?.access?.active) {
      forgetLinkCoupon();
      return;
    }
    try {
      await redeemInvite(current, code);
    } catch (error: any) {
      // A refused code or an active paid plan is final; anything else tries again on the next visit.
      if ([400, 403, 409].includes(error?.status)) forgetLinkCoupon();
      showToast(error?.message || "The invite code couldn't be applied.");
      return;
    }
    forgetLinkCoupon();
    showToast("Invite accepted. You now have Pro for free.");
    await loadMe().catch(() => {});
    renderShell();
  })().finally(() => {
    inviteRedeem = null;
  });
  return inviteRedeem;
}
