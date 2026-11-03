# Klui Stripe sandbox

This branch is an isolated replacement checkout experiment. Production stays on Mamo;
existing Mamo subscriptions are not migrated, canceled or charged by this work.

## Integration plan

The Stripe plugin was installed and OAuth connected. The remote MCP server did not expose
`stripe_implementation_planner`, including after a fresh Codex session. This plan therefore
uses the requested fallback: Stripe's official skills installed from `https://docs.stripe.com`.
It is not represented as planner output.

- **Payments:** redirect to hosted Checkout, using a server-owned monthly Price for each
  product (Plus and Pro). No raw card data enters Klui; no cardholder name is prefilled.
  Dynamic payment methods allow eligible Apple Pay / Google Pay without hardcoding card-only
  methods. A publishable key is unnecessary for this hosted redirect integration.
- **Billing:** Stripe runs recurring invoices, saved payment methods, retries and trials.
  Klui verifies signed webhooks against the raw request body and retrieves authoritative
  Stripe objects. A five-minute reconciler recovers missed subscription/invoice/refund events.
  Access expires at the paid-through timestamp; a failed renewal never extends it.
- **Discounts:** Klui validates the typed code and creator ownership before Checkout. A native
  once-only Stripe coupon reduces the first invoice. The amount-off is the difference between
  the gross renewal and gross introductory charge, so any configured surcharge is recalculated
  after discounting the base price. Free offers use a card-required calendar-month trial (or
  explicit trial days), then charge the normal monthly Price. Checkout displays today's actual
  total and future renewal. No separate off-session introductory charge.
- **Abuse protection:** atomic local reservations serialize concurrent checkouts; durable HMAC
  account/verified-email claims survive deletion. Free trials additionally claim Stripe's card
  fingerprint before access. Wallet tokens and some regional fingerprints can differ; this is
  not a guarantee of identifying every physical card. Mamo identity history is checked too;
  retain the existing coupon identity secret at any eventual migration.
- **Ownership:** customer/session/subscription IDs are bound in service-only tables. Event
  metadata and success-page redirects never provision access. Creator reporting reuses the
  existing anonymous aggregates, retaining separate first-trial and first-paid-plan totals.
- **Refunds/risk:** a completed full refund, dispute or fraud warning blocks that subscription
  and cancels future invoices. Partial refunds retain access. A durable block prevents late
  success events from restoring it. Account deletion expires open checkouts and cancels all
  subscriptions for the owned Stripe Customer before deleting the account.
- **Tax:** optional Checkout automatic tax, required billing address, customer address update
  and tax-ID collection. Enabling collection fails closed unless Tax Settings are active,
  an active registration exists, and the configured tax code matches the Product. The account
  inspected on 2026-10-21 has pending Tax Settings and no registrations. Collection is OFF.
  Confirm the actual head-office address, tax registrations and classification with your
  advisor before live use. Candidate: AIaaS Cloud Based Personal Use `txcd_10105001`, subject
  to confirmation; no classification or registration was silently assigned.

## Run locally

Use an isolated local Supabase project and an env file outside the checkout, mode 0600.
Never reuse the existing `.env`, which can point at production Supabase. Startup and every
Stripe client reject live keys and non-loopback database URLs on this branch.

1. Create an isolated local Supabase stack with the CLI. Load `supabase/schema.sql` for a
   fresh database, or apply the new Stripe migration to a local copy of the existing schema.
2. Set `ACCESS_MODE=subscription`, `PAYMENT_PROVIDER=stripe`, `APP_URL=http://127.0.0.1:3321`,
   `HOST=127.0.0.1`, `PORT=3321`, local Supabase URL/anon/service keys, `STRIPE_SECRET_KEY`,
   and a stable `MAMO_COUPON_IDENTITY_SECRET` of at least 32 characters (shared identity format).
   Keep all Mamo provider/API/webhook keys empty in the sandbox env.
3. Run `node --env-file=/private/path/stripe.env scripts/stripe-setup.mjs`.
   It creates/reuses TEST Products/Prices and a Customer Portal configuration. Save returned
   price IDs as `STRIPE_PLUS_PRICE_ID` / `STRIPE_PRO_PRICE_ID` and
   `STRIPE_PORTAL_CONFIGURATION_ID` in the private env.
4. Start `stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,charge.refunded,charge.dispute.created,radar.early_fraud_warning.created --forward-to http://127.0.0.1:3321/api/payments/stripe/webhook` with
   the test key supplied through the CLI's environment. Save its signing secret as
   `STRIPE_WEBHOOK_SECRET`. Do not pass secret keys as CLI arguments or commit listener logs.
5. Start `node --env-file=/private/path/stripe.env server/index.js`.

`STRIPE_COUPONS=FIRST50:50,FIRSTFREE:100` (default); a 7-day trial is `FREETRIAL:100:7`.
Creator codes are read from the existing affiliate coupon tables. A changed discount applies
only to newly created checkouts, never an already agreed subscription.

The user confirmed that customers should continue paying a processing-fee allowance on top
of the advertised base price. Defaults are `STRIPE_FEE_PERCENT=4.6`,
`STRIPE_FEE_FIXED_AED=1`, and `STRIPE_FEE_VAT_PERCENT=5`: 3.9% Payments for international
cards (2.9% domestic + 1%), plus 0.7% Billing, AED 1 fixed, and 5% VAT on Stripe's fees.
AED-only Checkout avoids Stripe currency conversion. These are fee estimates, not an exact
per-payment settlement guarantee: domestic cards cost less, contracts can differ, and Billing
fees/VAT can be billed and rounded separately. Re-run catalog setup after changing these
values. No existing subscription is repriced automatically.

| Plan | Base/month | Monthly card charge | FIRST50 first charge | FIRSTFREE today |
| --- | ---: | ---: | ---: | ---: |
| Plus | AED 15 | AED 16.87 | AED 8.98 | AED 0 |
| Pro | AED 30 | AED 32.63 | AED 16.87 | AED 0 |

The discount applies to the base price, then the fee is recalculated. The paywall shows the
fee-inclusive total before redirecting; hosted Checkout charges that actual introductory total,
then the full recurring total. A free trial has no charge and no added processing fee.

The user reports a UAE-registered company below the VAT mandatory-registration threshold;
no UAE VAT TRN or other tax registrations have been supplied. Keep `STRIPE_AUTOMATIC_TAX=false`.
Company registration is not VAT registration. The UAE threshold is based on taxable supplies
and imports over the previous 12 months, or expected within the next 30 days, not simply a
calendar-year revenue figure. Confirm obligations with the business's accountant. This does
not mean Stripe's own fees are VAT-free: Stripe applies UAE VAT without a verified VAT ID.
No customer sales tax is being collected, and no tax registration has been created.

Sources: [Stripe UAE pricing](https://stripe.com/ae/pricing),
[VAT on Stripe fees](https://support.stripe.com/questions/taxes-on-stripe-fees-for-uae-businesses?locale=en-GB),
[FTA VAT registration](https://tax.gov.ae/en/services/vat.registration.aspx).

## Required approval before a live switch

This branch deliberately cannot accept a live key. Approval must cover the displayed totals,
actual Stripe fee contract, tax obligations and live account activation. Keep tax collection
off when not VAT-registered; enable it only when the required registration and classification
are confirmed. Do not register solely to enable this integration. Then separately review removal
of the sandbox guard, apply the migration to production, create live catalog and webhook
resources, configure Billing retry/customer email settings, and run a controlled live payment,
renewal/cancellation and full-refund test. Keep Mamo webhooks/keys available to service existing
Mamo renewals; block overlapping subscriptions rather than silently migrating saved cards.
No live deployment or production database migration is part of this sandbox task.

References: [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions),
[subscription webhooks and risk events](https://docs.stripe.com/billing/subscriptions/webhooks),
[coupons](https://docs.stripe.com/billing/subscriptions/coupons),
[Tax setup](https://docs.stripe.com/tax/set-up),
[AI tax classifications](https://docs.stripe.com/tax/ai),
[Tax Codes API](https://docs.stripe.com/api/tax_codes).

## Verification commands

- `npm test` — offline application and provider tests.
- `npm run check:syntax`, `npm run check:css-split`, `npm run mobile:build`.
- Run `supabase/tests/stripe_billing.sql` against **only the isolated local database**.
  It uses a transaction and rolls fixtures back, including privilege checks and durable claims.
- With the local app/listener running, run
  `node --env-file=/private/path/stripe.env scripts/stripe-smoke.mjs`.
  This uses real Stripe test Checkout/invoices/test clocks plus local Auth/Postgres. It tests
  Plus/Pro codes, resuming/switching checkouts, portal, full-price renewal, zero-charge trial,
  repeat-card rejection, trial conversion, failed payment, refunds, cancellation and recovery.
  Only its disposable fixtures are deleted; do not run it with production credentials.

On 2026-10-21 the UAE test account reported `charges_enabled=false`; hosted test-card payments
still succeeded. Live activation remains a separate requirement. The Tax Calculation API
returned `stripe_tax_inactive` for the proposed AIaaS classification. No tax settings,
head-office address, classification or registrations were changed. Test wallets were enabled
in the sandbox; actual wallet payments require an eligible device/wallet and remain untested.

## Results (2026-10-21)

- 1,370 application tests pass, including 18 Stripe tests.
- Fresh PostgreSQL 17 schema and five billing/attribution/quota SQL suites pass; the
  existing CI database entry point now includes the Stripe suite.
- 309 JavaScript files pass syntax checks; CSS baseline and mobile web bundle pass.
- `npm audit --omit=dev`: zero production dependency vulnerabilities.
- Real hosted test-card checkouts succeeded for FIRST50 and FIRSTFREE. Signed Stripe events
  returned HTTP 200; authenticated `/api/me` granted Pro and removed paid access after refund.
- The authenticated smoke suite verified Plus/Pro totals, AED-only sessions, no cardholder
  name prefill, checkout reopening/switching, and the billing portal. Test clocks verified
  full-price renewal, free-to-paid conversion, repeat-card rejection, failed renewal,
  partial/cumulative full refunds, cancellation, deletion cleanup and missed-event recovery.
- Tax collection is not verified or enabled: the account returned `stripe_tax_inactive`.
  Live activation, contract fee verification, any required Tax setup and a real wallet transaction remain
  approval/setup gates. This is a sandbox integration, not a claim of live readiness.

Fee-inclusive verification update: the sandbox catalog and test suite now use the totals in
the table above. Customer tax collection stays disabled; VAT on the provider fee allowance
is a separate cost and does not activate Stripe Tax.
