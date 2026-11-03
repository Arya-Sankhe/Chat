# Klui clients (rebuild)

The rebuilt Klui frontends, per `docs/CROSS_PLATFORM_REBUILD_PLAN.md`:

| Package | What it is |
| --- | --- |
| `shared/` (`@klui/shared`) | TypeScript domain layer: API client, SSE parser, stream reducer, session manager, chat store/run controller, design tokens. No DOM or React Native imports. |
| `web/` (`@klui/web`) | React 19 + Vite website; the same build runs inside the mobile app. |
| `mobile/` (`@klui/mobile`) | Expo SDK 58 app: one WebView hosting the web build, plus native adapters (`modules/klui-host`). Android today; the iOS host is still to be written. |
| `devtools/mock-api.mjs` | A stand-in backend that speaks the real wire contract, for testing without production data. |

This is its own npm workspace root with its own lockfile. The server at the
repository root, its `package-lock.json` and its Docker image are untouched.
The old frontend (`public/`) and the Capacitor Android project keep shipping
until these clients reach parity.

## Status

The web client reproduces the current site screen for screen except Projects,
which is out of scope for now (Dojo courses are in). `devtools/parity/` holds
the probes that compare it with the old site against a local backend
(`devtools/local-backend/`): chat, turns, composer, settings, modes, paywall,
surfaces, study, voice and admin. The Android app runs the same build, so it
inherits all of that; its native adapters are compared with the Capacitor app
by `devtools/parity/native-probe.mjs`. There is no iOS host yet: `klui-host`
registers only Android, so an iOS build fails at launch until a WKWebView host
implementing the same contract exists. Its reference is the unmerged Capacitor
iOS target on `origin/codex/ios-port-latest`; building and comparing it needs
Xcode.

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

The app is the web build in one WebView (`mobile/modules/klui-host`), served
from the APK at `https://localhost`. The page calls the host through
`KluiNativeHost.postMessage` (contract: `shared/src/nativeHost.ts`; page side:
`web/src/islands/platform/nativeHost.js`; host side: `mobile/src/host/`).

```sh
source "$HOME/.klui/android-env.sh"
cd mobile
export APP_VARIANT=production EXPO_PUBLIC_KLUI_API_ORIGIN=https://klui.ai   # read again by Gradle
npx expo prebuild --platform android --clean
cd android && KLUI_VERSION_CODE=… KLUI_VERSION_NAME=… \
  KLUI_KEYSTORE_PATH=… KLUI_KEYSTORE_PASSWORD=… KLUI_KEY_ALIAS=… KLUI_KEY_PASSWORD=… \
  ./gradlew assembleRelease
```

Every Gradle build first runs `scripts/bundle-web.mjs`, building the web client
into the host module's assets (`KLUI_SKIP_WEB_BUNDLE=1` reuses the last one).
`plugins/withKluiRelease.js` gives the generated Gradle file the Capacitor
build's release setup: `KLUI_VERSION_CODE`/`KLUI_VERSION_NAME` are read when
Gradle runs (a release must carry a higher code than the installed app), the
`KLUI_KEYSTORE_*` values sign it with the existing key, and a production
release without them fails rather than using the debug key.

A parity build for testing against the local backend sets
`EXPO_PUBLIC_KLUI_API_ORIGIN=http://localhost:55600 KLUI_PARITY_BUILD=1`
(plain http to localhost and WebView debugging; never for a release) and
needs `adb reverse tcp:55600 tcp:55600` (also 55421 and 55900).
`devtools/parity/native-probe.mjs` compares it with the Capacitor app.

To rerun the comparisons: `devtools/local-backend/up.sh` starts the local services,
then `devtools/parity/suite.sh` runs the web probes. For Android, boot the emulator
with host GPU rendering and 4 GB of RAM, run `parity/native/build-refapp.sh` and
`build-candidate.sh`, install both APKs, then `run-probe.sh`.

## Decisions worth knowing

- **App identity.** `APP_VARIANT=production` builds use `tech.klui.app` so they
  update the Capacitor install in place (same signing key, higher version code).
  Development builds are `tech.klui.app.dev` and install side by side.
  Its OAuth callback `tech.klui.app.dev://auth/callback` must be added to the
  Supabase Auth redirect allow list before Google sign-in works in dev builds
  against real Supabase.
- **Upgrading from Capacitor.** On first launch the host reads what the
  Capacitor app stored (`KluiLegacyStorage.kt`: the secure-storage session and
  update-check stamp, the Preferences values), copies them into SecureStore and
  the preferences file, then deletes the old copies, so users stay signed in.
  The page's localStorage carries over by itself (same `https://localhost` origin).
  A parity build with `KLUI_PARITY_APP_ID=tech.klui.app.ref` installs over the
  Capacitor test build to exercise this.
- **System bar icons** keep the Capacitor app's on-device result: light status
  icons in light mode, dark in dark mode (its `StatusBar.setStyle` call was
  inverted), and a dark gesture handle in both (its navigation bar call never
  took effect).
- **Launch insets.** The Capacitor app sometimes misses the system bar insets at
  launch (its first pass lands before the page listens), leaving its top bar
  under the status bar until something resends them. The host sends them once
  the page is up, so the new app does not copy that; `native-probe` has the old
  app resend before comparing.
- **Web session.** Same `klui.auth.v1` localStorage key as the current site, so
  switching the site over keeps people signed in.
- **Stop.** Stopping a durable turn calls the cancel endpoint, which withdraws the
  whole turn on the server (`klui_cancel_pending_document_turn`); the text goes
  back to the composer. Same as the current app.
- **Retry** streams directly without a durable turn (server behavior), so a retry
  cannot be rejoined after a disconnect. Same as the current app.
- **No server keepalive.** The server sends no SSE heartbeat, so the client treats
  45 s of silence on a durable turn as a half-open connection and reattaches.
  A server-side `: ping` every ~15 s would let that timeout drop.
