# School Management System (multi-school SaaS)

React + Vite frontend, Supabase backend (Postgres + Row Level Security + Auth + Edge Functions), hosted on Vercel.
Each school pays **GH₵2 per registered student per semester**. The price is configurable by the Platform Super Admin; see [docs/BILLING_POLICY.md](docs/BILLING_POLICY.md).

## Roles
| Role | Can do | Cannot do |
|---|---|---|
| **Platform Super Admin** | Create, activate and suspend schools; invite headmasters; set the price, due days and void grace period; generate billing; record and void verified payments; platform-wide summaries; full audit log | Read individual student, attendance or grade records (it receives aggregates only) |
| **Headmaster** (one school) | Everything inside their school: classes, subjects, students (add, edit, transfer, status), academic calendar and semester registration, teacher invitations and assignments, attendance and grade oversight and correction, reports, billing view, school audit log | See or change other schools; change their own role or school status; record payments |
| **Teacher** | Their assigned classes only: roster, attendance register; grades for their assigned subjects | Unassigned classes or subjects, billing, audit, other teachers' subjects |

Access is enforced **in the database** with RLS policies, security-definer helper functions and triggers. Hiding things in the UI is only a convenience. Changing IDs in a URL or API call returns no rows or an error; the integration tests check this.

## Features
- **Students:** directory grouped by class cards (configurable names and sections), whole-school search by name or admission number, filters (class, status, gender), pagination, CSV export, "not placed" bucket.
  - Profile covers details and guardian, attendance summary, results per semester, class-transfer history (with reason) and semester registration history.
  - Duplicates are prevented: admission number is unique per school, and name + date of birth is unique.
- **Teachers:** invitation by email (Edge Function `invite-user`; passwords are never seen by admins), class-teacher and subject assignments, enable/disable access.
- **Attendance:** one register per class per date, statuses Present/Absent/Late/Excused, notes, draft → submit, "mark remaining present" for fast mobile marking.
  - Headmaster sees which classes haven't submitted today, plus a report with date range, class and teacher filters, rates and CSV.
  - Corrections are audited.
- **Grades:** assessments (name, category, max mark, weight ≤ 100% total) per class, subject and semester; score grid with validation; totals, percentages and grade bands (configurable per school).
  - Who entered each score and when is stored. Headmaster corrections are audited.
- **Dashboards** per role, computed in SQL from live data. Printable/CSV reports: class results ranking and enrolment summary.
- **Billing:** unique registrations × price snapshot, due/paid/balance, payment and renewal status, payments with duplicate-reference protection, void with reason, audit trail.
- **Audit log:** actor, role, action, entity, school, time and changed fields (sensitive fields excluded). Role-restricted visibility.
- **Auth:** sign-in/out, persistent sessions, forgot/reset password, change password (re-authenticates), invitation flow, safe `?next=` redirects. Public sign-up is disabled.
- **UX:** responsive layout (sidebar on desktop, drawer on mobile); loading, empty, error and success states; confirmation dialogs for destructive actions; print styles.

## Project layout
```
src/
  lib/          supabase client, auth context, queries, validation (zod), grade & billing maths, csv, formatting
  components/   UI primitives, layout, route guards, student form
  pages/admin   platform dashboard, schools, school detail, billing, settings
  pages/school  headmaster pages (students, classes, subjects, teachers, academic, attendance, grades, reports, billing, settings)
  pages/teacher teacher dashboard and class view
  pages/shared  take attendance, grade entry, audit log
supabase/
  migrations/   4 SQL migrations: schema, functions & triggers, RLS policies, RPCs & views
  functions/    invite-user Edge Function (+ shared CORS helper)
tests/db/           SQL-level RLS & business-rule tests (transaction rolled back per test)
tests/integration/  HTTP tests against a running stack (Auth, PostgREST, Edge Function, emails)
e2e/                Playwright browser tests (desktop + mobile)
scripts/local-stack/ Docker-free local Supabase-compatible stack, demo seed (local only)
docs/               BILLING_POLICY.md, DEPLOYMENT.md
```

## Environment variables
| Name | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel / `.env.local` | Public |
| `VITE_SUPABASE_ANON_KEY` | Vercel / `.env.local` | Public; RLS protects the data |
| `SITE_URL` | Supabase function secret | Your app URL; used for invitation links |
| `ALLOWED_ORIGINS` | Supabase function secret | Comma-separated origins allowed to call the function |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by Supabase into functions | **Never** in Vercel, the browser, the repo or chat |
| `TEST_DB_URL` | your shell (optional) | Direct Postgres URL of a **development** DB for `npm run test:db` |

Copy `.env.example` to `.env.local` and fill in the two `VITE_` values.

## Getting started
**Against your Supabase project:** follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) steps 1–4, then:
```bash
npm ci
cp .env.example .env.local      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

**Fully local, no Supabase account (Debian/Ubuntu, no Docker):**
```bash
npm run local:setup     # installs Postgres, GoTrue, PostgREST, Deno, mail catcher; applies migrations
npm run local:start     # builds the app and serves it with the stack on :5173 (keep running)
npm run local:seed      # demo schools/users; random passwords in .local-stack/demo-credentials.txt
```
Local emails (invites, password resets) appear at `http://localhost:5173/_dev/mail`. Details are in [scripts/local-stack/README.md](scripts/local-stack/README.md).

## Tests
| Command | What | Needs |
|---|---|---|
| `npm test` | Unit: grade maths, billing maths, validation, CSV and format helpers, route guards, login redirect safety | nothing |
| `npm run test:db` | RLS and business rules in SQL: cross-school, teacher scope, ID tampering, duplicates, score ranges, billing counts, audit, reports | local Postgres with migrations (or `TEST_DB_URL` of a dev DB) |
| `npm run test:integration` | Real HTTP: login, disabled sign-up, password reset email round-trip, RLS via PostgREST, invite Edge Function permissions and email | `npm run local:start` |
| `npm run test:e2e` | Playwright, desktop + mobile (Pixel 7): protected routes, login errors, class cards, search, roster, profile, attendance marking, role blocking, admin billing, no horizontal overflow | stack + `npm run local:seed` |
| `npm run build` | type-check + production build | nothing |

How the spec's required checks map to tests:

| Requirement | Covered in |
|---|---|
| 1 Teacher cannot access unassigned classes | db `access-control`, integration `teacher isolation` |
| 2 Headmaster cannot access other schools | db, integration `cross-school isolation`, e2e |
| 3 ID tampering blocked | db, integration (update/insert/transfer with foreign IDs) |
| 4 Duplicate attendance blocked | db `business-rules`, integration |
| 5 Invalid grades rejected | unit `grades`, db, integration |
| 6 Billing = unique count × configured price | unit `billing`, db, integration |
| 7 RLS works | all db suites + integration |
| 8 Audit records created | db, integration |
| 9 Class browsing and search | integration, e2e |
| 10 Login, reset, protected routes | unit `guards`, integration `auth`, e2e |
| 11 Mobile and desktop | e2e runs every test on both viewports |

## Security notes
- Browser uses only the anon key. Privileged operations (creating auth users) live in the Edge Function, which checks the caller's role server-side.
- All tables have RLS. Helper functions live in a non-exposed `private` schema with `search_path=''`.
- Billing, payments and audit tables accept no direct writes; changes go through checked RPCs.
- CSV exports neutralise spreadsheet formulas. The login redirect accepts only same-site paths.
- No seed data, demo users or default passwords exist in migrations. The demo seed refuses to run against non-localhost.

## Known limitations

- No online payment provider integration (payments are recorded manually after verification).
- No SMS/email notifications to guardians; no student/parent logins (by design: three roles only).
- No bulk CSV import of students yet (add one at a time; CSV *export* exists).
- Timetables, fees other than the platform subscription, and report-card PDF generation are not included (printing uses the browser's print-to-PDF).
- Teachers are invited per school. One person can belong to several schools, and a school switcher appears.
