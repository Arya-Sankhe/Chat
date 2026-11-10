#!/bin/bash
# Builds the old Capacitor app from this checkout as tech.klui.app.ref, against the
# local backend with WebView debugging on, in a scratch worktree. Rerun after merging main.
set -e
source ~/.klui/android-env.sh
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
REF="$HOME/.klui/parity/refapp"
git -C "$ROOT" worktree prune
git -C "$ROOT" worktree remove --force "$REF" 2>/dev/null || true
git -C "$ROOT" worktree add --detach "$REF" HEAD >/dev/null
cd "$REF"
ln -sfn "$ROOT/node_modules" node_modules
sed -i '' 's/webContentsDebuggingEnabled: false/webContentsDebuggingEnabled: true/; s/cleartext: false/cleartext: true/' capacitor.config.ts
sed -i '' 's/applicationId "tech.klui.app"/applicationId "tech.klui.app"\n        applicationIdSuffix ".ref"/' android/app/build.gradle
export VITE_KLUI_API_ORIGIN=http://localhost:55600
npx vite build --config vite.mobile.config.js
node scripts/mobile/copy-static.mjs
npx cap sync android
(cd android && ./gradlew assembleDebug -q)
echo "$REF/android/app/build/outputs/apk/debug/app-debug.apk"
