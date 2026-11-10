import { useRef, type ReactNode } from "react";
import { isNative } from "../islands/platform/index.js";
import { applyCoupon, openCouponForm, removeCoupon, setCouponCode, startMamoPayment, startZiinaPayment, useBilling, type MamoCoupon, type PaymentRequest } from "../state/billing";
import { renderShell, useApp } from "../state/app";

/* The pricing screen: plan cards, the coupon or invite code, and checkout. */

// Lucide-style 24px stroke icons; keep in sync with home/pricing/index.html.
const FEATURES: [ReactNode, string][] = [
  [<><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></>, "Notes, flashcards & tests"],
  [<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18" /></>, "Compare AI answers"],
  [<><path d="M2 3h20" /><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3" /><path d="m7 21 5-5 5 5" /></>, "Slides, docs & visuals"],
  [<><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></>, "Web search & Deep Research"],
  [<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><path d="M12 18v4" /></>, "Voice chat & course memory"],
  [<><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>, "No ads"]
];
const PLAN_META: Record<string, { usage?: string }> = { lite: {}, pro: { usage: "4× usage" } };

const aed = (value: unknown) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

function trialLength(days: number) {
  return days % 7 === 0 ? `${days / 7} week${days === 7 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`;
}

function couponSummary({ percentOff, trialDays }: MamoCoupon["coupon"]) {
  if (trialDays) return `${trialLength(trialDays)} free`;
  return percentOff >= 100 ? "First month free" : `${percentOff}% off your first month`;
}

/** Prices exclude Mamo's processing fee, which is added at checkout; `chargeAed` is the exact monthly card charge. */
function PlanCard({ plan, pending, coupon, inviteOnly }: { plan: any; pending?: PaymentRequest; coupon: MamoCoupon | null; inviteOnly: boolean }) {
  const subscription = useApp((s) => s.me?.subscription);
  const id = String(plan.id || "").toLowerCase();
  const meta = PLAN_META[id];
  const features = meta ? FEATURES : [];
  const mamo = ["mamo", "stripe"].includes(plan.checkout);
  const offer = mamo ? coupon?.offers?.find((candidate) => candidate.planId === plan.id) : undefined;
  const fee = mamo && Number(plan.chargeAed) > Number(plan.amountAed);
  const ziinaReady = Boolean(plan.ziinaPaymentUrl || plan.ziinaQrImageUrl);
  let price: ReactNode;
  if (offer) {
    price = (
      <>
        <div className="plan-price plan-price-offer">
          <p className="plan-discount-label"><span className="plan-discount-code">{offer.code}</span><span>{offer.trialDays ? "Free trial" : offer.initialAmountAed ? `${coupon!.coupon.percentOff}% off` : "First month on us"}</span></p>
          <del className="plan-original-price" aria-label={`Original price: ${aed(plan.amountAed)} AED`}>{aed(plan.amountAed)} AED</del>
          <div className="plan-new-price"><strong>{offer.initialAmountAed ? aed(offer.initialAmountAed) : "FREE"}</strong>{offer.initialAmountAed ? " AED" : ""}</div>
          <span>{offer.trialDays ? `first ${trialLength(offer.trialDays)}` : "first month"}{fee && offer.initialAmountAed ? " + processing fee" : ""}</span>
        </div>
        <p className="plan-offer">Then {aed(plan.amountAed)} AED / month{fee ? " + processing fee" : ""}</p>
      </>
    );
  } else if (plan.amountAed) {
    price = <p className="plan-price"><strong>{aed(plan.amountAed)}</strong> AED <span>/ month{fee && <>{" "}<small>+ processing fee</small></>}</span></p>;
  } else {
    price = <p className="plan-price"><strong>{plan.priceLabel || ""}</strong></p>;
  }
  return (
    <article className={`plan-card plan-card-${id.replace(/[^a-z0-9_-]/g, "")}`}>
      {meta?.usage && <p className="plan-tag plan-usage-tag">{meta.usage}</p>}
      <h3 className="plan-name">{plan.name}</h3>
      {price}
      <ul className="plan-features">
        {features.map(([paths, label]) => <li key={label}><svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>{label}</li>)}
      </ul>
      {inviteOnly ? (
        <>
          <button className="plan-pay-btn" type="button" disabled>INVITE ONLY</button>
          <p className="plan-payment-note">{subscription?.provider === "invite" && id === "pro" ? "Your free Pro access is active." : "Redeem an invite code above for free Pro access. No payment required."}</p>
        </>
      ) : mamo ? (
        <>
          <button className="plan-pay-btn" type="button" data-start-mamo={plan.id} onClick={() => void startMamoPayment(plan.id)}>Get {plan.name}</button>
          {plan.checkout === "stripe" && (
            <p className="plan-payment-note">{offer ? `AED ${aed(offer.initialChargeAed)} due today. Then AED ${aed(offer.renewalChargeAed)} / month.` : `AED ${aed(plan.chargeAed)} charged monthly.`} Processing fee included.</p>
          )}
        </>
      ) : (
        <>
          {pending && (
            <div className="payment-pending">
              <span>Pending verification</span>
              <strong>{pending.referenceCode || ""}</strong>
            </div>
          )}
          <button className="plan-pay-btn" type="button" data-start-payment={plan.id} disabled={!ziinaReady} onClick={() => void startZiinaPayment(plan.id)}>
            {pending ? "Open Ziina payment" : "Pay with Ziina"}
          </button>
          <p className="plan-payment-note">{ziinaReady ? "Access activates after we verify your Ziina payment." : "Ziina link is not configured yet."}</p>
        </>
      )}
    </article>
  );
}

/** The coupon sits behind a small ticket link; once applied it becomes a confirmation chip. */
function CouponPanel({ inviteOnly }: { inviteOnly: boolean }) {
  const plans = useApp((s) => s.plans);
  const { mamoCoupon, couponOpen, couponCode, couponStatus, couponBusy } = useBilling();
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const available = !isNative() && (inviteOnly || (plans || []).some((plan: any) => ["mamo", "stripe"].includes(plan.checkout)));
  const applied = mamoCoupon?.coupon;
  const open = !applied && (inviteOnly || couponOpen);
  return (
    <div className={`paywall-coupon${available ? "" : " hidden"}${applied ? " is-applied" : ""}`} id="paywallCoupon">
      <button ref={toggleRef} className={`coupon-toggle${applied || open ? " hidden" : ""}`} id="paywallCouponToggle" type="button" aria-expanded={couponOpen} aria-controls="paywallCouponForm" onClick={() => {
        openCouponForm();
        requestAnimationFrame(() => inputRef.current?.focus());
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" />
          <path d="M14 6v2" />
          <path d="M14 11v2" />
          <path d="M14 16v2" />
        </svg>
        {" "}
        <span>{inviteOnly ? "Have an invite code?" : "Have a coupon code?"}</span>
      </button>
      {" "}
      <form className={`coupon-form${open ? "" : " hidden"}`} id="paywallCouponForm" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!couponCode.trim()) inputRef.current?.focus();
        void applyCoupon();
      }}>
        <input ref={inputRef} id="paywallCouponInput" name="coupon" aria-label="Coupon code" placeholder="Enter code" autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={32} value={couponCode} onChange={(event) => setCouponCode(event.target.value)} />
        {" "}
        <button type="submit" id="paywallCouponApply" disabled={couponBusy}>Apply</button>
      </form>
      {" "}
      <div className={`coupon-applied${applied ? "" : " hidden"}`} id="paywallCouponApplied">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {" "}
        <span>
          <strong id="paywallCouponCode">{applied?.code}</strong>
          {" "}
          <span id="paywallCouponSummary">{applied ? couponSummary(applied) : ""}</span>
        </span>
        {" "}
        <button type="button" id="paywallCouponRemove" onClick={() => {
          removeCoupon();
          requestAnimationFrame(() => toggleRef.current?.focus());
        }}>Remove</button>
      </div>
      {" "}
      <p className="paywall-coupon-status" id="paywallCouponStatus" role="status" aria-live="polite">{couponStatus}</p>
    </div>
  );
}

export function PaywallView() {
  const view = useApp((s) => s.view);
  const plans = useApp((s) => s.plans);
  const email = useApp((s) => (s.me?.user?.email as string) || "");
  const inviteOnly = useApp((s) => s.me?.access?.mode === "testing");
  const paymentRequests = useBilling((s) => s.paymentRequests);
  const coupon = useBilling((s) => s.mamoCoupon);
  const pending = new Map(paymentRequests.filter((request) => request.status === "pending").map((request) => [request.planId, request]));
  return (
    <section className={`fullscreen-view${view === "paywall" ? "" : " hidden"}`} id="paywallView">
      <div className="paywall-panel">
        <button className="paywall-close" id="paywallCloseButton" type="button" aria-label="Close pricing" onClick={renderShell}>x</button>
        {" "}
        <div className="paywall-hero">
          <h1 className="paywall-brand">Two Plans<br /><em>Zero Homework.</em></h1>
          {" "}
          <p className="paywall-subheadline">{inviteOnly ? "INVITE ONLY · Start on Free. Redeem an invite code for free Pro access." : "Every feature on both plans. No 5-hour limits."}</p>
        </div>
        {" "}
        <p className="auth-email" id="paywallEmail">{email}</p>
        {" "}
        <CouponPanel inviteOnly={inviteOnly} />
        {" "}
        <div className="plan-grid" id="paywallPlans">
          {(plans || []).map((plan: any) => <PlanCard key={plan.id} plan={plan} pending={pending.get(plan.id)} coupon={coupon} inviteOnly={inviteOnly} />)}
        </div>
        {" "}
        <div className="paywall-actions">
          <button className="auth-back" id="paywallBackButton" type="button" onClick={renderShell}>Back to chat</button>
        </div>
      </div>
    </section>
  );
}
