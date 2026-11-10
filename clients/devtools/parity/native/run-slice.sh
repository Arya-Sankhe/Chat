#!/bin/bash
# slice-test.mjs behind the blocking proxy, so nothing reaches klui.ai or klui.tech.
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGS="$HOME/.klui/parity/logs"
source ~/.klui/android-env.sh
PROXY_REMAP=55421:55431,55600:55432 node "$HERE/block-proxy.mjs" > "$LOGS/proxy.log" 2>&1 &
PROXY=$!
adb shell settings put global http_proxy 10.0.2.2:55990
trap 'kill $PROXY 2>/dev/null; adb shell settings put global http_proxy :0; adb reverse tcp:55421 tcp:55421 >/dev/null; adb reverse tcp:55600 tcp:55600 >/dev/null' EXIT
for p in 55900; do adb reverse tcp:$p tcp:$p >/dev/null; done
sleep 1
perl -e 'alarm 600; exec @ARGV' node "$HERE/slice-test.mjs"
