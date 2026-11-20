# Deploying to Supabase + Vercel

> Nothing in this repository has been deployed. These are the steps for you to run with your own accounts.
> The **service-role key** is never put in Vercel, in a `VITE_` variable, in the repo or in chat. Supabase gives it to Edge Functions automatically.

## 0. Prerequisites
- A Supabase project. Create a separate **development** project for testing.
- A Vercel account linked to your Git repository.
- Supabase CLI ≥ 1.200 (`npm i -g supabase` or `brew install supabase/tap/supabase`).

## 1. Database
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push            # applies supabase/migrations/*.sql in order
```
The migrations create every table, constraint, index, RLS policy, trigger, RPC and view. They also insert the single `platform_settings` row (price GH₵2.00). They insert **no** users, schools or demo data.

Don't run `scripts/local-stack/bootstrap-roles.sql` against Supabase. Hosted projects already have those roles.

## 2. Auth settings (Dashboard → Authentication)
| Setting | Value |
|---|---|
| Site URL | `https://<your-app>.vercel.app` |
| Redirect URLs | `https://<your-app>.vercel.app/**` (add `http://localhost:5173/**` for local development against this project) |
| Email provider | enabled |
| **Allow new users to sign up** | **disabled**: accounts are created only by invitation |
| Confirm email | enabled |
| Minimum password length | 8 or more |
| SMTP | configure a real SMTP provider. Supabase's built-in mailer is heavily rate-limited and not meant for production |

Email templates: the defaults work. Invite and recovery links go to `/set-password`, which the app handles.

## 3. Edge Function
```bash
supabase secrets set SITE_URL=https://<your-app>.vercel.app
supabase secrets set ALLOWED_ORIGINS=https://<your-app>.vercel.app
supabase functions deploy invite-user
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. `invite-user` won't run without `SITE_URL`, because invitation links must never be built from request headers.

## 4. First Super Admin (one-time, manual)
There are no default credentials. To create the platform owner:
1. Dashboard → Authentication → Users → **Invite user** (your email). Accept the invite and set a password at `/set-password`.
2. SQL editor:
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
3. Sign in. You land on *Platform overview*. Create schools there and invite their headmasters; headmasters then invite their teachers.

## 5. Vercel
1. *New Project* → import the repository. Vercel detects Vite. `vercel.json` sets the build command, the SPA rewrites and the security headers.
2. **Environment variables** (Production, and Preview if wanted):
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the project's anon / publishable key |
   | `PAYSTACK_SECRET_KEY` | Paystack secret key (Production) |
   | `PAYMENT_SIMULATION` | `false` (Production); set `true` in local/preview environments to simulate payments without live keys |
3. Deploy. Then put the final URL into Supabase *Site URL*, *Redirect URLs*, `SITE_URL` and `ALLOWED_ORIGINS`.

`vercel.json` sends a Content-Security-Policy whose `connect-src` allows `https://*.supabase.co`. If you use a custom Supabase domain, add it there.

### Payment Simulation Mode (Finding M-6)
In non-production environments (local dev or staging/preview where `NODE_ENV !== 'production'`), payment simulation is available for testing recurring billing and checkout flows without active Paystack credentials.
- To enable simulation, set `PAYMENT_SIMULATION=true` in your `.env.local` or preview environment settings.
- When `PAYMENT_SIMULATION=true`, the API generates mock transaction URLs and records test verifications with explicit server-side warning logs.
- If `PAYSTACK_SECRET_KEY` is missing and `PAYMENT_SIMULATION` is not `'true'`, payment endpoints reject requests with an explicit configuration error.
- Simulation is strictly forbidden in production; any attempt to simulate payments when `NODE_ENV === 'production'` will throw a fatal error regardless of `PAYMENT_SIMULATION`.

## 6. Smoke test after deploying
- Visiting `/school` while signed out redirects to `/login?next=…`.
- Super Admin: create a school and invite a headmaster. The email arrives and its link opens `/set-password`.
- Headmaster: create a year and semester (make it current), classes, subjects and students; invite a teacher and assign them.
- Teacher: take attendance and enter grades. Opening another class's URL shows nothing.
- Super Admin: *Billing → Generate / refresh*, then record a test payment, then void it.

## 7. Running the DB tests against a dev project (optional)
The DB tests run inside transactions that are rolled back. To run them against a **development** project, use its direct connection string. **Never use production.**
```bash
TEST_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' npm run test:db
```

## 8. React Router v7 Upgrade Deferral Notice (Security Advisory Remediation M-2)
The upgrade from `react-router-dom` v6 to v7 is deferred to a future maintenance window due to breaking changes in data routers, framework route definitions, and splat route resolution.
- All dynamic redirect and navigation destinations across the client SPA are strictly sanitized using `safeRedirect(target)` (`src/pages/auth/Login.tsx`), ensuring target paths cannot lead to open redirects, schema-relative protocol escapes (`//`), backslashes, or control characters.
- Internal navigation routes (`/admin/schools/${id}`, `/school/students/${id}`) are strictly parameterized with validated UUIDs.

## Backups and operations
- Turn on Point-in-Time Recovery or daily backups (Supabase plan dependent).
- `audit_logs` grows over time. Archive old rows with a scheduled job if needed. There is no automatic deletion.
