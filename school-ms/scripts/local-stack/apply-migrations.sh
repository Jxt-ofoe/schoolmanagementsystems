#!/usr/bin/env bash
# LOCAL ONLY: apply supabase/migrations/*.sql to the local PostgreSQL in order.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PGURL="${LOCAL_DB_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
psql "$PGURL" -v ON_ERROR_STOP=1 -q -c "create table if not exists public._local_migrations(name text primary key, applied_at timestamptz default now())"
for f in "$DIR"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if [ "$(psql "$PGURL" -tAc "select 1 from public._local_migrations where name='$name'")" = "1" ]; then continue; fi
  echo "applying $name"
  PGOPTIONS="-c client_min_messages=warning" psql "$PGURL" -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql "$PGURL" -q -c "insert into public._local_migrations(name) values ('$name')"
done
psql "$PGURL" -q -c "revoke all on public._local_migrations from anon, authenticated"
