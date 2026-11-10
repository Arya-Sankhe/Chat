#!/bin/bash
# prefs-kill-test.sh [tries]: two quick settings saves, then a kill as soon as the second
# is acknowledged. The later value must survive. Needs the emulator, local-backend/up.sh,
# and tech.klui.app.dev installed.
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
source ~/.klui/android-env.sh
node block-proxy.mjs > "$HOME/.klui/parity/logs/proxy.log" 2>&1 & PROXY=$!
adb shell settings put global http_proxy 10.0.2.2:55990
trap 'kill $PROXY 2>/dev/null; adb shell settings put global http_proxy :0' EXIT
for p in 55600 55421 55900; do adb reverse tcp:$p tcp:$p >/dev/null; done
CALL='(m,a)=>new Promise(r=>{const id=920000+Math.floor(Math.random()*9999);const p=window.__kluiNativeReply;window.__kluiNativeReply=x=>{if(x.id!==id)return p(x);window.__kluiNativeReply=p;r(x.value)};window.KluiNativeHost.postMessage(JSON.stringify({id,method:m,args:a}))})'
K=klui.kill.test; kept=0; lost=0; out=""
./launch.sh new >/dev/null 2>&1
for t in $(seq 1 "${1:-30}"); do
  pad=$(printf 'x%.0s' $(seq 1 2000))
  node cdp.mjs 9333 "(async()=>{const c=$CALL;const a=c('prefs.set',{key:'$K',value:'first$pad'});await c('prefs.set',{key:'$K',value:'second$t'});await a;return 1})()" >/dev/null
  adb shell am force-stop tech.klui.app.dev
  ./launch.sh new >/dev/null 2>&1
  r=$(node cdp.mjs 9333 "(async()=>{const c=$CALL;return String(await c('prefs.get',{key:'$K'})).slice(0,12)})()")
  if [ "$r" = "second$t" ]; then kept=$((kept+1)); else lost=$((lost+1)); out="$out [$t:$r]"; fi
done
node cdp.mjs 9333 "(async()=>{const c=$CALL;await c('prefs.remove',{key:'$K'});return 1})()" >/dev/null
echo "kept=$kept lost=$lost$out"
[ "$lost" = 0 ]
