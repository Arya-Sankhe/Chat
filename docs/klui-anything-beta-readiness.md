# Klui Anything beta readiness

Updated: 2026-08-13

## Ready for private beta

- Windows installer and in-app experience are Klui-branded.
- Users sign in through the Klui website with OAuth and PKCE; provider tokens remain opaque to the app.
- Browser authorization has both automatic app handoff and a visible **Open Klui Anything** fallback.
- Access and refresh tokens use the intended Windows storage boundaries.
- Active paid plans can use desktop chat and voice through the shared weekly allowance.
- OpenRouter and Sarvam credentials remain server-only.
- Chat and STT use atomic reserve/settle metering, with reconciliation and independent kill switches.
- Website chat, desktop chat, and voice record against the same account ledger.
- The private download page publishes an exact version, byte count, and SHA-256 checksum.
- Computer control is deliberately excluded from this beta.
- Requests that begin while settled usage is below 100% may finish, including sibling Console, Compare, and Council calls. Temporary reservations never change the customer-facing percentage or block siblings; later requests stop with a non-retryable limit message after settled usage reaches the cap.
- `0.1.0-beta.10` is the current unsigned private-beta release candidate. The public channel remains signing-gated.

## Private-beta test checklist

1. Fresh install on Windows 10 and Windows 11.
2. Login in Brave, Chrome, and Edge, including the manual **Open Klui Anything** fallback.
3. Login denial, expired attempt, logout, restart, and refresh-token rotation.
4. Paid, canceled-but-still-active, free, and expired account behavior.
5. Chat, voice, allowance exhaustion, offline recovery, and mandatory-update behavior.
6. Upgrade from the previous beta without losing the Klui session.
7. Confirm every accepted provider request becomes settled or estimated and no reservation remains pending.

## Required before a broad public launch

- Obtain the company code-signing certificate, Authenticode-sign the installer, and make the signed channel public.
- Complete the hosted OAuth provider conformance gate. Supabase OAuth is acceptable for this private beta, but its beta status remains a public-launch risk until the required rotation, reuse, revocation, and error cases pass in staging.
- Complete at least seven stable observation days and roughly 1,000 production-equivalent metered requests. This is an accounting confidence sample, not a requirement for 1,000 users.
- Finish the OAuth, callback, credential, SSRF, privacy, and metering threat-model review with no unresolved high-severity findings.
- Obtain final privacy/data-processing approval for screen context, prompts, and voice.
- Run the full website regression suite and Windows fresh-install/upgrade matrix against the release candidate.
- Add a user-friendly support path for auth failures and beta feedback.
- Decide whether computer control is stable enough for a later release; it is not part of the current beta promise.

## Release policy

Keep the website and desktop in separate repositories. The versioned `desktop-v1` OpenAPI artifact remains their compatibility boundary. Private-beta flags can be disabled independently without changing website chat or billing.
