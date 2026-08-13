# Klui desktop production boundary

The `Chat` repository owns identity, the hosted OAuth adapter, privacy consent, plan eligibility, provider credentials, the desktop API, and the shared usage ledger. The `clickframe` repository owns the Windows shell, Credential Manager storage, local Pi/CUA execution, and desktop UX.

The current immutable compatibility artifact is [`../openapi/desktop-v1.2026-08-13.yaml`](../openapi/desktop-v1.2026-08-13.yaml). Compatible additions require a new dated `desktop-v1` artifact. Breaking changes require `/api/desktop/v2`.

## Required Supabase setup

Create separate staging and production public OAuth applications. The production Windows application must use:

- Logical client: `klui-desktop-windows`
- Provider client mapping: `SUPABASE_OAUTH_DESKTOP_WINDOWS_CLIENT_ID`
- Exact redirect URI: `tech.klui.anything.windows://oauth/callback`
- Consent URI: `https://klui.tech/oauth/consent`
- PKCE: required, S256

Reserve `klui-desktop-macos` and `tech.klui.anything.macos://oauth/callback`; do not enable it until the macOS implementation exists.

The server flags default off. Desktop chat and STT additionally fail closed unless `API_USAGE_METERING_MODE=enforce`, the chat reservation ceiling is positive, and the STT per-second rate is positive.

STT charges only successful Sarvam responses, including successful empty or partial transcripts. Network failures and non-2xx provider responses are recorded as estimated zero-cost events and release the reservation without charging the user.

## Ownership rule

`profiles.id` remains the canonical Klui account UUID. Provider subjects resolve through `account_identities`. Never add email-based automatic linking. A Clerk migration must import an explicit subject mapping before accepting Clerk tokens.

See [provider conformance](provider-conformance.md), [release runbook](release-runbook.md), and [threat model](threat-model.md).
