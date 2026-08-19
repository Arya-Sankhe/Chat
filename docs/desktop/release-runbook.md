# Desktop auth and unified usage release runbook

## 1. Preflight

1. Apply `20260811000000_desktop_auth_and_atomic_usage.sql` to staging, then production.
2. Run Supabase security and performance advisors. Resolve all critical/high findings and save the reports.
3. Complete the hosted OAuth conformance matrix.
4. Confirm the OpenAPI hash in both repositories is `3925e43dc4e4534d11cd76b3de8c9753b3e110ceac7e35a48cc722ea9dc70dd7`.
5. Configure edge limits in addition to the process-local limiter. Restrict origin traffic so `CF-Connecting-IP` is trustworthy.
6. Confirm OpenRouter/Sarvam keys exist only in the website deployment.
7. Confirm `funded_inference_disabled.value.disabled` is `false` in `app_settings`.

## 2. Observe-only meter

Set `API_USAGE_METERING_MODE=observe` and leave all desktop flags off. Each legacy usage event records `usage.klui_metering_observation` with predicted cost, settled cost, absolute delta, proposed ceiling, and ceiling result.

Run for at least seven consecutive days and at least 1,000 production-equivalent requests. Proceed only when:

- aggregate predicted-versus-settled delta is below 1%;
- no sampled request is missing or duplicated;
- no actual cost exceeds the proposed reservation ceiling;
- no sampled OpenRouter generation is undercharged.

If a cost exceeds the proposed ceiling, increase `DESKTOP_CHAT_RESERVATION_CREDITS`, repeat observation, and do not enable enforce mode.

## 3. Shared-meter cutover

Set `API_USAGE_METERING_MODE=enforce` with desktop flags still off. Website LLM and STT now reserve, submit, and settle against the shared weekly row. Watch used/reserved drift, 429 rate, stale events, provider failures, and the 60-second reconciler.

Startup now fails if enforce mode has no positive `DESKTOP_CHAT_RESERVATION_CREDITS`, or if Sarvam is configured without a positive `SARVAM_STT_CREDITS_PER_SECOND`.

Do not switch back to `legacy` while reservations exist. First allow all submitted events to settle or estimate and all unsubmitted reservations to release.

## 4. Desktop staging and rollout

1. Enable `DESKTOP_OAUTH_ENABLED` for staging.
2. Test fresh login, denial, duplicate callback, cold-start refresh, rotation reuse, logout, no-plan, expired-plan, privacy re-consent, offline, and 426 update flows.
3. Set `DESKTOP_BETA_ACCOUNT_IDS` to the canonical `profiles.id` UUIDs for beta testers, then enable `DESKTOP_CHAT_ENABLED` and `DESKTOP_STT_ENABLED` independently. Use `*` only for an intentional all-paid-plan rollout.
4. Confirm every funded request becomes `settled`, `estimated`, or (before submission) `released`.
5. Confirm no raw provider secret or account token exists in child environments, logs, crash reports, config, or artifacts.
6. Keep unsigned test builds in the unlisted private-beta channel. The page must disclose the Unknown publisher warning, and testers must verify the published SHA-256. Never expose an unsigned build through the public metadata file.
7. For the broad public channel, publish only an Authenticode-signed installer. From the website repository, run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop/publish-windows-release.ps1 -InstallerPath <signed-installer.exe>`. The command refuses invalid signatures and version collisions, then prepares a versioned installer and `latest.json` with its SHA-256 under ignored `artifacts/windows-release/`.
8. On production, set `WINDOWS_DOWNLOADS_DIR=/var/lib/klui-downloads/windows`, create that root-owned directory, and copy the two prepared release files into it. The container mounts it read-only. Verify the public SHA-256 before exposing the beta to testers; never commit the installer binary to Git.
9. Expand gradually while monitoring auth errors, refresh failures, 402/429/503 rates, cost variance, reservation drift, unsettled events, and client versions.

## Rollback

- OAuth incident: set `DESKTOP_OAUTH_ENABLED=false`.
- LLM incident or ceiling violation: set `DESKTOP_CHAT_ENABLED=false`.
- Voice incident: set `DESKTOP_STT_ENABLED=false`.
- Keep the additive schema and reconciler. Website routes remain independent.
- Never delete or zero live reservations during rollback; reconcile them.

A reservation-ceiling violation sets `app_settings."funded_inference_disabled:<user_id>"` to `{ "disabled": true }`, blocking new funded usage for that user only. The bare `funded_inference_disabled` key remains a manual global kill switch for ops. After correcting and validating the ceiling, set the affected key back to `false`; do not clear it merely to restore traffic.

## Alerts

Page on any submitted event older than 15 minutes, more than 10 simultaneous submitted events, a reservation-ceiling violation, repeated refresh-token reuse, or a spike in invalid desktop client IDs.
