# Klui Mobile MVP

Klui ships the same responsive frontend in two mobile forms:

- Android: a bundled Capacitor APK.
- iPhone: an installable PWA from `https://klui.tech`.

The Android package never loads the production website as its WebView. `npm run
mobile:build` bundles the current `public/` application into `dist-mobile/`,
and Capacitor copies that output into the Android project. All API requests
still go to `https://klui.tech`.

## Local requirements

- Node.js 20 or newer.
- Android Studio with Android SDK 36.
- JDK 21.
- An Android device or emulator with Android 10 or newer.

Install dependencies and create a debug build:

```sh
npm ci
npm run mobile:apk:debug
```

The debug APK is written to:

```txt
android/app/build/outputs/apk/debug/app-debug.apk
```

Use `npm run mobile:open` to open the native project in Android Studio.

## Supabase and Google authentication

The website keeps Google Identity Services. Android uses Supabase Google OAuth
with PKCE and the callback:

```txt
tech.klui.app://auth/callback
```

Add that callback to the Supabase Auth redirect allow list. Keep
`https://klui.tech` and `https://klui.tech/**` for the website/PWA.

The OAuth flow stores the Supabase session and PKCE verifier in Android secure
storage. Access and refresh tokens are never included in the callback URL.

## Production environment

The server already permits these mobile origins:

```txt
https://klui.tech
https://www.klui.tech
https://localhost
```

Use `MOBILE_ALLOWED_ORIGINS` only for additional development origins:

```env
MOBILE_ALLOWED_ORIGINS=http://localhost:5173
```

Add the packaged Android origin to Cloudflare R2 CORS:

```json
[
  {
    "AllowedOrigins": [
      "https://klui.tech",
      "https://www.klui.tech",
      "https://localhost"
    ],
    "AllowedMethods": ["PUT", "HEAD", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Direct R2 uploads remain preferred. Klui automatically uses its authenticated
upload relay if direct upload is unavailable.

## Release signing

Create the release key outside the repository:

```sh
keytool -genkeypair \
  -v \
  -keystore "$HOME/.klui/klui-release.keystore" \
  -alias klui \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Keep at least two encrypted backups. Losing this key prevents existing Android
users from installing future updates.

Export signing values only in the release environment:

```sh
export KLUI_KEYSTORE_PATH="$HOME/.klui/klui-release.keystore"
export KLUI_KEYSTORE_PASSWORD="..."
export KLUI_KEY_ALIAS="klui"
export KLUI_KEY_PASSWORD="..."
export KLUI_VERSION_NAME="1.0.0"
export KLUI_VERSION_CODE="1"
```

Build:

```sh
npm run mobile:apk:release
```

The release build intentionally fails when any signing value is missing. This
prevents an unsigned APK from being mistaken for a distributable build.

The signed APK is written to:

```txt
android/app/build/outputs/apk/release/app-release.apk
```

Get the signing certificate fingerprint:

```sh
keytool -list -v \
  -keystore "$KLUI_KEYSTORE_PATH" \
  -alias "$KLUI_KEY_ALIAS"
```

Copy the SHA-256 fingerprint and generate Android App Links:

```sh
export KLUI_ANDROID_SHA256="AA:BB:..."
npm run mobile:assetlinks
```

Deploy the generated `public/.well-known/assetlinks.json` before testing
`https://klui.tech/c/<conversation-id>` links.

## Publish an APK

Publish the APK and generate release metadata:

```sh
npm run mobile:release:publish -- \
  android/app/build/outputs/apk/release/app-release.apk \
  1.0.0 \
  1 \
  "Initial Android MVP"
```

This creates:

```txt
public/downloads/android/klui-1.0.0.apk
public/downloads/android/latest.json
```

The publish script verifies the APK signature, package ID, version name and
version code before copying anything into `public/downloads/android/`. It also
requires `KLUI_ANDROID_SHA256` and rejects APKs signed with any other key,
including the Android debug key.

Commit or deploy those files to the VPS, then rebuild the app container:

```sh
git pull
docker compose up -d --build
```

The public download page is:

```txt
https://klui.tech/download/android
```

Caddy already proxies the domain to Klui, so no special route is needed.
The Node static server serves the page, APK and metadata. Verify:

```sh
curl -I https://klui.tech/download/android
curl https://klui.tech/downloads/android/latest.json
```

The installed APK checks metadata at startup and when resuming, at most once
every six hours. Increase `versionCode` for every release. Set
`minimumVersionCode` in `latest.json` only when an old build must be blocked.

## PWA

Deploying the normal website also deploys the PWA manifest, icons, service
worker and offline page. On iPhone:

1. Open `https://klui.tech` in Safari.
2. Tap Share.
3. Tap **Add to Home Screen**.

The service worker caches only public installation assets and the offline page.
It never caches API requests, chat streams, Supabase responses, R2 objects or
authenticated documents.

## Native migration boundary

Capacitor-specific behavior lives in:

```txt
capacitor.config.ts
android/
scripts/mobile/
public/js/platform/
```

The backend contract, stream events and upload flow remain platform-neutral.
When the Expo application reaches parity, remove those Capacitor paths and
native dependencies while retaining `public/` as the website/PWA.
