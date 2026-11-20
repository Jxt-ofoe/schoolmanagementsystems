#!/usr/bin/env bash
# LOCAL ONLY: install a Supabase-compatible stack on a Debian/Ubuntu machine without Docker.
#   PostgreSQL + Supabase Auth (GoTrue) + PostgREST + Deno (Edge Functions) + a mail catcher.
# Idempotent: safe to re-run. Never point any of this at a real Supabase project.
#
# If you have Docker, `supabase start` (Supabase CLI) is the simpler alternative; see README.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${LOCAL_BIN:-$HOME/.local/bin}"
AUTH_DIR="${AUTH_DIR:-/tmp/authx}"
PGRST_VERSION="${PGRST_VERSION:-v16.5}"
AUTH_VERSION="${AUTH_VERSION:-v2.197.0}"
DENO_VERSION="${DENO_VERSION:-v2.9.8}"
PGURL="postgres://postgres:postgres@127.0.0.1:5432/postgres"
mkdir -p "$BIN" "$AUTH_DIR"
[ "$(uname -m)" = "x86_64" ] || { echo "This script downloads x86_64 binaries; adjust URLs for $(uname -m)."; exit 1; }

echo "== system packages"
if ! command -v psql >/dev/null || ! command -v unzip >/dev/null; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib curl unzip xz-utils python3-pip >/dev/null
fi
sudo service postgresql start >/dev/null 2>&1 || true
for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -q && break; sleep 0.5; done
# local superuser password used only by the local scripts and DB tests
sudo -u postgres psql -q -c "alter user postgres password 'postgres'" >/dev/null

echo "== python mail catcher dependency"
python3 -c "import aiosmtpd" 2>/dev/null || pip install -q aiosmtpd 2>/dev/null || pip install -q --break-system-packages aiosmtpd

echo "== PostgREST $PGRST_VERSION"
if ! "$BIN/postgrest" --version 2>/dev/null | grep -q "${PGRST_VERSION#v}"; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/postgrest-$PGRST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$BIN"
fi

echo "== Supabase Auth (GoTrue) $AUTH_VERSION"
if ! "$AUTH_DIR/auth" version 2>/dev/null | grep -q "$AUTH_VERSION"; then
  curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$AUTH_DIR"
fi

echo "== Deno $DENO_VERSION"
if ! "$BIN/deno" --version 2>/dev/null | grep -q "${DENO_VERSION#v}"; then
  tmp="$(mktemp -d)"; curl -fsSL -o "$tmp/deno.zip" "https://github.com/denoland/deno/releases/download/$DENO_VERSION/deno-x86_64-unknown-linux-gnu.zip"
  unzip -oq "$tmp/deno.zip" -d "$BIN"; rm -rf "$tmp"
fi

echo "== local jwt secret"
mkdir -p "$ROOT/.local-stack"
if [ ! -f "$ROOT/.local-stack/jwt-secret" ]; then
  openssl rand -hex 32 > "$ROOT/.local-stack/jwt-secret"
  chmod 600 "$ROOT/.local-stack/jwt-secret"
fi

echo "== database roles (anon/authenticated/service_role/authenticator/supabase_auth_admin)"
cat "$ROOT/scripts/local-stack/bootstrap-roles.sql" | psql "$PGURL" -v ON_ERROR_STOP=1 -q

echo "== auth schema migrations"
(
  export GOTRUE_DB_DRIVER=postgres
  export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:local-auth-admin-pw@127.0.0.1:5432/postgres?search_path=auth&sslmode=disable"
  export GOTRUE_DB_MIGRATIONS_PATH="$AUTH_DIR/migrations"
  export GOTRUE_SITE_URL=http://localhost:5173 API_EXTERNAL_URL=http://localhost:5173
  export GOTRUE_JWT_SECRET="local-migrate-only-secret-at-least-32-chars"
  "$AUTH_DIR/auth" migrate >/dev/null
)

echo "== application migrations"
"$ROOT/scripts/local-stack/apply-migrations.sh"

echo "== node dependencies"
(cd "$ROOT" && [ -d node_modules ] || npm ci)

cat <<EOF

Local stack installed.
  Start:     bash scripts/local-stack/start.sh          (app on http://localhost:5173)
  Demo data: node scripts/local-stack/seed-demo.mjs     (random passwords -> .local-stack/demo-credentials.txt)
  Mailbox:   http://localhost:5173/_dev/mail            (invitation / password reset emails)
EOF
