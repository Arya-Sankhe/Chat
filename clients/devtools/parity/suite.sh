#!/bin/bash
# Every web probe against the old site, with a document worker on the local queue.
# Needs local-backend/up.sh, and a venv with worker/requirements.txt at
# ~/.klui/parity/docworker-venv. Each probe's output: ~/.klui/parity/logs/<probe>.out
cd "$(dirname "$0")/../../.." || exit 1
LOGS="$HOME/.klui/parity/logs"
mkdir -p "$LOGS"
( cd worker; set -a; . ../clients/devtools/local-backend/parity.env; set +a; DOCUMENT_QUEUE=local exec "$HOME/.klui/parity/docworker-venv/bin/python" -u worker.py ) > "$LOGS/docworker.log" 2>&1 &
WORKER=$!
trap 'kill $WORKER 2>/dev/null' EXIT
sleep 5
cd clients
npm run -s typecheck || exit 1
npx vitest run 2>&1 | grep -E "Tests "
for p in run chat-probe behave-probe send-probe voice-probe settings-probe modes-probe paywall-probe surfaces-probe study-probe admin-probe turns-probe composer-probe free-probe; do
  node devtools/parity/$p.mjs > "$LOGS/$p.out" 2>&1; code=$?
  echo "$p exit=$code match=$(grep -c '^match' "$LOGS/$p.out") same=$(grep -c '^same' "$LOGS/$p.out") bad=$(grep -cE '^(DIFFERS|MISMATCH|diff)' "$LOGS/$p.out")"
done
