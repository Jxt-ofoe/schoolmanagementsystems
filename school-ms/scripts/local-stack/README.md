# Local stack (development only)

A Supabase-compatible environment that runs **without Docker**. It's used to develop and test the app end to end when Docker / `supabase start` isn't available.

| Service | Port | Equivalent in Supabase |
|---|---|---|
| PostgreSQL 15+ | 5432 | Database |
| GoTrue (`supabase/auth`) | 9999 | Auth |
| PostgREST | 3000 | REST API |
| Deno server for `supabase/functions/*` | 8000 | Edge Functions |
| Mail catcher (SMTP 2500, web 8025) | 2500 / 8025 | Inbucket / Mailpit |
| App (vite preview of the production build) | 5173 | Vercel |

The app proxies `/auth/v1`, `/rest/v1`, `/functions/v1` and `/_dev/mail` to these services, so the browser talks only to one origin (`VITE_SUPABASE_URL=same-origin`).

## Scripts
| Script | Purpose |
|---|---|
| `setup.sh` | Install everything (apt Postgres, GoTrue, PostgREST, Deno, aiosmtpd), create Supabase roles, run auth and app migrations. Idempotent. |
| `start.sh` | Start all services and serve the built app on :5173. `SKIP_BUILD=1` reuses `dist/`. `PUBLIC_URL` sets the URL used in emails. Logs go to `.local-stack/logs/`. |
| `seed-demo.mjs` | Demo data: 2 schools, 5 users, 50+ students, 2 weeks of attendance, grades, billing and a payment. **Refuses non-localhost.** Random passwords go to `.local-stack/demo-credentials.txt` (git-ignored). |
| `reset-db.sh` | Drop **all** local app data and auth users, then re-apply migrations. Restart `start.sh` afterwards so PostgREST reloads its schema. |
| `apply-migrations.sh` | Apply new files from `supabase/migrations/`. |
| `bootstrap-roles.sql` | Creates `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin` (already present on hosted Supabase; **don't run it there**). |
| `keys.mjs` | Prints local anon and service JWTs signed with the local secret. These are not real project keys. |

The passwords in these scripts (`postgres`, `local-authenticator-pw`, …) are for a throwaway local database only.

## Typical session
```bash
npm run local:setup             # once per machine
npm run local:start             # leave running
npm run local:seed              # once (re-run after local:reset)
npm run test:db && npm run test:integration && npm run test:e2e
```
