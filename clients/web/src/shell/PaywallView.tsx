export function PaywallView() {
  return (
    <section className="fullscreen-view hidden" id="paywallView">
      <div className="paywall-panel">
        <button className="paywall-close hidden" id="paywallCloseButton" type="button" aria-label="Close pricing">x</button>
        {" "}
        <div className="paywall-hero">
          <div className="paywall-brand">Klui</div>
          <div className="paywall-sticker">No 5 hour limits for all plans</div>
        </div>
        {" "}
        <p className="auth-email" id="paywallEmail" />
        {" "}
        <div className="paywall-coupon hidden" id="paywallCoupon">
          <button className="coupon-toggle" id="paywallCouponToggle" type="button" aria-expanded="false" aria-controls="paywallCouponForm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" />
              <path d="M14 6v2" />
              <path d="M14 11v2" />
              <path d="M14 16v2" />
            </svg>
            {" "}
            <span>Have a coupon code?</span>
          </button>
          {" "}
          <form className="coupon-form hidden" id="paywallCouponForm" noValidate>
            <input id="paywallCouponInput" name="coupon" aria-label="Coupon code" placeholder="Enter code" autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={32} />
            {" "}
            <button type="submit" id="paywallCouponApply">Apply</button>
          </form>
          {" "}
          <div className="coupon-applied hidden" id="paywallCouponApplied">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            {" "}
            <span>
              <strong id="paywallCouponCode" />
              {" "}
              <span id="paywallCouponSummary" />
            </span>
            {" "}
            <button type="button" id="paywallCouponRemove">Remove</button>
          </div>
          {" "}
          <p className="paywall-coupon-status" id="paywallCouponStatus" role="status" aria-live="polite" />
        </div>
        {" "}
        <div className="plan-grid" id="paywallPlans" />
        {" "}
        <div className="paywall-actions">
          <button className="auth-back hidden" id="paywallBackButton" type="button">Back to chat</button>
        </div>
      </div>
    </section>
  );
}
