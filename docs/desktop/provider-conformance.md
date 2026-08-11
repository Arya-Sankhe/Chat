# Hosted OAuth provider conformance gate

Run this matrix against staging before setting `DESKTOP_OAUTH_ENABLED=true`. Record the provider version, application ID, tester, timestamp, evidence link, and pass/fail for every row. Any failure blocks Supabase as the production adapter; implement and test a Clerk adapter behind `desktopAuthProvider` instead.

| Test | Required result |
|---|---|
| Public native client | Code exchange succeeds without a client secret. |
| PKCE S256 | Valid verifier succeeds; missing, plain, and incorrect verifiers fail. |
| Redirect allowlist | The exact Windows URI succeeds; case, slash, host, path, query, and macOS substitutions fail. |
| Existing website session | An authenticated klui.tech browser reaches first-party consent without another provider-specific desktop login. |
| Consent | First approval is explicit; denial returns `access_denied`; `prompt=consent` re-shows the current privacy policy. |
| Client identity | A verified access token contains the registered provider client ID; an ordinary website token is rejected by `/api/desktop/v1/*`. |
| Code replay | The first exchange succeeds and the second returns `invalid_grant`. |
| Refresh rotation | Every refresh returns a new refresh token and the old one becomes invalid. |
| Reuse detection | Replaying a rotated token revokes its token family/session and returns `invalid_grant`. |
| Concurrent refresh | One serialized refresh wins; stale parallel refresh cannot leave a usable split token family. |
| Current-session logout | `/api/desktop/v1/logout` invalidates the current provider session. |
| Grant revocation | Provider `revokeClientGrant` invalidates all sessions and refresh tokens for that client. |
| Token status normalization | Every valid provider `2xx` (including 200/201 changes) returns the stable Klui token JSON. |
| Error normalization | Provider errors contain no provider-only fields or secrets at the facade. |

Also run the fake-provider contract tests in `test/desktop-integration.test.js`. Those prove that provider IDs stay behind the facade, but they do not replace the hosted staging tests.
