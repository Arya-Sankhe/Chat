# Subscription confirmation emails

Brevo sends one confirmation per new Mamo checkout, after verified payment or successful free-month activation. Full-price, discounted and 100%-off first months share the same path. Renewals, failed payments, refunds, testing entitlements and historical checkouts do not produce new signup emails. Provider receipts remain enabled separately.

Sender: **Klui Billing <billing@notify.arcscalelabs.com>**. Reply-To: **Klui Support <contact@arcscalelabs.com>**. The HTML and plain-text bodies use concise subscription-confirmation wording, with the next billing date when supplied. Discounted and free-month confirmations also show the applicable initial and renewal amounts (including processing fees). The header uses the supplied Klui logo. Coupon access grace days are not presented as billing dates. Cancellation links open Klui Settings; cancellation is in Account.

## Configuration

- `BREVO_API_KEY`: restricted to transactional email; server-only. Never include it in frontend config or logs.
- `BILLING_EMAIL_ENABLED_AT`: ISO timestamp. Only checkouts created at or after this cutoff are eligible. Keep it stable across deploys; an empty/invalid value disables enqueueing.
- Apply `supabase/migrations/20261020194630_subscription_emails.sql` before deploying.

The main application polls the service-only `billing_email_deliveries` outbox every minute, in batches of five. The checkout ID is unique. Database leases prevent simultaneous workers from sending the same row, and a stable UUID is passed as Brevo's `idempotencyKey`. Sent rows retain delivery metadata and clear the rendered message/recipient payload. Account deletion cascades to delivery rows.

Explicit Brevo rejections retry after an hour. Unknown outcomes retry with the same key for at most 25 minutes (Brevo's deduplication TTL is 30 minutes), then become `review` rather than risking a duplicate. Inspect Brevo's transactional logs before manually requeueing a review row. Check for `review` rows and repeated `last_error` values when investigating missing emails. The queue records provider acceptance, not inbox delivery.

Payment activation is independent of provider sending: if Brevo is unavailable, access stays active and the email remains queued. Database enqueue failures cause payment processing to retry, and Mamo's recovery sweep can restore a missing queue row. No historical subscription emails are backfilled.
