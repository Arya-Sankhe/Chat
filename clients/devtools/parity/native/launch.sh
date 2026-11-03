#!/bin/bash
# launch.sh ref|new [port]: foregrounds one app (stopping the other), forwards its WebView DevTools.
source ~/.klui/android-env.sh
case "$1" in
  ref) pkg=tech.klui.app.ref; act=tech.klui.app.MainActivity; port=${2:-9334}; other=tech.klui.app.dev ;;
  new) pkg=tech.klui.app.dev; act=tech.klui.app.dev.MainActivity; port=${2:-9333}; other=tech.klui.app.ref ;;
esac
adb shell am force-stop $other
adb shell am force-stop $pkg
adb shell am start -n $pkg/$act >/dev/null
for i in $(seq 1 40); do
  pid=$(adb shell pidof $pkg | tr -d '\r')
  [ -n "$pid" ] && adb shell cat /proc/net/unix | grep -q "webview_devtools_remote_$pid" && break
  sleep 0.5
done
adb forward --remove tcp:$port >/dev/null 2>&1
adb forward tcp:$port localabstract:webview_devtools_remote_$pid >/dev/null
# Wait for the shell to render (boot finished: renderShell toggles guest-mode or shows chats).
node "$(dirname "$0")/cdp.mjs" $port '(async()=>{for(let i=0;i<60;i++){ if (document.body.dataset.mode && !document.getElementById("mobileLaunchScreen")) break; await new Promise(r=>setTimeout(r,250)); } await new Promise(r=>setTimeout(r,1500)); return document.body.className})()'
