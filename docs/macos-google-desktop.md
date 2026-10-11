# macOS Google desktop access

macOS uses mobile's Supabase Google PKCE session. It sends
`X-Klui-Client: klui-desktop-macos` on the existing desktop API routes. The server
verifies the bearer token through Supabase `/auth/v1/user` first, requires a Google
provider in server-owned app metadata and a matching token subject/session, then
uses the exact Supabase user ID for the existing profile, entitlement, and usage.
The header chooses a surface; it never establishes identity. Hosted OAuth client
tokens retain their existing verification and identity-mapping behavior.

Paid macOS accounts are eligible independently of the Windows beta allowlist.
Existing desktop chat/voice feature switches, active entitlements, weekly limits,
privacy checks, and enforced usage settlement still apply. No database migration
is needed. The existing `desktop_macos` usage surface and privacy table are reused.

A new macOS-only `POST /api/desktop/v1/consent` requires the normal desktop version
and UUID request headers, `{privacyConsent:true, policyVersion}` matching the
current policy, and a verified macOS Google session. It saves acknowledgement for
that exact account/client/version. The native UI explains prompt/screenshot and
voice processing and invokes this only when the user explicitly allows it.

macOS chat defaults to `anthropic/claude-haiku-5.5`. An explicit `X-Klui-Model:
openai/gpt-5.6-luna` selects the backup; arbitrary models are rejected.
Routing ceilings are $0.50 input and $2.50 output per million tokens, covering the
published long-context prices for both models as checked October 11, 2026. The
existing reservation setting still caps each funded request. Provider usage/cost
settlement remains authoritative; the app never handles the OpenRouter key.
Windows model routing and capabilities remain unchanged.

## Deployment

1. Deploy this backend change through the normal Chat release process.
2. In the existing Supabase project's Auth redirect URL allowlist, add exactly
   `tech.klui.anything.macos://oauth/callback`. Retain mobile and website callbacks.
3. Keep Google enabled and the existing desktop features/enforced billing setup
   configured. `DESKTOP_MACOS_GOOGLE_ENABLED=true` is the default and can disable
   the new path independently. A hosted macOS OAuth Server client is unnecessary.
4. Use an existing paid Google account in the rebuilt macOS app. Verify the same
   plan/weekly allowance, allow processing, grant macOS permissions, and confirm a
   chat and voice request debit that allowance on the website/mobile too.

The production API was deployed October 11, 2026 using a temporary candidate
container and graceful proxy cutover. Existing API connections drained before
replacing the main service; the original proxy configuration was restored and the
candidate removed. Website/public assets have the same hash before and after.
Health, plans, Google configuration, legal pages, and authentication scripts were
verified. Research, document, transcription, and voice workers were not restarted.
Production uses `https://klui.ai`, macOS Google sessions, Haiku/Luna routing, and
enforced metering. Build: `a095bbd8cb100497c0c0415b5785487b47c6a49fee91b526235968f94f5dc296`.

The user is adding the Supabase callback manually. Auth dashboard settings and
live account/billable requests were not changed or exercised by the agent.

Rollback is available on the VPS: image `klui-chat:before-macos-google-20261011`
and source/proxy backups under `/root/klui-deploy-backups/macos-google-20261011`.
Restore the saved source archive, tag the saved image as `klui-chat-klui-chat:latest`,
and recreate only `klui-chat` using the same production Compose files if needed.

## Validation

`npm test`: 1,292 passing checks. New tests cover verified Google identity, rejected
forgeries/user metadata, exact account reuse, versioned consent, plan/usage reads,
macOS computer control, and Haiku/Luna ceilings. The existing Windows capability
check now exercises the API response. `npm run check:syntax` passes.

References: [Supabase mobile deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[OpenRouter model catalog](https://openrouter.ai/api/v1/models).
