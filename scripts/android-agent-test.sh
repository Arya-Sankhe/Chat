#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="${APP_ID:-tech.klui.app}"
AVD_NAME="${AVD_NAME:-Pixel_8_API_36}"
FLOW="${FLOW:-$ROOT/.maestro/smoke.yaml}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$ROOT/artifacts/android-agent}"
ANDROID_HOME="${ANDROID_HOME:-/c/Users/Arya/AppData/Local/Android/Sdk}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
JAVA_HOME="${JAVA_HOME:-/c/Program Files/Android/Android Studio/jbr}"
export ANDROID_HOME ANDROID_SDK_ROOT JAVA_HOME
export PATH="$ROOT/node_modules/.bin:$JAVA_HOME/bin:/c/Program Files/nodejs:/c/Users/Arya/AppData/Roaming/npm:/c/maestro/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

mkdir -p "$ARTIFACT_DIR"
LOGCAT="$ARTIFACT_DIR/logcat.txt"
SCREENSHOT="$ARTIFACT_DIR/failure.png"
MAESTRO_LOG="$ARTIFACT_DIR/maestro.log"
BUILD_LOG="$ARTIFACT_DIR/build.log"

have_device() {
  adb devices | awk 'NR>1 && $2 == "device" { found=1 } END { exit found ? 0 : 1 }'
}

wait_for_device() {
  local deadline=$((SECONDS + ${EMULATOR_BOOT_TIMEOUT:-240}))
  until have_device; do
    if (( SECONDS > deadline )); then
      echo "Timed out waiting for Android emulator/device" >&2
      adb devices >&2 || true
      return 1
    fi
    sleep 3
  done
  adb wait-for-device
  local boot_deadline=$((SECONDS + ${ANDROID_BOOT_TIMEOUT:-240}))
  until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    if (( SECONDS > boot_deadline )); then
      echo "Timed out waiting for Android boot completion" >&2
      return 1
    fi
    sleep 3
  done
}

start_emulator_if_needed() {
  if have_device; then
    return 0
  fi
  echo "No Android device detected; starting emulator $AVD_NAME..."
  if ! emulator -list-avds | tr -d '\r' | grep -qx "$AVD_NAME"; then
    echo "AVD '$AVD_NAME' not found. Available AVDs:" >&2
    emulator -list-avds >&2 || true
    return 1
  fi

  # Fail fast with a clear fix when Windows emulator acceleration is not ready.
  # Without this, the x86_64 AVD exits and the script wastes minutes polling adb.
  local accel_log="$ARTIFACT_DIR/accel-check.log"
  emulator -accel-check > "$accel_log" 2>&1 || true
  if grep -Eqi 'hypervisor driver is not installed|requires hardware acceleration|not installed' "$accel_log"; then
    cat >&2 <<EOF
Android emulator acceleration is not enabled, so the x86_64 AVD cannot boot.
Run this once from an elevated PowerShell prompt, approve UAC, then reboot if Windows asks:

  powershell -ExecutionPolicy Bypass -File C:\\Users\\Arya\\Projects\\Chat\\scripts\\mobile\\enable-android-emulator-accel.ps1

Then verify:

  source ~/.bashrc
  emulator -accel-check
  npm run android:agent-test

Acceleration check output was saved to: $accel_log
EOF
    return 1
  fi

  nohup emulator -avd "$AVD_NAME" -no-snapshot-save -no-boot-anim > "$ARTIFACT_DIR/emulator.log" 2>&1 &
  wait_for_device
}

collect_failure_artifacts() {
  adb exec-out screencap -p > "$SCREENSHOT" 2>/dev/null || true
  adb logcat -d -t 2000 > "$LOGCAT" 2>/dev/null || true
  echo "Failure artifacts:"
  echo "  $SCREENSHOT"
  echo "  $LOGCAT"
  echo "  $MAESTRO_LOG"
  echo "  $BUILD_LOG"
}
trap 'rc=$?; if [[ $rc -ne 0 ]]; then collect_failure_artifacts; fi; exit $rc' EXIT

cd "$ROOT"
echo "== Tool versions =="
node --version
npm --version
java -version 2>&1 | head -3
adb version | head -2
maestro --version || true

echo "== Build/sync debug APK =="
# Avoid nested `npm run` inside Git Bash on Windows because npm may hand scripts
# to cmd.exe with a POSIX-shaped PATH. Run the same steps directly instead.
{
  node node_modules/vite/bin/vite.js build --config vite.mobile.config.js
  node scripts/mobile/copy-static.mjs
  node node_modules/@capacitor/cli/bin/capacitor sync android
  node scripts/mobile/gradle.mjs assembleDebug
} 2>&1 | tee "$BUILD_LOG"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
test -f "$APK"

echo "== Emulator/device =="
start_emulator_if_needed
adb logcat -c || true

echo "== Install APK =="
adb install -r "$APK"

echo "== Launch app =="
adb shell monkey -p "$APP_ID" 1 >/dev/null
sleep 3

echo "== Maestro smoke flow =="
if [[ -f "$FLOW" ]] && command -v maestro >/dev/null 2>&1; then
  MAESTRO_CLI_NO_ANALYTICS=1 maestro test "$FLOW" 2>&1 | tee "$MAESTRO_LOG"
else
  echo "Skipping Maestro: missing flow or maestro binary. Capturing screenshot only."
  adb exec-out screencap -p > "$ARTIFACT_DIR/current.png" || true
fi

echo "ANDROID_AGENT_TEST_PASS"
