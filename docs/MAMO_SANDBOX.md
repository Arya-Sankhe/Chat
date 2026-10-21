# Mamo sandbox testing

Use a separate test app and Supabase project. Sandbox webhooks write subscription rows just
like real payments; the Mamo sandbox flag does not isolate the database. The existing local
`.env` points to the production database, so do not use it unchanged for this test.

Set these on the test app only (keep keys out of Git):

```dotenv
MAMO_API_KEY=<sandbox API key>
MAMO_SANDBOX=true
MAMO_API_BASE=
MAMO_WEBHOOK_AUTH=<random secret of at most 50 characters>
MAMO_COUPON_IDENTITY_SECRET=<stable random secret of at least 32 characters>
APP_URL=https://<public test-app host>
ACCESS_MODE=subscription
SUPABASE_URL=<test project URL>
SUPABASE_ANON_KEY=<test project anon key>
SUPABASE_SERVICE_ROLE_KEY=<test project service-role key>
```

Restart the app after changing its environment. `ACCESS_MODE=testing` bypasses paid-plan
checks and cannot verify whether a payment actually unlocked access. A public HTTPS tunnel
can expose a local app for webhooks; `APP_URL` must point to that app so checkout returns
there instead of production.

In the **Mamo sandbox** dashboard/API, register a webhook:

- URL: `https://<public test-app host>/api/payments/mamo/webhook`
- `auth_header`: exactly the `MAMO_WEBHOOK_AUTH` value above
- `enabled_events`: `payment.succeeded`, `payment.failed`, `payment.card_verified`,
  `subscription.succeeded`, `subscription.failed`, `payment.refunded`

Each checkout is a standalone Mamo link with its own monthly `subscription` object, so no
subscriptions need to be created in the Mamo dashboard (sandbox or live).

## Processing fee

Customers pay Mamo's fee on top of the plan price (`MAMO_FEE_PERCENT`, `MAMO_FEE_FIXED_AED`,
`MAMO_FEE_VAT_PERCENT`; defaults 3.4 / 1 / 5). The charge is grossed up so the settlement
equals the plan price. Verified in sandbox on 2026-10-04:

| Charge | Customer pays | Mamo fee | VAT | Klui receives |
| --- | --- | --- | --- | --- |
| Pro monthly | AED 32.19 | 2.09 | 0.10 | AED 30.00 |
| Pro FIRST50 first month (saved-card charge) | AED 16.65 | 1.57 | 0.08 | AED 15.00 |
| FIRSTFREE card verification | AED 0 | 0 | 0 | AED 0 |

Lite is 11.46 (FIRST50: 6.27) and Max is 52.94 (FIRST50: 27.02). The 50% discount applies to the
plan price only; the fee is added to the discounted amount. UAE-issued cards are charged 2.9% by
Mamo, so they overpay about AED 0.06–0.30. Mamo's checkout description shows the fee line.

## Check the flow

1. Sign in with a test user without a subscription; confirm chat requires a plan.
2. Choose a plan. Confirm checkout opens on Mamo's sandbox domain.
3. Complete a successful test payment; confirm its webhook gives the correct plan and
   future expiry. Refresh the app if the webhook arrives after the checkout redirect.
4. With a fresh unpaid user, make a failed payment; confirm access remains locked.
5. Cancel a successful subscription in Settings; confirm renewal stops in Mamo while access
   remains until the paid-period end. Check renewal/failure and refund events too.

Mamo currently documents success card `4242 4242 4242 4242`, failure card
`4567 3613 2598 1788`, CVV `123`, expiry `01/28`, and 3DS password `Checkout1!`.
Recheck the linked docs if these change.

Local contract tests use fake HTTP responses; the real runs below validate the sandbox
account and callback delivery. Billing hardening and persistent testing are described in
the second run below. Sandbox results do not certify live acquiring or settlement.

Sources: [Quick start](https://mamopay.readme.io/reference/get_),
[Payment links and test cards](https://mamopay.readme.io/reference/post_links),
[Webhook registration](https://mamopay.readme.io/reference/post_webhooks).

## Verified sandbox run — 2026-10-04

The real Mamo sandbox API created monthly Lite (AED 10), Pro (AED 30), and Max
(AED 50) schedules and checkout links. Brave submitted Mamo's fake cards.

| Check | Result |
| --- | --- |
| Lite / Pro / Max successful checkout | Captured 10 / 30 / 50 AED; real `payment.succeeded` callbacks activated the correct plan |
| Declined card on a fresh unpaid fixture | Provider displayed Payment declined; access stayed disabled |
| Retry after decline | Successful Max payment activated Max |
| Cancel all three subscriptions | Local cancel route returned 200; provider reported Unsubscribed; paid-period access remained valid |
| Full Max refund | Sandbox refund API returned 200; real `payment.refunded` callback canceled access |
| Invalid webhook authorization | Local handler returned 401 |
| Initial failed / post-refund failed callback | Synthetic callbacks did not grant or revive access |
| Automated suite | 1,128 tests passed |

These exercised the production route handlers in an isolated Docker server with an
in-memory subscription store. The normal local app uses the production Supabase database,
and its email login provider is disabled; no production database records were created.
Actual authenticated app UI and durable Supabase subscription persistence were not tested.
The 4242 test card succeeded without presenting a 3DS challenge, so challenge interaction
is not verified. Scheduled monthly renewals were not waited for.

The trial found and fixed checkout URLs: the app opens a full hosted checkout, so provider
`/inline-widget/pay/` URLs are normalized to `/pay/`. Failed-payment entitlement guards
and expiry checks were also added. Changes remain uncommitted.

All test subscribers were unsubscribed. The temporary callback registration, public tunnel,
and isolated server were removed after testing. Local `.env` retains the sandbox key and
three schedule IDs; the regular local app still has no test webhook secret and uses
`ACCESS_MODE=testing`. Configure an isolated test database and callback before testing
persistent paid access through the normal app.

## Persistent authenticated run — 2026-10-04

A second run used a real, isolated local Supabase stack (Postgres, GoTrue Auth,
PostgREST and Kong) and the normal Docker application. No auth or database methods
were mocked. Four disposable users were created with the local Auth admin API;
the browser received real Auth sessions through the application's existing session
fragment parser. Google OAuth itself was not repeated. A network-only proxy inside
the app container forwarded its local Supabase address to the host's Docker stack.
Storage/model configuration used disabled QA placeholders; no model calls were made.
The production Supabase project was inspected read-only, with no test records written.

| Check | Result |
| --- | --- |
| Lite AED 10 / Pro AED 30 / Max AED 50 | Real sandbox captures and callbacks persisted the correct plans against separate authenticated users |
| Browser checkout | Lite and Pro started from the real pricing buttons; Max used the authenticated checkout API and the same hosted form |
| Database/app restart | Lite access and cancellation survived restarting both Postgres and the application |
| Return before callback | Reproduced; fixed by bounded polling of authenticated `/api/me`; Pro and Max unlocked without manual refresh |
| Decline and retry | Real Max decline left access locked; successful retry unlocked Max |
| Cancellation | All three application cancellations returned 200; Mamo reported every test subscriber Unsubscribed |
| Partial / full refund | Real AED 5 refund retained Max access; remaining AED 45 refund revoked it |
| Real success replay | Did not undo Lite cancellation or revive fully refunded Max |
| Parallel callbacks | Concurrent PostgREST RPC requests retained the newest payment and preserved cancellation |
| Expiry | Expired paid period denied access through `/api/me` |
| Account isolation | Each authenticated user could read only their own subscription; client writes and billing RPC execution were denied |
| Unpaid user | Conversation creation returned 402; no model was called |
| Invalid plan / existing renewal | Invalid plan returned 400; starting another checkout while renewal remains enabled returned 409 |
| Missing webhook configuration | Checkout is disabled rather than accepting a payment with no configured callback secret |
| Account deletion | Contract tests verify unsubscribe before storage/Auth deletion; real sandbox check deactivated a pending checkout and retained the account after deliberately disabled storage failed |
| Final automated checks | 1,129 Node tests, SQL regressions and 253-file syntax check passed |

### Changes required before enabling live billing

Apply `supabase/migrations/20261004073015_harden_mamo_billing.sql` **before**
deploying the updated application. This adds a service-only checkout ownership table
and two service-only, invoker-security RPCs. Each user has a Postgres transaction lock
so cancellation and payment updates cannot overwrite each other. Existing subscriptions
remain intact. The schema snapshot includes the same definitions.

Checkout ownership is now stored before returning a URL. Callbacks fetch the current
payment from Mamo and check its amount, currency and schedule against the stored link;
they do not trust redirect parameters or callback user/plan fields. This also resolves
renewals whose `custom_data` and `external_id` are empty. Replay/order checks preserve
cancellation, refuse older payment updates and prevent a refunded payment being revived.
A refund of an older payment does not revoke a newer paid period. Failed renewals cannot
extend the previously paid expiry. Partial refunds retain access; full refunds revoke it.

Starting another subscription requires stopping the existing renewal first, including
expired or refunded plans. Settings and account deletion share the same unsubscribe
implementation. Open checkout links are deactivated before deletion, so a pending checkout cannot remain
payable after its owner is gone. If Mamo cannot confirm deactivation or unsubscribe, deletion
stops and retains the account. Canceling renewal preserves paid access until expiry. A full refund revokes
access; it does not itself request unsubscribe at the provider, so the user can still
stop renewal in Settings. All QA subscribers were explicitly unsubscribed.

For production, supply the **live** Mamo key, set `MAMO_SANDBOX=false`, clear
`MAMO_API_BASE` unless intentionally overriding it, use `APP_URL=https://klui.ai`, set
`ACCESS_MODE=subscription`, `MAMO_COUPONS=FIRST50:50,FIRSTFREE:100`, and register the live
HTTPS callback with the matching random `MAMO_WEBHOOK_AUTH`. No dashboard subscriptions or
schedule IDs are needed. Both Mamo migrations (`harden_mamo_billing`,
`mamo_first_month_coupons`) were applied to the production Supabase project on 2026-10-04.

The remaining provider-specific checks are an actual scheduled renewal and a displayed
3DS challenge. The documented 4242 test card succeeded without showing a challenge.
Renewal success/failure, empty metadata, ordering and expiry were tested with contract,
SQL and concurrent RPC checks; a month-long renewal was not observed. Sandbox success
cannot certify live acquiring or settlement. After cutover, monitor webhook errors and
reconcile the first live payment/renewal against Mamo's dashboard.

Runnable regression checks:

```sh
npm test
npm run check:syntax
# Against an isolated local Supabase database with schema.sql applied:
docker exec -i supabase_db_klui-mamo-persistent psql -U postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/mamo_billing.sql
```

The SQL regression runs inside a transaction and rolls back its fixtures. It checks
initial activation, renewal, replay, refund precedence, failed-renewal expiry,
cancellation and billing privileges. The local Supabase files and private QA evidence
are under `/tmp/klui-mamo-persistent`; credentials are excluded from Git.

Cleanup: every test subscriber is Unsubscribed, the temporary webhook registration and
public tunnel were removed, and the isolated app/Supabase services were stopped. Local
Supabase data is retained for repeat testing. Production billing remains unchanged.

## First-month coupons (FIRST50, FIRSTFREE)

Coupon eligibility is recorded in the service-only `mamo_coupon_ledger`, which survives
account deletion. Checkout stores HMAC hashes of the authenticated account ID, Google
identity and verified email (Gmail dots/plus aliases normalize to one address). Every
first-month coupon is held once across those identities. A canonical declined discounted
charge releases its hold for retry; successful use remains recorded after cancellation,
refund or deletion. The ledger stores hashes, not email addresses or usable card tokens.

Set and back up `MAMO_COUPON_IDENTITY_SECRET` before enabling coupons; keep the same value
across app instances and deployments. Losing or rotating it breaks matching to previous
identities. Apply `20261016105614_durable_coupon_limits.sql` before deploying its callers.
This cutover had no existing production Mamo checkouts/redemptions to backfill. Older open
coupon links without authenticated identity hashes are rejected and unsubscribed on verification.

Free first months also reserve the HMAC of Mamo's saved `card_id`; missing card or identity
data cannot grant a trial. The **same saved-card ID** cannot receive another free month,
including through another creator code or account. Mamo does not document a stable physical
card fingerprint; sandbox saves of the same test-card details across emails produced different
card IDs. New identities/new card tokens can therefore still obtain another trial. The owner
accepted this limit and chose to retain FIRSTFREE on 2026-10-16. Do not describe it as a
guaranteed one-trial-per-physical-card rule, and do not identify cards by last four digits.

The same migration retires Ziina beta entitlements, preserving users, content and payment
history. These explicitly marked beta rows do not block a first Mamo coupon. Production
remains in testing mode until the owner enables paid access; testing mode still grants Pro.

Set `MAMO_COUPONS=FIRST50:50,FIRSTFREE:100` to enable them; leave it empty to disable coupons.
Apply `supabase/migrations/20261004150000_mamo_first_month_coupons.sql` after the hardening
migration, and add `payment.card_verified` and `payment.failed` to the registered webhook events.

How it works (changing a link's price after checkout does **not** change an existing
subscriber's renewal amount, so a cheaper first charge cannot simply be lowered later):

1. The paywall has a coupon field. `POST /api/payments/mamo/coupon` checks the code. Coupons are
   only for an account's first Klui subscription and can be redeemed once per account.
2. Checkout creates a full-price monthly subscription that **starts next month**, with
   `save_card: required`. Mamo verifies and saves the card without capturing anything.
3. The `payment.card_verified` callback claims the coupon atomically (one redemption per user):
   - FIRSTFREE: the plan becomes `trialing` until the end of the first renewal day; nothing is charged.
   - FIRST50: one saved-card charge for half the price, with `external_id` `klui-coupon:<link>`. A
     compare-and-set lets only one callback request it. A timeout is never retried; the charge's
     own callback settles it. A declined charge disables the link, unsubscribes the
     future renewal and releases the coupon so the user can retry.
4. Month two renews automatically at the full plan price through the normal renewal path.

Mamo's hosted subtotal/total shows the subscription's renewal amount, even during card
verification for a coupon. Its documented API has no separate first-payment display amount.
The checkout title states today's charge and the description explains when the total below
starts. Do not lower the link amount to the coupon price: that also lowers future renewals.
Klui omits `first_name` and `last_name`; the payer enters their cardholder name. Existing
checkout links retain their original text and prefill, so open a new checkout to see changes.

A second coupon checkout that completes after a coupon was redeemed is unsubscribed before
it can renew. Cancelling during the free or discounted month keeps access until that month
ends and stops the first full-price charge.

## Coupon and billing run — 2026-10-04 (third run)

Isolated local Supabase (Postgres, GoTrue, PostgREST, Kong) + the Docker app image, real Mamo
sandbox API, temporary Cloudflare tunnel and sandbox webhook, Mamo's published fake cards.
15 disposable users. No production data, real money or model calls.

| Check | Result |
| --- | --- |
| Lite / Pro / Max checkout from the app | Captured 10 / 30 / 50 AED; callbacks activated the right plan; Lite through the real paywall UI |
| Declined card, then retry | "Payment declined" shown, access stayed locked; retry with 4242 activated Pro |
| FIRST50 on Lite / Pro / Max (monthly) | Card verified (no capture), one 5 / 15 / 25 AED charge, plan active; Mamo subscriber next payment 2026-11-04 at 10 / 30 / 50 |
| FIRSTFREE on Lite / Pro / Max (monthly) | Card verified, nothing charged, `trialing` until the first renewal day; subscriber next payment 2026-11-04 at full price |
| Coupon UI | Code applied in the paywall; cards show first-month price and later monthly price; Mamo checkout shows the offer and the first payment date |
| Invalid / reused / ineligible coupon | 400 invalid; 409 for a second coupon or an existing/past subscriber |
| Accelerated renewals (`MAMO_TEST_SCHEDULE`) | Standard Pro renewed at 30; FIRST50 Pro 15 then renewals at 30; FIRSTFREE Pro 0 then renewal at 30; trial converted to `active` |
| Cancel mid-schedule | FIRSTFREE subscriber cancelled after its first paid renewal; no further charge (see below) |
| Duplicate / concurrent callbacks | 5 concurrent verification replays → no extra charge; with the claim rewound to "not yet charged", 5 concurrent callbacks → exactly one new charge |
| Webhook security | Wrong/missing auth 401; unregistered link 409; forged user/plan metadata ignored |
| Refunds | Refund of an older duplicate charge did not revoke the newer period; full FIRST50 refund revoked access; std Max partial 5 kept access, remaining 45 revoked |
| Cancellation | Standard, FIRST50 and FIRSTFREE (during the free month): Mamo subscriber Unsubscribed, access kept until period end, replay did not undo it |
| Expiry | After the period end, standard, trial, discounted and failed-renewal (`past_due`) plans all lost access; chat returned 402 |
| Account deletion | Open coupon checkout link disabled and trial unsubscribed at Mamo before deletion; deletion then stopped at the deliberately disabled QA storage, keeping the account |
| Automated | Node suite, SQL regressions (coupon claim, once-only charge, trial) and syntax check pass |

Fixed during this run:

- Mamo rejects link descriptions over 75 characters (422); the coupon description is now short.
- Mamo's card form rejects cardholder names with digits or symbols. Klui now leaves the
  cardholder name empty instead of sending the profile name or inventing a fallback.
- `next_payment_date` is a date with no time. Access used to end at 00:00 UTC on the renewal day,
  before Mamo charges, which would lock users out for part of every renewal day. Access now
  lasts through the end of that day in Dubai time (20:00 UTC).

Still not verifiable in sandbox: a real calendar-month renewal, a renewal that fails at Mamo
(renewal failures are covered by contract/SQL tests), a displayed 3DS challenge, and live
acquiring/settlement. The deployed full-refund handler now revokes access and stops future
renewals; delayed success events cannot reactivate the refunded subscription. A real live
purchase/refund test is still needed.


## Plus / Pro pricing — 20 October 2026

The website now sells only Plus (15 AED/month) and Pro (30 AED/month), plus the
existing processing fee. Plus keeps the `lite` ID and `PLAN_LITE_*` settings so
subscription ownership, webhook matching, coupon history, and usage stay intact.
Max is excluded from listings, coupon offers, and new checkouts; its definition
and database row remain for historical subscriptions. Every allowance is unchanged.

The hosted database was updated with `20261020163058_plus_pro_pricing.sql` and
verified. Production source and `PLAN_LITE_PRICE_LABEL` / `PLAN_LITE_AMOUNT_AED`
were updated and the API container rebuilt. Live pricing and health passed;
every Plus/Pro allowance matched the previous live API response. Mamo's live
`GET /links` returned zero links and Supabase held zero Mamo subscriptions, so
there were no existing Lite renewal schedules to reprice. New monthly Mamo
checkouts use the Plus title and 15 AED base price (16.65 AED with current fees).
No real card payment was made. Rollback source, environment, and proxy backups
are on the VPS under `/root/klui-deploy-backups/plus-pro-20261020`, with image
`klui-chat:before-plus-pro-20261020`.


### Pro usage increase — 20 October 2026

The homepage starting-price headline is 15 AED. Pro now advertises 4× Plus usage:
Plus remains USD 1.36 per billing month (four USD 0.34 buckets); Pro increases from
USD 4.08 to USD 5.44 (four USD 1.36 buckets, previously USD 1.02). These are shared
API-cost allowances, not customer subscription prices. Pro stays 30 AED/month.
The production API and research worker must both use
`PLAN_PRO_MONTHLY_API_CREDITS=5.44`; usage already consumed is preserved.

Deployed and verified the API and research worker. All 10 current Pro rows in
`usage_api_weekly` were raised from 1.02 to 1.36 without changing `api_credit_used`.
A live text audit of all 11 public marketing/policy pages found no stale pricing,
plan names, or multipliers. The mobile build and 1,336 tests passed. Rollback
backups are under `/root/klui-deploy-backups/pro4x-20261020` on the VPS.
