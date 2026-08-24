# Klui legal / product preferences

Working notes while we close the product-vs-docs gaps. This is **not** the published Terms or Privacy Policy. Counsel has not signed it.

After the remaining code items are done, rewrite the Word drafts against this file.

---

## 1. ACCESS_MODE — done in code

**Decision:** Testing mode is for a laptop. Production must say so out loud.

- `ACCESS_MODE=testing` — every signed-in user is treated as Pro. Local only. Must be set on purpose.
- `ACCESS_MODE=subscription` — only approved paid plans can chat. Production.
- Unset or any other value — the server **refuses to start**. It does not silently hand out Pro.

Local `.env` still has `ACCESS_MODE=testing`. Going live means writing `ACCESS_MODE=subscription`, not deleting the variable.

---

## 2. OpenRouter: no training, logging allowed — done in code

**Decision:** Klui does not route prompts to providers OpenRouter classifies as training on prompts. Klui **does** allow providers that may log or retain prompts without training. We will say that in Privacy / Terms later, using OpenRouter’s own labels.

### What you chose

| OpenRouter label (model page tooltip) | Allowed? |
|---|---|
| **Logs:** “this provider may retain prompts, but does not use them for training.” (e.g. Baidu Qianfan) | Yes |
| **Trains:** “this provider may use prompts for training and may retain prompt data.” (e.g. DeepSeek official, marked Not routable) | No |

Account setting (already on in OpenRouter): providers that train are **not routable**. Separate toggles exist for paid vs free models. Keep that on.

### What OpenRouter’s API actually does (do not confuse these)

From [Provider routing](https://openrouter.ai/docs/features/provider-routing) and [Provider logging](https://openrouter.ai/docs/guides/privacy/logging):

- **Account privacy — opt out of training:** “If you opt out of training in your account settings, OpenRouter will not route to providers that train.” This is the control that matches our policy.
- **`provider.data_collection: "deny"`:** “use only providers which do not collect user data.” Default is `"allow"`: “allow providers which store user data non-transiently and may train on it.” **We do not send `deny`.** It would also block log-only hosts such as Baidu Qianfan.
- **`provider.zdr: true`:** only Zero Data Retention endpoints (no retain, therefore no train). **We do not send this.** Logging-without-training hosts would be excluded.
- OpenRouter itself does not store prompts unless you opt in to their logging / “use of inputs” settings. We are not opting Klui into those.

OpenRouter also says it is “not a definitive source of third party data policies, but represents our best knowledge.” Terms should not treat the catalog tags as a warranty of each host’s actual law.

### What we implemented

Nothing in Klui code. Training providers are blocked on the **OpenRouter account** (not routable). Do not add `provider.ignore`, `data_collection: "deny"`, or `zdr` in the app — the dashboard already enforces no-training, and those request flags would either duplicate it or also block log-only hosts.

DeepSeek Flash host order is unchanged and **keeps** Baidu and StreamLake (retain, do not train):

`relace`, `baidu`, `coreweave`, `novita`, `streamlake`, `deepinfra`

Keep the OpenRouter privacy toggle on for paid (and free, if used) endpoints.

Catalog snapshot we used (OpenRouter `all-providers`, 2026-08-24): DeepSeek official trains and retains; Baidu Qianfan and StreamLake retain and do not train; Relace / CoreWeave / Novita / DeepInfra neither; OpenAI / Xiaomi / MiniMax / Poolside retain and do not train.

### Draft language for Privacy / Terms later (not published)

Use OpenRouter’s sentences, not ours:

- We do not route requests to providers OpenRouter classifies as ones that “may use prompts for training.”
- Some providers “may retain prompts, but [do] not use them for training” (abuse, legal, or operational logging). That is allowed.
- We do not promise zero retention or that no provider will log prompt data.
- OpenRouter’s classification is their catalog, not an independent legal opinion of each host.

Drop any current draft line that says we require every underlying host not to retain, or that we never send prompts to a system that stores them.

---

## 3. Expire subscriptions at `current_period_end` — Mamo expires, Ziina does not

**Decision:** Leave Ziina date-expiry off. Mamo rows (`provider === "mamo"`) DO expire at `current_period_end`; Ziina still does not.

Ziina is a prepaid pass: an admin marks the payment approved, we write `status: "active"` and store `current_period_end` (now + 1 month). Entitlement only looks at `status` (`active` / `trialing`). After the month, the user stays entitled until someone changes status. `current_period_end` is used for usage-window math, not for cutting access.

Mamo is recurring. A `provider === "mamo"` row is entitled when status is `active` / `trialing` / `past_due` **and** `current_period_end` is in the future. Period end in the past is not entitled, even if status is still `active`.

---

## 4. No payment UI in the Android app — done in code

**Decision:** Native (`isNative()` / Capacitor APK) never shows Upgrade, the paywall, or checkout. Unpaid users see “Subscribe on the website.” Website checkout is Mamo when `MAMO_API_KEY` is set, else Ziina.

Do not put Mamo (or any other) checkout inside the APK. Native stays “subscribe on the website.”

---

## 5. Humanize — done in code

**Decision:** Keep the skill and the name **Humanize**. It is a prose cleaner, not a detector bypass, and we do not claim it hides that the text came from Klui.

Public copy (composer catalog and homepage):

“Cleaner, more natural phrasing, not a detector bypass.”

Do not restore “Remove signs of AI generated writing” or “should not sound like a bot.” Terms / Privacy later must not describe Humanize as origin-hiding, undetectable, or an AI-detector bypass.

---

## 6. No “No watermark” on image prompts — done in code

**Decision:** Illustration prompts must not ask the image model to omit watermarks. We deleted that constraint. We did not add a Klui watermark.

Do not put “No watermark” / “no watermarks” back in `TEXT_FREE_SUFFIX`, the illustration planner, or `skills/illustration/SKILL.md`.

---

## 7. Legal URLs live on home.klui.ai — done in code

**Decision:** Legal and policy pages are marketing pages, not the chat app. Product is `klui.ai` (like chatgpt.com / claude.ai). Policies are `home.klui.ai` (like openai.com / anthropic.com).

Canonical URLs:

| Page | URL |
|---|---|
| Terms & policies (hub) | https://home.klui.ai/legal/ |
| Terms of use | https://home.klui.ai/terms/ |
| Privacy policy | https://home.klui.ai/privacy/ |
| Cookie policy | https://home.klui.ai/cookies/ |
| Subprocessors | https://home.klui.ai/subprocessors/ |
| Delete your account | https://home.klui.ai/account-delete/ |
| Status | https://home.klui.ai/status/ |

`klui.ai` and `www.klui.ai` 301 those paths to `home.klui.ai`. The pages are placeholders (“not in force yet”). Do not write fake Terms/Privacy copy here; the Word drafts come after the code list.

Hub grouping matches ChatGPT/Claude: Legal (terms, privacy, cookies), Data (subprocessors, delete account), Service (status). Footer / Settings / signup link to them.

---

## 8. Honor GPC — done in code

**Decision:** Klui does not sell personal information and does not share it for cross-context advertising. There is no ad-tech to turn off. Global Privacy Control is honored as the default for everyone, not only for requests with `Sec-GPC: 1`.

`/.well-known/gpc.json` on `klui.ai` and `home.klui.ai` is `{ "gpc": true, "lastUpdate": "2026-08-24" }`. Privacy later should say we do not sell or share personal information for ads, and that we honor GPC.

Do not add per-request GPC branching unless we later add ad-tech or a real sale/share path.

---

## 9. Minimal storage notice — done in code

**Decision:** Not a CMP. No accept/reject categories, no consent log, no per-request cookie branching.

The chat app shows a short “We store settings on this device.” notice. Settings are not written to `localStorage` until the user clicks OK (native Capacitor skips the notice and keeps writing immediately). Auth session storage stays available without the notice; that is sign-in, not a preference cookie.

Google Fonts and jsDelivr are not on first paint. DOMPurify is first-party (`/vendor/dompurify/purify.min.js`). Study fonts load from Google only after OK, or immediately on native. Google Identity still loads only when the sign-in dialog opens. KaTeX / marked / highlight.js stay on jsDelivr after JS bootstrap, not in the HTML head.

Privacy / Cookie policy later should say: we store appearance and similar settings on this device; we do not run ad-tech; we honor GPC; we load Google Fonts after the notice (or in the native app) and Google Identity when you sign in.

Do not add a full consent manager unless we add non-essential cookies or ads.

---

## 10. Strip EXIF/GPS from image uploads — done in code

**Decision:** User-uploaded images are stored without EXIF/GPS. Camera photos must not keep location in R2.

JPEG APP1 (EXIF/XMP), APP13 (IPTC), and COM are dropped. PNG eXIf and text/time chunks are dropped. WebP EXIF and XMP chunks are dropped. Pixel data is not re-encoded. GIF is left as-is. Documents and generated illustrations are unchanged. Existing objects already in R2 are not rewritten.

The relay PUT strips before R2. Complete also reads the object and overwrites if a browser PUT still had metadata (presigned URL). Reserved size is checked against the bytes the client sent; the stored size may then shrink.

Privacy later should say uploaded photos are stored without location metadata. Orientation from EXIF is discarded with APP1 — add a pixel rotate later if that becomes a support issue.

---

## 11. No web-search cache — done in code

**Decision:** There is no web-search cache. Queries are not stored, hashed, or shared across users. Each search hits a provider.

Dropped the in-process LRU, the Supabase `search_cache` table (including the plaintext `query` column), `getSearchCache` / `upsertSearchCache`, and `WEBSEARCH_CACHE_*` config. The cleanup RPC no longer purges that table.

Do not add a shared search cache back. A per-user in-memory cache would still be a search-history store; only add something if a profiler says provider cost is the problem, and then isolate it per user with hashed keys and no plaintext query.

---

## 12. No web-search count limits — done in code

**Decision:** There is no daily or monthly web-search count limit. Users can search as much as they want. Search cost is not gated by Lite 50 / Pro 200 / Max 500 (or any other count).

Dropped `WEBSEARCH_DAILY_LIMIT_*`, `config.websearch.dailyLimits`, and the unused `beforeNetwork` quota hook. The `klui_consume_search` RPC and `usage_daily.search_count` were already removed in `2026_06_08_drop_legacy_usage_counters.sql`. No new migration.

Do not add search-count quotas back. Per-turn `maxToolCallsPerTurn` is a loop bound, not a user quota — leave it. API-credit metering is unrelated.

---

## 13. Paywall says usage is weekly — done in code

**Decision:** Do not print OpenRouter credit numbers (1.36 / 4.08 / 8.16) or weekly slices. Keep relative copy (“3x more usage”) and the percentage meter. Disclose the window before they pay: usage is weekly, and it resets 4 times each month. That matches how the meter actually works (`monthlyApiCreditLimit / 4`, four windows per billing period).

The legal issue was not “you must show 1.36 credits.” It was omitting a material limit on a monthly-priced plan: you cannot dump a month of usage in one week. UAE consumer-protection / advertising rules (and EU UCPD if we have EU users) treat that kind of omission as misleading. ChatGPT and Claude also sell 5x/20x and meter in %; they still say the session/weekly window in help or on the usage page. We put the window on the paywall and the marketing pricing page.

Do not add credit figures unless counsel asks. Account menu already says “Weekly usage” plus the reset date.

---

## 14. Age gate is 18+, one line — done in code

**Decision:** 18+, Claude-simple. No DOB, no checkbox, no extra screen, no ID (Yoti/Persona), no guest-paint wall.

Login copy (auth dialog, sidebar Log in, OAuth consent Google button):

> By continuing, you agree to our Terms of use and Privacy policy, and confirm you are 18 or older.

Google click is the assent. Native skips the dialog and goes straight to Google, so the same line sits under the sidebar Log in button. Terms later: must be 18; if we learn someone is under 18, we close the account. Not a teen product, no parental consent flow.

Do not add a date-of-birth field or re-prompt existing sessions.

---

## 15. Account deletion — done in code

**Decision:** Immediate hard delete. Settings → Account shows Name, Email, and Delete. Confirm, then `DELETE /api/me` removes R2 objects we have keys for, then deletes `auth.users` (profiles and the rest cascade). No 30/90-day hold.

Name is Google’s display name (or the email local-part). There is no username and no edit fields. Apple/Play get the in-app control; Play’s web URL is https://home.klui.ai/account-delete/ (points at Settings → Account). Existing sessions are signed out after a successful delete.

Do not add a cooling-off window, typed “DELETE” confirm, or username unless a store or counsel requires it. Do not list R2 by prefix unless leftover objects show up.

---

## 16. Transactional email — deferred

**Decision:** Vendor is [Maileroo](https://maileroo.com/) (SMTP / Email API). Do not build it now. There is no mailer in the app today; deletion only toasts in-app. Build later, after billing and the other setup that has to land first.

When we do build it: send a deletion confirmation from `DELETE /api/me` (capture the address before wiping `auth.users`). Same send helper is what later DSR / dormancy / Terms-change mail will reuse. Not a newsletter product. Do not add Resend, SendGrid, or a second vendor.

---

## 17. In-app Report + admin queue — done in code

**Decision:** Report on a message saves a `content_reports` ticket. Admin dashboard has Payments / Reports tabs (open → Done). No 24h/48h in Terms until we staff the queue and can keep the clock.

Must exist before we apply to Apple/Play. Without it the listing is rejected.

Storage is not in the account/admin drawer. File management stays in Settings → Storage.

Skipped: reason categories, Maileroo notify, cooling-off, typed confirm. Add if a store or counsel requires it.

---

## 18. Data export — done in code

**Decision:** Immediate JSON download. Settings → Account → Download my data. `GET /api/me/export` (signed-in, paid or not). No ZIP, no email, no job queue.

ChatGPT and Claude email a ZIP later (hours to days, link expires in 24h). That needs Maileroo and an async store, which we do not have. Kimi’s in-app “Download copy” is the one that fits: click, get a file. File bytes stay in Settings → Storage; the export lists file metadata only. Study notes, research runs, and per-token usage events are not in this dump.

Do not add a zip of R2 objects, a Maileroo download link, or printed 30-day SLA until an account is actually too large for one response.

---

## 19. Public status page — done in code

**Decision:** Live up/down page at https://home.klui.ai/status/ (not klui.ai/status). The page fetches same-origin `/api/health`. That route is already served on every host of this process, so no CORS and no extra endpoint. `klui.ai/status` still 301s to home.

One check: process answered with `{ ok: true }`. Not a Statuspage, not a per-service board, not a historical incident log. `/api/health` does not ping Supabase or R2.

Skipped: CORS to call `https://klui.ai/api/health` from home (add if the hosts ever split). Maileroo incident mail. Public history.

---

## 20. Mamo Pay — coded, not live until keys

**Decision:** Precode Mamo; keep Ziina until we test Mamo then delete Ziina.

- **Checkout:** `POST /api/payments/mamo` creates a Mamo payment link (official `POST /links`). Recurring via `subscription_id` + `link_type: inline` if `PLAN_*_MAMO_SUBSCRIPTION_ID` is set, else the legacy monthly `subscription` object on the link.
- **Access:** webhook `POST /api/payments/mamo/webhook`; `Authorization` header = `MAMO_WEBHOOK_AUTH`. Register the webhook yourself in Mamo (we do not auto-create it): events `payment.succeeded`, `subscription.succeeded`, `payment.refunded`, `subscription.failed`.
- **Unique Klui sub id** `mamo:${userId}` because Mamo plan ids are shared.
- **Cancel** in Settings → Account; Mamo `DELETE` subscriber API; access until period end.
- **Refunds:** Mamo dashboard + `payment.refunded` webhook. No in-app refund button.
- **VAT:** not a tax engine; `settlement_vat` is Mamo's fee VAT. Prices stay AED inclusive unless counsel says otherwise.
- **Renewal mail:** not built (Maileroo item 16). Mamo `send_customer_receipt: true`.
- Do not put checkout in the APK.
- **Flip live:** sandbox key + three plan subscription ids optional + webhook URL `https://klui.ai/api/payments/mamo/webhook` + `MAMO_WEBHOOK_AUTH` + `ACCESS_MODE=subscription`.

---

## Still open (code list)

21–22 as previously listed
