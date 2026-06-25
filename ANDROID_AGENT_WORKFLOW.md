# Android agent workflow

This repo is prepared for a local agentic Android loop on Arya's Windows PC.

## Installed local toolchain

- Android Studio + Android SDK at `C:\Users\Arya\AppData\Local\Android\Sdk`
- Android SDK platform-tools / emulator / command-line tools
- AVD: `Pixel_8_API_36`
- Android Studio JBR / Java 21 at `C:\Program Files\Android\Android Studio\jbr`
- Node/npm
- OpenAI Codex CLI
- Maestro CLI at `C:\maestro\bin`

The Git Bash environment has `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `adb`, `emulator`, `sdkmanager`, `avdmanager`, `maestro`, `node`, `npm`, and `codex` available after `source ~/.bashrc`.

For the current Git Bash/Hermes shell, use:

```bash
export JAVA_HOME='/c/Program Files/Android/Android Studio/jbr'
export ANDROID_HOME='/c/Users/Arya/AppData/Local/Android/Sdk'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:/c/Program Files/nodejs:/c/Users/Arya/AppData/Roaming/npm:/c/maestro/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
sdkmanager() { "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" "$@"; }
avdmanager() { "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager.bat" "$@"; }
```

## Normal build/test commands

```bash
npm test
npm run mobile:apk:debug
```

APK output:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Agentic local Android loop

Once an emulator or Android phone is connected:

```bash
npm run android:agent-test
```

The script:

1. Builds/syncs the Capacitor Android app.
2. Starts `Pixel_8_API_36` if no device is connected.
3. Installs the debug APK with `adb install -r`.
4. Launches package `tech.klui.app`.
5. Runs `.maestro/smoke.yaml` when Maestro is available.
6. On failure, writes artifacts to `artifacts/android-agent/`:
   - `build.log`
   - `maestro.log`
   - `logcat.txt`
   - `failure.png`

Codex/Hermes should inspect those artifacts before asking for manual testing.

## Emulator acceleration

If `emulator -accel-check` says the Android Emulator hypervisor driver is missing, run this script. It self-elevates with UAC and reboot may be required:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\Arya\Projects\Chat\scripts\mobile\enable-android-emulator-accel.ps1
```

Then verify:

```bash
emulator -accel-check
adb devices
```

If acceleration is not available, connect a physical Android phone with USB debugging enabled and run the same `npm run android:agent-test` command.
