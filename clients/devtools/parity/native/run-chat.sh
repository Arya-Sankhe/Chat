#!/bin/bash
# chat-test.mjs behind the blocking proxy, so nothing reaches klui.ai or klui.tech.
HERE="$(cd "$(dirname "$0")" && pwd)"
LOGS="$HOME/.klui/parity/logs"
source ~/.klui/android-env.sh
node "$HERE/block-proxy.mjs" > "$LOGS/proxy.log" 2>&1 &
PROXY=$!
adb shell settings put global http_proxy 10.0.2.2:55990
trap 'kill $PROXY 2>/dev/null; adb shell settings put global http_proxy :0' EXIT
for p in 55600 55421 55900; do adb reverse tcp:$p tcp:$p >/dev/null; done
sleep 1
perl -e 'alarm 580; exec @ARGV' node "$HERE/chat-test.mjs"
