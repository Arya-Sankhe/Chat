#!/bin/bash
# Capacitor reference app (signed in, text size 115) -> install ~/.klui/parity/upgrade.apk over it -> report.
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
node block-proxy.mjs > "$HOME/.klui/parity/logs/proxy.log" 2>&1 & PROXY=$!; trap 'kill $PROXY 2>/dev/null' EXIT; sleep 1
source ~/.klui/android-env.sh
M='(()=>{const s=document.createElement("span");s.textContent="Xg";s.style.cssText="position:fixed;font-size:20px";document.body.appendChild(s);const h=s.getBoundingClientRect().height;s.remove();return h})()'
attach() { for i in $(seq 1 60); do pid=$(adb shell pidof tech.klui.app.ref | tr -d '\r'); [ -n "$pid" ] && adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pid" && break; sleep 0.5; done
  adb forward --remove tcp:9334 >/dev/null 2>&1; adb forward tcp:9334 localabstract:webview_devtools_remote_$pid >/dev/null
  for i in $(seq 1 40); do r=$(CDP_TIMEOUT=2000 node cdp.mjs 9334 'Boolean(document.body && document.body.dataset.mode && !document.getElementById("mobileLaunchScreen"))' 2>/dev/null); [ "$r" = "true" ] && break; sleep 0.5; done; sleep 3; }
adb uninstall tech.klui.app.ref >/dev/null; adb install $HOME/.klui/parity/refapp/android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
./launch.sh ref >/dev/null
AUTH=$(cd "$HERE/../.." && node -e 'import("./local-backend/fixtures.mjs").then(async m=>{console.log(JSON.stringify(JSON.stringify(await m.session("old"))))})')
node cdp.mjs 9334 "(async()=>{const P=Capacitor.Plugins;await P.SecureStorage.internalSetItem({prefixedKey:'capacitor-storage_klui.auth.v1',data:JSON.stringify($AUTH)});const k='klui.chat.controls.v1';const v=JSON.parse(localStorage.getItem(k)||'{}');v.uiTextScale=115;const s=JSON.stringify(v);localStorage.setItem(k,s);await P.Preferences.set({key:k,value:s});return 'seeded'})()"
sleep 2; ./launch.sh ref >/dev/null; sleep 2
echo "capacitor: $(node cdp.mjs 9334 'JSON.stringify({guest:document.body.classList.contains("guest-mode")})') zoom=$(node cdp.mjs 9334 "$M")"
adb shell am force-stop tech.klui.app.ref; adb install -r "$HOME/.klui/parity/upgrade.apk" >/dev/null
adb logcat -c; adb shell am start -n tech.klui.app.ref/.MainActivity >/dev/null; attach
echo "upgraded first launch: $(node cdp.mjs 9334 'JSON.stringify({v:window.__kluiNative?.version,guest:document.body.classList.contains("guest-mode")})') zoom=$(node cdp.mjs 9334 "$M")"
adb logcat -d -s KluiWebView:* KluiHost:* KluiLegacyStorage:* ReactNativeJS:* | tail -15
