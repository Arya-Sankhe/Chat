#!/bin/bash
# Parity build of the Expo app (tech.klui.app.dev) against the local backend.
# --prebuild regenerates android/. KLUI_PARITY_APP_ID and a keystore make the upgrade APK.
set -e
source ~/.klui/android-env.sh
cd "$(dirname "$0")/../../../mobile"
export EXPO_PUBLIC_KLUI_API_ORIGIN=http://localhost:55600 KLUI_PARITY_BUILD=1 NODE_ENV=production
[ "$1" = "--prebuild" ] && npx expo prebuild --platform android --clean --no-install > /dev/null
cd android && ./gradlew assembleRelease -q
echo "$PWD/app/build/outputs/apk/release/app-release.apk"
