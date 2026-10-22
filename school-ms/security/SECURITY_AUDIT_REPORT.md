# Security Audit & Penetration Test — School Management System

| | |
|---|---|
| Date | 2026-10-22 |
| Target | Local staging stack (Postgres 17 + Supabase Auth v2.197 + PostgREST 16.5 + Deno Edge Functions + Vite build), synthetic data only |
| Code baseline | git `5b19a37` "Baseline before security audit" — **no app code, policy, schema or production data was changed** |
| Accounts | Generated per run: 1 super admin, 2 headmasters, 3 teachers, 1 no-membership user, across **2 synthetic schools** (+ seeded demo schools) |
| Method | Static review of all migrations/RLS/functions/frontend/Edge Function → 55 automated dynamic probes → real-browser XSS check → npm audit → OWASP ZAP 2.17 passive baseline |
| Not tested | Your hosted Supabase project and Vercel deployment (URL + anon key were never shared) — see §6 |

## 1. Executive summary

The core data layer is in good shape: every one of the **23 tables has RLS**, all **63 policies** are per-command with `WITH CHECK`, anonymous callers get nothing, and **every cross-school read/write/RPC probe was refused** (HM-A and Teacher-A1 against 19 kinds of School B records, 10 report RPCs, 7 mutating RPCs, composite-FK mixing). SQL injection probes found **no injectable input**. Stored XSS payloads render as inert text.

However, the audit **confirmed two High-severity application flaws in the invitation flow** that break the "no cross-school access" and "no role escalation" guarantees, plus two **Critical issues in the local staging environment** that is currently reachable on a public preview URL.

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 (staging environment only) | F-01, F-02 |
| High | 2 | F-03, F-04 |
| Medium | 4 | F-05 – F-08 |
| Low | 6 | F-09 – F-14 |
| Info | 7 | I-01 – I-07 |

Dynamic results (final run): **55 probes — 42 passed, 13 failed**. Every failure maps to a finding below. Raw evidence: `security/pentest/results.json`.

## 2. Findings

### F-01 — Staging: Auth admin API reachable with a forgeable service_role token
- **Severity:** Critical (local/staging environment only — not the app code, not hosted Supabase) · **Status:** Confirmed (PL-01)
- **Affected:** `scripts/local-stack/start.sh` default `LOCAL_JWT_SECRET`, `vite.config.ts` public proxy of `/auth/v1/*` (incl. `/auth/v1/admin/*`)
- **Evidence:** A JWT with `role: service_role` signed with the documented default local secret → `GET /auth/v1/admin/users?per_page=1` through the public preview URL returned **HTTP 200** (only the status was recorded; no user data stored).
- **Safe repro:** `node security/pentest/run.mjs` → probe PL-01.
- **Impact:** Anyone who reads the repo can create/delete users, set any password and (via PostgREST, same secret) bypass RLS on the staging stack while the preview URL is live.
- **Remediation:** generate a random per-install JWT secret in `setup.sh` (stored in git-ignored `.local-stack/`); refuse to start with the default; block `/auth/v1/admin` in the dev proxy; do not expose staging publicly without an access gate. Hosted Supabase uses its own secret, so production is unaffected **provided** you never reuse this value.

### F-02 — Staging: development mailbox (reset/invite links) is public
- **Severity:** Critical (staging only) · **Status:** Confirmed (PL-02)
- **Affected:** `vite.config.ts` proxy `/_dev/mail` → `mail-catcher.py`
- **Evidence:** `/_dev/mail` → 200 and `/_dev/mail/api/messages` → 200 without authentication. Probe AU-14 itself read a reset link this way.
- **Impact:** Unauthenticated takeover of any staging account: request `/auth/v1/recover` for the victim, then read the link from the public mailbox.
- **Remediation:** bind the mail UI to 127.0.0.1 only and remove it from the public proxy (or gate with a random token); only enable when `VITE_LOCAL_STACK=1` *and* not on a public host.

### F-03 — Invitation hijack: any user can claim someone else's invitation (role escalation + cross-school access)
- **Severity:** High · **Status:** Confirmed (IN-04)
- **Affected:** `profiles` UPDATE policy (mig 03 line 60: whole row incl. `email` is self-editable) + `supabase/functions/invite-user/index.ts` lines 32–33 & 82 (resolves the invitee by `profiles.email`)
- **Evidence:** A user **with no school membership** changed their own `profiles.email` to `pt-future-head.<tag>@pentest.local` (HTTP 200). The super admin then invited that address as **headmaster of School B**: the function answered `outcome: "added_existing"` with the *attacker's* user id, the attacker received an **active headmaster membership** and immediately read School B student rows. No email went to the real invitee. (Membership removed and email restored after the probe.)
- **Impact:** Any authenticated account (e.g. a teacher at another school) who can guess or learn an upcoming invitee's address becomes teacher or headmaster of that school, with full access to its students, grades and attendance. Also: setting your email to an *existing* user's address makes their future invites fail (2 matches) and lets you impersonate them in staff lists.
- **Remediation:** (1) column-level grant — `revoke update on profiles; grant update (full_name, phone) on profiles to authenticated` + trigger rejecting `email` changes except from the auth-sync trigger; (2) in `invite-user`, resolve users from `auth.users` by exact, case-normalised email (security-definer RPC callable only by service_role), never from `profiles`.

### F-04 — Invite lookup uses unescaped `ILIKE`: a headmaster can attach any user from any school and read their profile
- **Severity:** High · **Status:** Confirmed (IN-02)
- **Affected:** `invite-user/index.ts` line 33 `.ilike('email', email)`; `EMAIL_RE` allows `%` and `_`
- **Evidence:** Headmaster A invited the pattern `%hm-b.<tag>@pentest.local` → HTTP 200 `added_existing` with **Headmaster B's** user id; HM-B silently became a teacher at School A and HM-A could then read HM-B's profile (name, email, phone). (Cleaned up after.)
- **Impact:** Cross-school disclosure of staff identities/contact data, unconsented membership for victims, and an enumeration oracle (patterns that match one vs many accounts behave differently). Breaks the "headmasters only see their own school" rule.
- **Remediation:** exact equality lookup (see F-03 fix); reject `%`, `_`, `\` in invite emails; existing users should receive a pending invitation they must accept instead of being attached instantly.

### F-05 — Registration date is client-controlled: void-window bypass (billing evasion) and late-flag suppression
- **Severity:** Medium · **Status:** Confirmed (MA-01, MA-02); void-after-grace inferred from trigger code
- **Affected:** `private.validate_enrollment()` (mig 02 ~line 331): on INSERT `registered_at` is taken from the client and `is_late` is derived from it
- **Evidence:** HM inserted a registration with `registered_at = 2099-01-01` → stored as 2099 (HTTP 201). With the deadline set to yesterday, a registration with `registered_at = 2000-01-01` was stored with **`is_late = false`**.
- **Impact:** The 14-day void check is `now() > registered_at + 14 days`; a future date means it never expires, so a headmaster can void that student at any time and drop them from the bill (BL-03 confirmed voided rows are excluded from the count). Backdating hides late registrations.
- **Remediation:** in the INSERT branch force `new.registered_at := now()` and `new.registered_by := auth.uid()` unless `private.is_super_admin()` (for audited backfills).

### F-06 — Password can be changed without the current password
- **Severity:** Medium · **Status:** Confirmed (AU-09)
- **Affected:** Auth configuration (`PUT /auth/v1/user`), `src/pages/auth/Account.tsx`
- **Evidence:** `PUT /auth/v1/user {password}` with only an access token → HTTP 200.
- **Impact:** A stolen/left-open session (shared school computer) becomes a permanent account takeover.
- **Remediation:** enable *Secure password change* (`GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=true`; Dashboard → Auth → Providers → Email) and ask for the current password / reauth nonce in the UI.

### F-07 — Teacher can reopen a submitted register and rewrite who took it and when
- **Severity:** Medium · **Status:** Confirmed (MA-04)
- **Affected:** `attendance_sessions` UPDATE policy + `private.validate_attendance_session()` (only class/date are immutable)
- **Evidence:** After submitting via `save_attendance`, a direct `PATCH attendance_sessions` set `status → draft`, `taken_by → the headmaster's id`, `submitted_at → 2000-01-01` (HTTP 200, all three accepted).
- **Impact:** Undermines attendance accountability (reports show the wrong teacher and submission time; "submitted" no longer means final). The audit log still records the real actor.
- **Remediation:** trigger: `taken_by` set once from `auth.uid()`, `submitted_at` immutable once set, `submitted → draft` only by the headmaster (with reason); or revoke direct UPDATE and route everything through `save_attendance`.

### F-08 — Vulnerable production dependency: react-router-dom 6.x (open-redirect advisories)
- **Severity:** Medium (npm: High; exploitability reduced by the app's own `safeRedirect`) · **Status:** Confirmed (npm audit)
- **Affected:** `react-router-dom` / `react-router` / `@remix-run/router` < 6.30.2 / 1.23.3
- **Evidence:** `npm audit --omit=dev` → 3 high (advisories: external redirect via untrusted paths, backslash open redirect, protocol-relative redirect).
- **Remediation:** upgrade within v6 (non-breaking, `npm audit fix`), re-run unit + e2e.

### F-09 — Attribution fields can be forged (`created_by`, `registered_by`, `entered_by`)
- **Severity:** Low · **Status:** Confirmed (MA-03)
- **Evidence:** HM set `students.created_by`, `student_enrollments.registered_by`, `assessments.created_by` and `scores.entered_by` to another teacher's id; all accepted. Triggers use `coalesce(client value, auth.uid())` or never reset on UPDATE.
- **Impact:** Misleading "entered by" displays. The audit log actor (from `auth.uid()`) is **not** forgeable, so forensic truth is preserved.
- **Remediation:** always assign from `auth.uid()` on INSERT and keep `old.*` on UPDATE.

### F-10 — Invite response reveals whether an email already has an account; existing users are attached without consent
- **Severity:** Low · **Status:** Confirmed (IN-03)
- **Evidence:** existing account → `outcome: added_existing`; unknown → `outcome: invited`.
- **Remediation:** neutral response ("Invitation sent"); pending membership + acceptance email for existing users (same fix as F-04).

### F-11 — Access token keeps working after logout (up to 1 hour)
- **Severity:** Low (standard Supabase/JWT behaviour) · **Status:** Confirmed (AU-08); refresh token *is* revoked (AU-07 passed)
- **Remediation:** shorten JWT expiry to 15–30 min; membership/school status is re-checked on every request already (AU-11/AU-12 passed), which limits impact.

### F-12 — Edge Function CORS allows any origin
- **Severity:** Low · **Status:** Confirmed (IN-05, ZAP "Cross-Domain Misconfiguration")
- **Evidence:** `invite-user` returns `Access-Control-Allow-Origin: *`; `_shared/cors.ts` defaults to `*` and `start.sh` sets `*`. Bearer-token auth (no cookies) keeps this Low.
- **Remediation:** set `ALLOWED_ORIGINS` to the Vercel domain(s); make the code default deny instead of `*`.

### F-13 — Security headers missing on the staging server (production headers unverified)
- **Severity:** Low · **Status:** Confirmed on staging (PL-05, ZAP); production *unverified*
- **Evidence:** ZAP passive: CSP not set, anti-clickjacking missing, X-Content-Type-Options missing, PostgREST `Server` version header. `vercel.json` defines CSP/XFO/nosniff/HSTS/Referrer-Policy, but only Vercel applies them.
- **Remediation:** after deploying, verify with `curl -I`; optionally add the same headers to `vite preview` for staging.

### F-14 — Vulnerable dev-only tooling (vitest 2 / vite 5 / esbuild / tinypool)
- **Severity:** Low (not shipped to browsers; affects developers running dev/test servers) · **Status:** Confirmed (npm audit: 2 critical, 1 high, 3 moderate — all dev)
- **Remediation:** upgrade to vitest 4 / vite 6+ (semver-major; do in the fix branch with full test run).

### Informational / suspected (not exploitable as tested)
| ID | Item | Status |
|---|---|---|
| I-01 | Hosted Supabase grants ALL on *new* public tables to anon/authenticated by default; current tables are explicitly revoked, future migrations must revoke too | Static |
| I-02 | `billable_student_count` returns 0 for a non-existent semester before its auth check → reveals whether a semester id exists (UUIDs, negligible) | Static |
| I-03 | `private.class_label` executable by PUBLIC (pure formatting function; anon has no USAGE on `private`) | Static |
| I-04 | Super admin can grant themself a membership and then see student data — the "no student PII for super admin" rule is a soft control (audited) | Static |
| I-05 | A headmaster can re-enable a teacher whom the super admin disabled (policy scope) | Suspected, not probed |
| I-06 | Deleting a class cascades its attendance sessions/records and assignments (audited, headmaster only) | Static |
| I-07 | Test-suite isolation: `tests/db/business-rules.test.ts:124` reads the first `score.updated` audit row globally; it fails (1/37) when the DB contains other committed score updates (here: pentest runs). Passes on a fresh DB. Not an app vulnerability | Confirmed |

## 3. What passed (with evidence)
| Area | Probe(s) | Result |
|---|---|---|
| Anonymous access | AU-01, AU-02 | All 23 tables/views and RPCs refused |
| Forged / tampered / expired JWTs | AU-03 – AU-06 | Wrong secret, `alg:none`, payload tampering, expired → all 401 |
| Logout / refresh | AU-07 | Refresh token rejected after logout |
| Metadata role injection | AU-10 | `user_metadata.role=super_admin` → no effect (`platform_dashboard` 403) |
| Disabled member / suspended school | AU-11, AU-12 | Existing JWT loses data access immediately; HM keeps billing view only |
| Reset enumeration / redirect | AU-13, AU-14 | Identical responses; `redirect_to=https://evil.example` ignored (Location = site URL) |
| Public sign-up | AU-15 | Disabled (422) |
| Cross-school reads | XS-R-hm-a, XS-R-t-a1 | 0 rows for all 19 record types |
| Cross-school writes / FK mixing | XS-W-01, XS-W-02 | 0 rows updated; inserts refused (403/409/400); DB unchanged |
| Cross-school RPCs | XS-RPC-* (×3) | 10 read RPCs return no B data; 7 mutating RPCs refused |
| Teacher scope | TS-01, TS-02 | No access to unassigned class or other teacher's subject; English score unchanged |
| Role escalation | RE-01 – RE-08 | No self-assignment, role/membership change, super-admin creation, school status/code change, billing/payment/price change, hard deletes, HM-only/SA-only ops, or foreign profile edits |
| SQL injection | SQ-01 – SQ-03, BL-02 | 12 search payloads, 10 filter/order/embed payloads, RPC text params, login form, date params, score `"1 or 1=1"`: no 5xx, never more rows than RLS allows, no time delay, payloads stored literally, row counts unchanged |
| Business logic | BL-01 – BL-05 | No attendance duplication; out-of-range/negative/non-numeric scores and future attendance rejected; billing = non-voided registrations × price (withdrawn still billed); zero/negative payments rejected, void restores balance; transfers logged and old teacher loses access |
| XSS | PL-06 + `xss-browser.mjs` | Payloads in names, guardian, notes, teacher name, URL query rendered as text on 7 pages; no script executed (screenshot `pentest/xss-student-detail.png`) |
| Error leakage | PL-03 | No stack traces / SQL text (PostgREST codes and constraint names only) |
| OpenAPI exposure | PL-04 | Anon sees only `/` (no tables/functions) |
| Secrets in frontend | grep of `dist/` | service_role key, JWT secret, DB URL **not present**; no env/credential files tracked by git |
| Open redirect after login | static (`safeRedirect`) | Only same-site relative paths accepted |
| Static SQL scan | grep | Dynamic SQL only in migration-time DDL with `format('%I')`; client filters built via supabase-js; `ilike` input sanitised |

## 4. Checklist (requested scope)
| # | Check | Result |
|---|---|---|
| 1 | Inspection: schema, RLS, functions, Edge Function, frontend, config, deps | Done |
| 2 | SQL injection: search, admission no., class filters, attendance/grade forms, transfers/status, report dates, RPCs, login | **Passed** |
| 2 | SQLi in Edge Function | **Failed** (LIKE-pattern injection, F-04; not SQL execution) |
| 3 | RLS enabled on all tables; S/I/U/D policies with USING + WITH CHECK | **Passed** |
| 3 | Users cannot change own role/membership | **Passed** (RE-02/03) — but **failed** indirectly via invite hijack (F-03) |
| 3 | Security-definer functions cannot bypass access control | **Passed** (8 definers checked; billing RPCs refused for HM/teacher) |
| 3 | No service key / DB credentials in frontend | **Passed** |
| 3 | Storage protected | **N/A** — app uses no Storage buckets |
| 4 | Cross-school read/write/RPC isolation | **Passed** for REST/RPC; **Failed** via invite-user (F-03, F-04) |
| 5 | Teacher cannot reach HM/SA operations; no self-assignment | **Passed** |
| 5 | HM cannot manage other schools | **Passed** for data; **Failed** for staff attach (F-04) |
| 5 | No unauthorised super-admin creation / billing change | **Passed** |
| 6 | Login, sign-up disabled, reset (enumeration + redirect), expiry, forged tokens, disabled/suspended | **Passed** |
| 6 | Password change requires current password | **Failed** (F-06) |
| 6 | Logout invalidates session | **Partial** — refresh revoked, access JWT valid ≤1 h (F-11) |
| 6 | Invitations | **Failed** (F-03, F-04, F-10) |
| 6 | Protected frontend routes | Untested directly (backend enforcement verified instead — routes are cosmetic) |
| 7 | Stored/reflected XSS | **Passed** |
| 7 | IDOR / broken access control | **Passed** (REST/RPC) / **Failed** (invite flow) |
| 7 | Mass assignment | **Failed** (F-05, F-07, F-09) |
| 7 | Open redirect | **Passed** (app + Auth); dependency advisory F-08 |
| 7 | Uploads | **N/A** — no upload feature |
| 7 | Error leakage | **Passed** |
| 7 | Dependencies | **Failed** (F-08 prod, F-14 dev) |
| 7 | Security headers / CORS | **Failed on staging** (F-13, F-12); production untested |
| 7 | Attendance duplication / grade manipulation / billing math / transfers | **Passed** (BL-01 – BL-05) except registration-date tampering (F-05) |
| 8 | npm audit, automated suites, ZAP baseline | Done (see §5) |

## 5. Tools used and their limitations
| Tool | What it did | Limitations |
|---|---|---|
| Custom harness `security/pentest/run.mjs` (Node 20) | 55 probes via real HTTP against Auth/PostgREST/Edge Function, with DB-side verification; a preflight rejects probes that reference non-existent RPCs/tables, so "404" can't be mistaken for "denied" | Covers the cases written; not exhaustive fuzzing |
| Playwright 1.64 (Chromium) | Stored/reflected XSS rendering on 7 pages | HM views only; teacher views share the same components |
| `npm audit` | Dependency CVEs | Known advisories only; Deno Edge deps (`esm.sh` imports) not covered |
| OWASP ZAP 2.17 (daemon, **passive only**: spider + passive rules, no active scan) | Headers, CORS, info leaks | SPA: the spider found few pages (28 messages); no authenticated crawl; no active rules by design |
| psql / static grep | Policies, grants, function bodies, dynamic SQL, XSS sinks | Static review can miss runtime behaviour — high-risk items were confirmed dynamically |
| Project test suites | unit 49/49, integration 24/24, db 36/37 (I-07, test-isolation only), `tsc` 0 errors | e2e not re-run in this pass |

No password spraying, credential stuffing, DoS or destructive scans were performed. All data was synthetic; probes that changed state (suspend school, disable teacher, hijacked memberships, test students) were reverted or are synthetic `PT …` records.

## 6. Not verified / residual risk
- **Your hosted Supabase project and Vercel deployment** were not tested (URL + anon key not shared). Unverified there: Auth settings (sign-up off, secure password change, JWT expiry, redirect allow-list, SMTP), default privileges on new tables (I-01), deployed Edge Function secrets (`SITE_URL`, `ALLOWED_ORIGINS`), and the `vercel.json` headers.
- **Rate limiting / brute-force protection** — intentionally not tested (no password spraying).
- **MFA** — not implemented; not assessed.
- **Supabase dashboard access, backups, network/TLS** — out of reach from this environment.
- **Authenticated ZAP crawl and active scan** — not run (conservative scope).
- **Teacher-only UI pages** for XSS — covered indirectly (shared components).

## 7. Prioritised remediation plan (awaiting your approval — nothing has been changed)
| Priority | Fix | Findings | Regression test to add |
|---|---|---|---|
| **P0 — now** | Stop exposing the staging stack publicly, or: random per-install JWT secret, block `/auth/v1/admin` in the proxy, make `/_dev/mail` localhost-only | F-01, F-02 | PL-01, PL-02 must pass |
| **P1** | Lock `profiles.email` (column grants + guard trigger); `invite-user` resolves users by exact email from `auth.users` via a service-role-only RPC; reject `% _ \`; neutral response; existing users get a pending, accept-to-join membership | F-03, F-04, F-10 | IN-02, IN-03, IN-04 + db test "profile email immutable" |
| **P1** | Enrollment INSERT: force `registered_at = now()`, `registered_by = auth.uid()` (super-admin backfill exception) | F-05 | MA-01, MA-02 + db test |
| **P2** | Attendance session guard (taken_by fixed, submitted_at immutable, reopen = HM + reason) | F-07 | MA-04 |
| **P2** | Enable secure password change + current-password field in Account page | F-06 | AU-09 |
| **P2** | Upgrade `react-router-dom` to ≥ 6.30.2 | F-08 | unit + e2e |
| **P3** | Force attribution columns from `auth.uid()` | F-09 | MA-03 |
| **P3** | `ALLOWED_ORIGINS` default-deny; JWT expiry 15–30 min; dev-tool upgrades (vitest 4); scope test I-07; revoke default privileges on hosted project | F-11, F-12, F-14, I-01, I-07 | IN-05, AU-08 (config) |

Proposed workflow after approval: branch `security-fixes` → one migration `20261023000001_security_hardening.sql` (no data changes) + Edge Function/frontend patches → convert the failing probes into permanent tests → re-run the full harness, unit/db/integration/e2e suites, and diff results against this report. No RLS or check will be relaxed to make a test pass.

## 8. Re-running this audit
```bash
bash scripts/local-stack/start.sh            # local stack only
node security/pentest/run.mjs                # 55 probes → security/pentest/results.json
node security/pentest/xss-browser.mjs        # browser XSS → security/pentest/xss-results.json
npm audit --omit=dev
```
Artifacts: `security/pentest/results.json`, `security/pentest/xss-results.json`, `security/pentest/xss-student-detail.png`, `security/zap/zap-baseline-report.html`, `security/zap/alerts.json`. The harness refuses to run against non-localhost targets.
