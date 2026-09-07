# Weekly usage investigation — 7 September 2026

Verified against Supabase project `htsjccozkgkpanmqogwk`, the running production
container, and its recovery log. All timestamps below are UTC.

## Anime Chan / Xcalii

Account: `animechan3401@gmail.com`, ID `ac2a92c2-1847-4953-b340-0de82a0116cd`.
Window: September 1–9; weekly allowance: **1.02 credits**.

**The displayed 36% was not legitimate actual usage.** The ledger summed to
0.36991414 credits, but included one unsupported 0.25-credit reservation charge.
After correcting it, the ledger and weekly counter both equal **0.11991414**:
**11.7563%**, displayed as **11%** because the UI floors the percentage.

| UTC day | Usage events | Corrected credits |
| --- | ---: | ---: |
| Sep 1 | 33 | 0.01486005 |
| Sep 2 | 21 | 0.00895500 |
| Sep 3 | 36 | 0.00568300 |
| Sep 4 | 82 | 0.04590888 |
| Sep 5 | 6 | 0.00085314 |
| Sep 6 | 153 | 0.02711255 |
| Sep 7, through investigation | 16 | 0.01654152 |
| **Total** | **347** | **0.11991414** |

These are metered calls, including auxiliary work and speech, rather than chat
message counts. Sources after correction:

- 300 `openrouter_usage` events: 0.08382159 credits.
- 23 `klui_usage` events: 0.03366982 credits.
- 16 `openrouter_stt` events: 0.00242273 credits.
- Eight remaining events: zero credits, including released/unknown/failed usage.

Stored provider usage agrees with the LLM charge totals apart from sub-millionth
credit rounding from the database's eight-decimal storage. No repeated non-null
generation IDs were found in this window.

The erroneous event was `66beecd3-c635-4ee8-8be0-8c417dbfe6ce`, request
`b0504003-4de6-4dda-9466-c7290b542545`, for DeepSeek Flash. It was created at
**September 6, 22:55:29**, marked submitted, and recovered at **23:07:58**.
It had no generation ID and an empty usage payload. The live
`klui_reconcile_api_usage` function passed its 0.25-credit hold to settlement as
`reservation_ceiling`. Production logged:

```text
usage reconciler recovered stale events { leader: true, released: 0, estimated: 1 }
```

The real provider cost for that request cannot be reconstructed from the recorded
data. It has therefore been set to zero under the existing missing-usage policy,
not claimed to be a known free provider call. Its previous amount, source,
settlement time, correction time, and reason are preserved in the event's
`usage.klui_billing_correction` object. Exactly 0.25 was subtracted atomically from
the matching weekly counter; other users' historical charges were not changed.

Local Docker and production both use this same Supabase project and enforce mode
with a 0.25-credit chat reservation. Usage from both environments legitimately
accumulates in the same account. Events record `surface=web`, not the originating
host, so this request cannot conclusively be attributed to local testing or
production. The direct cause was the shared database recovery function.

## Council / Waiz Haque

The screenshot account is **`haquewaiz@gmail.com`**, ID
`3b3f2692-a798-477c-a1ca-91adbef06a84`. No account matched the typed
`huckwise@gmail.com` address. The screenshot's conversation prefix matches
`1ec148b0-a787-4756-bd17-cfc8379de0e3` and its saved Model D error.

At **September 7, 10:07:42**, Model D (`xiaomi/mimo-v2.5-pro`) received the weekly
limit error. Actual usage before the panel started was **0.05212476 / 1.02**,
or **5.1103%**. Three panel models reserved 0.25 each at 10:07:42; none settled
until 10:08:00 or later. The fourth reservation was rejected by this calculation:

```text
0.05212476 actual + 0.75 outstanding holds + 0.25 new hold
= 1.05212476 > 1.02 allowance
```

The UI correctly excluded temporary holds, while reservation admission incorrectly
included them. This was a genuine false weekly-limit rejection. A matching Council
error also occurred on September 5. The account's current actual usage is
**0.05770046 / 1.02 = 5.6569%**, displayed as **5%**.

## Root cause and deployed correction

The August 13 soft-cap fix existed, but the August 24
`count_usage_reservations` migration restored hold-based admission. Separately,
the repository's `never_bill_usage_reservation` migration was absent from live
migration history, and live settlement/recovery still used the old definitions.
The local and production metering JavaScript files have identical hashes.

Applied live migration **`20260907113143_restore_actual_usage_budget`**:

1. Reservation admission now blocks only when settled usage reaches the allowance.
2. Stale submitted requests with missing cost settle at zero, never at their hold.
3. Settlement accepts actual provider cost even when it exceeds the hold.

Holds remain tracked for request lifecycle accounting. Duplicate-request checks,
row locks, service-role-only execution, and administrative disable switches remain.
In-flight requests may finish above the weekly allowance; further calls stop once
settled usage reaches it. No server restart was required for these shared RPC fixes.

## Verification

- The runnable `test/sql/actual-usage-budget.sql` failed against the old live
  function with “Council panelist rejected despite available usage”.
- It passed with the proposed fix inside a rolled-back transaction, then passed
  again against the deployed functions. It checks four outstanding Council holds,
  missing-usage recovery, exact/idempotent settlement, a positive near-zero balance,
  true exhaustion, duplicate IDs, and the administrative switch. Fixture data is
  rolled back.
- All **85** targeted JavaScript tests passed.
- Both weekly counters exactly match their event sums, with zero outstanding holds.
- The running production container read back Anime Chan at **11%** and Waiz at **5%**.
- All three changed RPCs remain executable by `service_role`, not `anon` or
  `authenticated`.

## Follow-up: prevention for every account

Applied live migration **`20260907114051_prevent_reservation_charges`**, adding a
ledger CHECK constraint that rejects positive costs sourced from reservations,
missing usage, settlement/submission failures, or failed provider attempts. The
constraint also protects against older callers: a rejected settlement rolls back
its weekly-counter change. Existing historical audit rows are preserved with
`NOT VALID`; every new insert/update is checked.

Removed automatic account freezes based on LLM and speech reservation estimates.
A request exceeding its estimate records its actual cost; the next request is
judged against actual weekly usage. Administrative switches remain available.
Desktop speech now reports a disabled meter as unavailable, rather than falsely
calling it weekly exhaustion. No existing automatic account freezes needed clearing.

Council, Compare, and ordinary chat all use the same shared meter. SQL checks now
cover every supported web/desktop surface and LLM/speech modality at a positive
near-zero balance, as well as independence between accounts. Tests also attempt
the old bogus-charge settlement and verify both ledger and counters reject it.

Added a CI PostgreSQL job to execute these behavioral checks against the schema,
plus a test that the four billing RPC definitions match their latest migrations.
Loading the snapshot in a fresh database exposed two existing ordering errors;
the content-reports table now follows its dependencies, and a duplicate premature
function revoke was removed. Both fresh-database and live rollback-only SQL checks
pass, all **872 application tests** pass, and syntax checks pass for **190 files**.

The runtime changes were rebuilt and deployed to production and local Docker,
including their research workers. Production's health endpoint passed and deployed
file hashes matched the checked local files.
