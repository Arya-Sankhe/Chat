# Klui clients (rebuild)

The rebuilt Klui frontends, per `docs/CROSS_PLATFORM_REBUILD_PLAN.md`:

| Package | What it is |
| --- | --- |
| `shared/` (`@klui/shared`) | TypeScript domain layer: API client, SSE parser, stream reducer, session manager, chat store/run controller, design tokens. No DOM or React Native imports. |
| `web/` (`@klui/web`) | React 19 + Vite + React Router website. |
| `mobile/` (`@klui/mobile`) | Expo SDK 58 / React Native app for Android and iOS (Expo Router). |
| `devtools/mock-api.mjs` | A stand-in backend that speaks the real wire contract, for testing without production data. |

This is its own npm workspace root with its own lockfile. The server at the
repository root, its `package-lock.json` and its Docker image are untouched.
The old frontend (`public/`) and the Capacitor Android project keep shipping
until these clients reach parity.

## Status: milestone 1 (chat slice)

Done on web and Android:

- Sign in (web: Google Identity Services; native: Supabase PKCE through the system browser), session refresh, sign out.
- Conversation list, open a conversation, load earlier messages.
- Send and stream a reply (markdown, code, tables), stop, retry a reply.
- Replies are owned by the store, not the screen: leaving a chat never cancels its reply, and the list shows which chats are replying.
- Reload/relaunch rejoins a reply the server is still writing (`pendingTurns`); a dropped or silent connection is reattached and the server's replay rebuilds the reply without duplicate text.

Not yet: attachments, settings, compare/council, research, projects, study,
documents, voice, illustrations. iOS needs an EAS build or Xcode to verify.

## Commands

```sh
cd clients
npm install
npm test            # shared unit tests
npm run typecheck   # all three packages
npm run web:build
```

### Web against the mock API

```sh
node devtools/mock-api.mjs 5199
KLUI_API_TARGET=http://localhost:5199 npm run web:dev    # http://localhost:5180
```

The mock has no Google client, so sign in by seeding a session in the browser console:

```js
localStorage.setItem("klui.auth.v1", JSON.stringify({ access_token: "mock-access-0", refresh_token: "mock-refresh-0", expires_at: Math.floor(Date.now() / 1000) + 60, token_type: "bearer" }));
location.reload();
```

Prompts steer the mock: `fail` (rejected before a turn starts), `drop` (the
connection dies mid-reply), `queue` (4 s before the model starts, so Stop
withdraws the turn), `long`.

### Web against a real backend

`KLUI_API_TARGET=http://localhost:3000 npm run web:dev` with the existing server
running (`npm run dev` at the repository root). Google sign-in only works on
origins listed for the Google client, so add `http://localhost:5180` there or
seed a session.

### Android

```sh
source "$HOME/.klui/android-env.sh"
cd mobile
EXPO_PUBLIC_KLUI_API_ORIGIN=http://10.0.2.2:5199 npx expo prebuild --platform android --clean
npx expo run:android            # or: cd android && ./gradlew :app:assembleDebug
npx expo start --dev-client     # Metro for the dev build
```

`EXPO_PUBLIC_KLUI_API_ORIGIN` defaults to `https://klui.ai`. Against the mock,
"Continue with Google" runs the real PKCE code path end to end (the mock's
`/auth/v1/authorize` redirects straight back with a code). The dev client's
floating tools button sits over the header's Sign out; hide it from the dev
menu (Tools button) when testing.

## Decisions worth knowing

- **App identity.** `APP_VARIANT=production` builds use `tech.klui.app` so they
  update the Capacitor install in place (same signing key, higher version code).
  Development builds are `tech.klui.app.dev` and install side by side.
  Its OAuth callback `tech.klui.app.dev://auth/callback` must be added to the
  Supabase Auth redirect allow list before Google sign-in works in dev builds
  against real Supabase.
- **Sign-in after upgrading from Capacitor.** The Capacitor app keeps its session
  in `@aparajita/capacitor-secure-storage`, which Expo SecureStore cannot read.
  Users sign in once after the upgrade unless a migration bridge is added.
- **Web session.** Same `klui.auth.v1` localStorage key as the current site, so
  switching the site over keeps people signed in.
- **Stop.** Stopping a durable turn calls the cancel endpoint, which withdraws the
  whole turn on the server (`klui_cancel_pending_document_turn`); the text goes
  back to the composer. Same as the current app.
- **Retry** streams directly without a durable turn (server behavior), so a retry
  cannot be rejoined after a disconnect. Same as the current app.
- **Streaming on native** uses `expo/fetch`; React Native's own fetch buffers bodies.
  Its errors are plain `Error`s with native messages, so the API client turns
  every transport failure into one `NetworkError` that the run controller
  rejoins on, on every platform.
- **PKCE on native.** Hermes has no Web Crypto, and supabase-js then silently
  falls back to a `Math.random()` verifier with a `plain` challenge.
  `mobile/src/lib/webCrypto.ts` supplies `getRandomValues` and SHA-256 from
  expo-crypto so sign-in uses S256.
- **Markdown on native** is rendered from `marked`'s lexer (the same parser as web),
  memoized per block so a streaming reply re-renders only its last block.
- **No server keepalive.** The server sends no SSE heartbeat, so the client treats
  45 s of silence on a durable turn as a half-open connection and reattaches.
  A server-side `: ping` every ~15 s would let that timeout drop.
