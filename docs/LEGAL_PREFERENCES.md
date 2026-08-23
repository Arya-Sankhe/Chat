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

## 3. Expire subscriptions at `current_period_end` — deferred

**Decision:** Leave it. Do not expire chat access from `current_period_end` while Ziina is the payment path.

Ziina is a prepaid pass: an admin marks the payment approved, we write `status: "active"` and store `current_period_end` (now + 1 month). Entitlement only looks at `status` (`active` / `trialing`). After the month, the user stays entitled until someone changes status. `current_period_end` is used for usage-window math, not for cutting access.

That is intentional for now. When we switch to **Mamo Pay**, expire access at period end (or whatever Mamo’s recurring model actually is). Do not add a date check in `getCurrentEntitlement` before that switch.

---

## 4. No payment UI in the Android app — done in code

**Decision:** Native (`isNative()` / Capacitor APK) never shows Upgrade, the paywall, or checkout. Unpaid users see “Subscribe on the website.” Website checkout stays as it is (Ziina today).

When we switch the website to **Mamo Pay**, change the web paywall only. Do not put Mamo (or any other) checkout inside the APK. Native stays “subscribe on the website.”

---

## 5. Humanize — done in code

**Decision:** Keep the skill and the name **Humanize**. It is a prose cleaner, not a detector bypass, and we do not claim it hides that the text came from Klui.

Public copy (composer catalog and homepage):

“Cleaner, more natural phrasing, not a detector bypass.”

Do not restore “Remove signs of AI generated writing” or “should not sound like a bot.” Terms / Privacy later must not describe Humanize as origin-hiding, undetectable, or an AI-detector bypass.

---

## Still open (code list)

6. Stop “No watermark” on image prompts
7. Legal URLs must not load the chat app
8. `/.well-known/gpc.json`
9–22 as previously listed
