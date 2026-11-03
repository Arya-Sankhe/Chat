#!/bin/bash
# Starts every throwaway local service the parity probes need, skipping any that
# are already up. Nothing here reaches a real service. Local Supabase comes from
# `supabase start` in this folder; `up.sh --schema` also resets that local database's
# public schema to supabase/schema.sql, for after the schema changes. Logs: ~/.klui/parity/logs.
cd "$(dirname "$0")/../../.." || exit 1
ROOT=$PWD
LOGS="$HOME/.klui/parity/logs"
mkdir -p "$LOGS"
up() { curl -s -o /dev/null --max-time 2 "http://localhost:$1/"; }
wait_for() { for _ in $(seq 1 40); do up "$1" && return 0; sleep 1; done; echo "port $1 never came up"; return 1; }

if [ "$1" = "--schema" ]; then
  { cat <<'SQL'
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
SQL
    cat supabase/schema.sql; } | docker exec -i supabase_db_klui-parity psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q 2>&1 | grep -v '^NOTICE' 
  [ "${PIPESTATUS[1]}" = 0 ] || exit 1
fi

if ! up 55900; then
  docker start klui-parity-s3 >/dev/null 2>&1 || docker run -d --name klui-parity-s3 -p 55900:8333 chrislusf/seaweedfs server -s3 -dir=/data >/dev/null
  wait_for 55900 || exit 1
  curl -s -o /dev/null -X PUT http://localhost:55900/klui-parity
fi
up 55500 || (nohup node clients/devtools/local-backend/fake-openrouter.mjs > "$LOGS/openrouter.log" 2>&1 &)
up 55600 || (nohup node --env-file=clients/devtools/local-backend/parity.env server/index.js > "$LOGS/server.log" 2>&1 &)
# A second server in subscription mode, for the paywall: payments point at a dead address.
up 55601 || (ACCESS_MODE=subscription PORT=55601 APP_URL=http://localhost:55601 MAMO_API_KEY=local-dead MAMO_API_BASE=http://127.0.0.1:9 MAMO_COUPONS=FIRST50:50 \
  nohup node --env-file=clients/devtools/local-backend/parity.env server/index.js > "$LOGS/server-subscription.log" 2>&1 &)
cd clients
up 5181 || (nohup node devtools/parity/reference-server.mjs 5181 http://localhost:55600 > "$LOGS/reference.log" 2>&1 &)
up 5182 || (nohup node devtools/parity/reference-server.mjs 5182 http://localhost:55601 > "$LOGS/reference-subscription.log" 2>&1 &)
cd web
up 5180 || (KLUI_API_TARGET=http://localhost:55600 nohup npx vite > "$LOGS/web.log" 2>&1 &)
up 5183 || (KLUI_API_TARGET=http://localhost:55601 nohup npx vite --port 5183 > "$LOGS/web-subscription.log" 2>&1 &)
for port in 55600 55601 5180 5181 5182 5183; do wait_for "$port" || exit 1; done
echo "local services are up"
