#!/usr/bin/env bash
# LOCAL ONLY: wipe application schema + auth users, then re-apply migrations.
set -euo pipefail
PGURL="${LOCAL_DB_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
case "$PGURL" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing to reset a non-local database"; exit 1;; esac
PGOPTIONS="-c client_min_messages=warning" psql "$PGURL" -v ON_ERROR_STOP=1 -q <<'SQL'
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_email_changed on auth.users;
drop schema if exists private cascade;
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
delete from auth.users;
SQL
"$(dirname "$0")/apply-migrations.sh"
