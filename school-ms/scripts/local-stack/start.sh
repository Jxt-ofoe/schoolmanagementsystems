#!/usr/bin/env bash
# LOCAL ONLY: run a Supabase-compatible stack (Postgres + GoTrue + PostgREST + Edge Functions + mail catcher).
# Requires: postgresql, ~/.local/bin/{postgrest,deno}, /tmp/authx/auth (see scripts/local-stack/README.md)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${LOCAL_BIN:-$HOME/.local/bin}"
LOGS="$ROOT/.local-stack/logs"; mkdir -p "$LOGS"
export LOCAL_JWT_SECRET="${LOCAL_JWT_SECRET:-local-dev-jwt-secret-change-me-at-least-32-chars}"
eval "$(node "$ROOT/scripts/local-stack/keys.mjs")"
PUBLIC_URL="${PUBLIC_URL:-${E2B_SANDBOX_ID:+https://5173-$E2B_SANDBOX_ID.e2b.app}}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:5173}"
echo "public url: $PUBLIC_URL"

sudo service postgresql start >/dev/null 2>&1 || true
for i in $(seq 1 20); do pg_isready -h 127.0.0.1 -q && break; sleep 0.5; done

# --- GoTrue (Supabase Auth) ---
(
  export GOTRUE_DB_DRIVER=postgres
  export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:local-auth-admin-pw@127.0.0.1:5432/postgres?search_path=auth&sslmode=disable"
  export GOTRUE_DB_MIGRATIONS_PATH="${AUTH_MIGRATIONS:-/tmp/authx/migrations}"
  export GOTRUE_SITE_URL="$PUBLIC_URL" API_EXTERNAL_URL="$PUBLIC_URL"   # mail links = API_EXTERNAL_URL + MAILER_URLPATHS_* (/auth/v1/verify)
  export GOTRUE_URI_ALLOW_LIST="$PUBLIC_URL/**,http://localhost:5173/**"
  export GOTRUE_JWT_SECRET="$LOCAL_JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_API_HOST=127.0.0.1 PORT=9999
  export GOTRUE_DISABLE_SIGNUP=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false
  export GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=noreply@school.local GOTRUE_SMTP_SENDER_NAME="School MS (local)"
  export GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
  export GOTRUE_PASSWORD_MIN_LENGTH=8 GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn
  exec "${AUTH_BIN:-/tmp/authx/auth}" serve
) > "$LOGS/auth.log" 2>&1 &

# --- PostgREST ---
cat > "$ROOT/.local-stack/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:local-authenticator-pw@127.0.0.1:5432/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$LOCAL_JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
db-max-rows = 1000
CONF
"$BIN/postgrest" "$ROOT/.local-stack/postgrest.conf" > "$LOGS/postgrest.log" 2>&1 &

# --- mail catcher ---
python3 "$ROOT/scripts/local-stack/mail-catcher.py" > "$LOGS/mail.log" 2>&1 &

# --- Edge Functions ---
(
  export SUPABASE_URL="http://127.0.0.1:5173" SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"
  export SITE_URL="$PUBLIC_URL" ALLOWED_ORIGINS="*"
  exec "$BIN/deno" run --allow-net --allow-env --allow-read "$ROOT/scripts/local-stack/functions-server.ts"
) > "$LOGS/functions.log" 2>&1 &

# --- App (production build served by vite preview, proxying the services above) ---
cd "$ROOT"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  VITE_SUPABASE_URL=same-origin VITE_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY" VITE_LOCAL_STACK=true npx vite build > "$LOGS/build.log" 2>&1 || { echo "build failed"; tail -30 "$LOGS/build.log"; }
fi
npx vite preview --host 0.0.0.0 --port 5173 --strictPort > "$LOGS/app.log" 2>&1 &

sleep 3
echo "--- stack up ---"; for f in "$LOGS"/*.log; do echo "[$(basename "$f")] $(tail -2 "$f" | tr '\n' ' ')"; done
trap 'kill $(jobs -p) 2>/dev/null' EXIT INT TERM
wait
