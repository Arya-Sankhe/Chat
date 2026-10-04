# Creator affiliate backend

This backend is ready for a future creator dashboard. There is no new dashboard UI,
commission calculation or payout flow. Creator accounts use the existing Klui login.
An admin links an existing account to a creator, then assigns that creator a code.
Creators cannot assign themselves a code, change discounts or read customer records.

## Tracking rules

- Entering/checking a code or opening checkout does not count as a referral.
- A Mamo-verified free-month activation adds one free trial. A verified successful
  paid charge adds one paid customer. The same referral can appear in both categories.
- Trial-to-paid conversion updates the same referral; `totalUsers` counts that user once.
- Renewals, duplicate webhooks and later plan changes do not add another customer.
- Trial counts use the plan on which the trial started. Paid counts use the first plan
  purchased. The original code owner retains attribution if the customer later switches plans.
- `trialUsers` is lifetime trial starts; `unpaidTrialUsers` means trials that have never
  made a successful paid charge, including trials that have expired or been cancelled.
  `convertedTrialUsers` means trials with a successful, unrefunded first paid charge.
- A full refund of the first paid charge moves that referral from `paidUsers` to
  `refundedUsers`. A refund of a later renewal does not erase the acquisition.
  Cancelling renewal does not erase historical counts. Partial refunds do not alter them.
- Account deletion removes the account identifier but preserves anonymous historical counts.
- Self-referrals are rejected. Existing FIRST50/FIRSTFREE promotions are not creator referrals.

## Provisioning and discounts

All routes require the existing Klui bearer token. Management routes additionally
require the server-side profile's `admin` role. Creators need no paid subscription to
read their own report. All affiliate tables and reporting functions are server-only.

1. Ask the creator to sign in to Klui at least once.
2. `POST /api/admin/affiliates` with their existing profile ID:

   ```json
   {"userId":"<existing-account-uuid>","displayName":"Creator name"}
   ```

3. `POST /api/admin/affiliates/<creator-id>/coupons`:

   ```json
   {"code":"CREATORNAME"}
   ```

   This defaults to `percentOff: null` and `enabled: false`, so no discount is assumed.
   Codes are case-insensitive on entry and stored uppercase; use 3–32 letters, digits,
   underscores or hyphens. A code's spelling and creator ownership are immutable.
   Create a new code to change either. FIRST50, FIRSTFREE and configured global coupon
   codes are reserved. Codes cannot belong to two creators.

4. When the discount is decided, `PATCH /api/admin/affiliate-coupons/<coupon-id>`:

   ```json
   {"percentOff":30,"enabled":true}
   ```

   Whole percentages from 1 to 100 are supported, including a free first month at 100.
   The discount is for the first month only, with Mamo's processing fee added on top
   of the discounted plan price. Subsequent months charge the full plan price plus fee.
   Use `{"enabled":false}` to stop new checkouts for a code. To clear an undecided
   discount, send `{"percentOff":null,"enabled":false}` together.

The existing coupon field and `https://klui.ai/?coupon=CREATORNAME` links work with
creator codes. Coupon checking (`POST /api/payments/mamo/coupon`) and checkout
(`POST /api/payments/mamo`) both resolve ownership and the discount on the server.
The checkout stores the coupon ID and exact charge amounts. Later discount changes
or disabling a code do not change checkouts already created or their attribution.
No environment variable or Mamo dashboard subscription is needed for each creator.
Avoid adding a creator code to `MAMO_COUPONS`; that variable is for global promotions.

## Dashboard data

`GET /api/creator/affiliate` returns only the signed-in creator's report. The backend
looks up creator membership from the account ID; query/body creator IDs cannot
select another creator. A signed-in account without membership receives 403.

```json
{
  "affiliate": {
    "creatorId":"<creator-uuid>",
    "displayName":"Creator name",
    "coupons":[{"id":"<coupon-uuid>","code":"CREATORNAME","percentOff":100,"enabled":true}],
    "totalUsers":3,
    "trialUsers":2,
    "unpaidTrialUsers":1,
    "convertedTrialUsers":1,
    "paidUsers":2,
    "refundedUsers":0,
    "byPlan":[
      {"planId":"lite","trialUsers":1,"paidUsers":0,"refundedUsers":0},
      {"planId":"pro","trialUsers":1,"paidUsers":2,"refundedUsers":0},
      {"planId":"max","trialUsers":0,"paidUsers":0,"refundedUsers":0}
    ]
  }
}
```

`GET /api/admin/affiliates?limit=100&offset=0` returns the same reports under
`affiliates` for all creators. Results are ordered by creation time then ID;
limit is 1–100. Advance offset to page through larger lists.

Neither report contains referred user IDs, names, emails, payment IDs or card details.
Reporting aggregates in PostgreSQL, so Supabase's row limit cannot silently truncate
referral totals. The service role key remains exclusively on the server.

## Database and validation

Apply `supabase/migrations/20261004202844_creator_affiliate_tracking.sql` before
shipping the backend. It adds creator membership, managed coupons, referral records
and a nullable coupon ID on checkout mappings. Referral updates run in the same
transaction as the billing update, using the existing per-account lock; failed
transactions cannot grant access without recording their attribution.

Verify with `node --test test/affiliates.test.js test/mamo.test.js` and an isolated
PostgreSQL database initialized with `test/sql/bootstrap.sql` and `supabase/schema.sql`.
Run `supabase/tests/affiliate_tracking.sql` and `supabase/tests/mamo_billing.sql` there.
These SQL tests roll back all fixtures and never contact Mamo or charge a card.
