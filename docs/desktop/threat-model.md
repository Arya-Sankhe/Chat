# Klui desktop threat model

Status: engineering mitigations implemented; independent security and privacy sign-off remains a public-release gate.

| Threat | Mitigation | Residual / validation |
|---|---|---|
| Custom-URI interception | External browser, authorization code, S256 PKCE, random in-memory state, ten-minute age, exact URI/path, single use. | Another handler may receive the URI but cannot redeem without the verifier. Verify signed installer registration and callback replay in staging. |
| Named-pipe injection | Pipe name includes a hash of current SID and Windows session ID; `CurrentUserOnly`; 4096-byte cap; no CR/LF; two-second delivery/read windows; URI and state revalidated. | Same-user malware can act as the user and is outside the app boundary. Confirm ACL with a second Windows account and session. |
| Refresh-token theft | Refresh token exists only in Windows Credential Manager; rotation and provider-family reuse detection; invalid grant clears shell/core state. | Credential Manager does not protect against malware already running as the same user. Document this plainly; do not claim hardware isolation. |
| Access-token leakage | Access token stays in C#/core memory and JSON-RPC; never args, environment, files, logs, analytics, or crash text. | Memory inspection by same-user malware remains possible. Inspect production crash configuration. |
| Authorization-code replay | Provider single-use code plus local single-use state and PKCE verifier. | Conformance gate must prove the hosted provider behavior. |
| SSRF/media fetching | Desktop API rejects `http:`/`https:` images and accepts only bounded PNG/JPEG/WebP data media. | Re-run schema fuzzing for nested content shapes. |
| Oversized input | 8 MiB chat, 4 MiB image, 5 MiB WAV, 30-second voice, 128 messages, 64 tools, 256 KiB tool schema, 4096-byte callback. | Add edge body limits equal to or lower than application limits. |
| Prompt/media observability | API does not log provider bodies, prompts, tool results, screenshots, audio, tokens, or codes; captures are deleted after handoff and stale files on startup. | Audit APM, reverse proxy access/error logs, and crash dumps before launch. |
| Modified desktop bypass | Release Pi exposes only logical `klui`; raw provider keys/endpoints are absent; provider overrides and inherited provider keys are cleared; server verifies entitlement and client ID. | Modified clients can change local behavior but cannot obtain Klui provider secrets or bypass server metering. |
| Provider accepted, client/server died | Request is marked submitted, upstream is drained after downstream disconnect, 60-second reconciler recovers exact generation cost or settles the ceiling as estimated. | Run all documented termination chaos cases against staging. |
| Billing race/tool-loop cost | Atomic row lock plus used+reserved+ceiling check, account/request idempotency, per-iteration request ID, 20-iteration local guard, server token ceiling. | A ceiling violation disables funded inference in-process and requires flag rollback/config correction. |
| Identity takeover by email | Canonical UUID and explicit `(provider, subject)` mapping; no email linking. | Provider migration requires reviewed mapping import and ambiguous identities fail closed. |

The public installer must be Authenticode signed. An unsigned portable ZIP is not an approved primary distribution.
