/**
 * End-to-end API tests against the running LOCAL stack (scripts/local-stack/start.sh):
 * real Supabase Auth (GoTrue), PostgREST + RLS, the invite-user Edge Function and the
 * mail catcher. Every request goes through the app origin (vite preview proxy), exactly
 * like the browser.
 *
 * Creates its own uniquely-named schools/users; nothing depends on demo data.
 * Refuses to run against anything that is not localhost.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP = process.env.IT_APP_URL ?? 'http://127.0.0.1:5173';
const MAIL = process.env.IT_MAIL_URL ?? 'http://127.0.0.1:8025';
const DB_URL = process.env.IT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
for (const u of [APP, MAIL, DB_URL]) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) throw new Error(`Integration tests only run against localhost (got ${u})`);
}
const keys = Object.fromEntries(execFileSync('node', ['scripts/local-stack/keys.mjs'], { encoding: 'utf8' })
  .trim().split('\n').map((l) => { const [k, ...v] = l.split('='); return [k, v.join('=')]; }));
const ANON = keys.LOCAL_ANON_KEY as string;
const SERVICE = keys.LOCAL_SERVICE_ROLE_KEY as string; // local-only key, used solely to create fixture users

const tag = randomUUID().slice(0, 6);
const pw = () => `${randomBytes(9).toString('base64url')}9z`;
const db = new pg.Client({ connectionString: DB_URL });
// Node 20 has no global WebSocket; supabase-js realtime needs a transport even if unused.
const client = () => createClient(APP, ANON, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });

async function makeUser(label: string) {
  const email = `${label}.${tag}@it.local`;
  const password = pw();
  const res = await fetch(`${APP}/auth/v1/admin/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: label } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  return { id: body.id as string, email, password };
}
async function signIn(u: { email: string; password: string }) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw error;
  return c;
}
async function mailTo(email: string, subjectRe: RegExp, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const msgs = (await (await fetch(`${MAIL}/api/messages`)).json()) as { to: string[]; subject: string; links: string[] }[];
    const m = msgs.find((x) => x.to.some((t) => t.toLowerCase() === email.toLowerCase()) && subjectRe.test(x.subject));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no email for ${email}`);
}

let W: {
  hmA: Awaited<ReturnType<typeof makeUser>>; hmB: Awaited<ReturnType<typeof makeUser>>; tA: Awaited<ReturnType<typeof makeUser>>;
  schoolA: string; schoolB: string; classA1: string; classA2: string; classB1: string; mathA: string; semA: string;
  stuA1: string[]; stuA2: string[]; stuB1: string[];
};
let hmA: SupabaseClient, hmB: SupabaseClient, tA: SupabaseClient;

beforeAll(async () => {
  await db.connect();
  const [hmAu, hmBu, tAu] = [await makeUser('hm-a'), await makeUser('hm-b'), await makeUser('teacher-a')];
  const one = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0].id as string;
  const schoolA = await one(`insert into public.schools (name, code) values ($1, $2) returning id`, [`IT School A ${tag}`, `itest-a-${tag}`]);
  const schoolB = await one(`insert into public.schools (name, code) values ($1, $2) returning id`, [`IT School B ${tag}`, `itest-b-${tag}`]);
  await db.query(`insert into public.school_memberships (school_id, user_id, role) values ($1,$2,'headmaster'),($1,$3,'teacher'),($4,$5,'headmaster')`,
    [schoolA, hmAu.id, tAu.id, schoolB, hmBu.id]);
  const cls = (s: string, n: string) => one(`insert into public.classes (school_id, name, level_order) values ($1,$2,1) returning id`, [s, n]);
  const classA1 = await cls(schoolA, 'Primary 1'), classA2 = await cls(schoolA, 'Primary 2'), classB1 = await cls(schoolB, 'Primary 1');
  const mathA = await one(`insert into public.subjects (school_id, name) values ($1,'Mathematics') returning id`, [schoolA]);
  await db.query(`insert into public.teacher_assignments (school_id, teacher_id, class_id, subject_id) values ($1,$2,$3,null),($1,$2,$3,$4)`, [schoolA, tAu.id, classA1, mathA]);
  const sem = async (s: string) => {
    const y = await one(`insert into public.academic_years (school_id, name, starts_on, ends_on, is_current) values ($1,'2026/2027','2026-09-01','2027-07-31',true) returning id`, [s]);
    return one(`insert into public.semesters (school_id, academic_year_id, name, starts_on, ends_on, is_current) values ($1,$2,'Semester 1','2026-09-01','2027-01-31',true) returning id`, [s, y]);
  };
  const semA = await sem(schoolA); await sem(schoolB);
  const stu = (s: string, c: string, adm: string, f: string, l: string) =>
    one(`insert into public.students (school_id, admission_number, first_name, last_name, current_class_id) values ($1,$2,$3,$4,$5) returning id`, [s, adm, f, l, c]);
  const stuA1 = [await stu(schoolA, classA1, 'A-1', 'Kwame', 'Nkrumah'), await stu(schoolA, classA1, 'A-2', 'Yaa', 'Asantewaa'), await stu(schoolA, classA1, 'A-3', 'Kofi', 'Annan')];
  const stuA2 = [await stu(schoolA, classA2, 'A-4', 'Efua', 'Sutherland')];
  const stuB1 = [await stu(schoolB, classB1, 'B-1', 'Ama', 'Ataa')];
  W = { hmA: hmAu, hmB: hmBu, tA: tAu, schoolA, schoolB, classA1, classA2, classB1, mathA, semA, stuA1, stuA2, stuB1 };
  [hmA, hmB, tA] = [await signIn(hmAu), await signIn(hmBu), await signIn(tAu)];
});
afterAll(async () => { await db.end(); });

describe('auth', () => {
  it('rejects a wrong password and accepts the right one', async () => {
    const { error } = await client().auth.signInWithPassword({ email: W.hmA.email, password: 'wrong-password-1' });
    expect(error).toBeTruthy();
    const c = await signIn(W.hmA);
    const { data } = await c.auth.getUser();
    expect(data.user?.email).toBe(W.hmA.email);
  });
  it('public sign-up is disabled (accounts come only from invitations)', async () => {
    const { error } = await client().auth.signUp({ email: `walkin.${tag}@it.local`, password: pw() });
    expect(error).toBeTruthy();
  });
  it('anonymous requests cannot read school data', async () => {
    const { data, error } = await client().from('students').select('id').limit(5);
    expect(error ?? null).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
  it('password reset: email → link → new password works, old one does not', async () => {
    const u = await makeUser('reset');
    const c = client();
    const { error } = await c.auth.resetPasswordForEmail(u.email, { redirectTo: `${APP}/set-password` });
    expect(error).toBeNull();
    const mail = await mailTo(u.email, /reset/i);
    const link = mail.links.find((l) => l.includes('/auth/v1/verify'))!;
    expect(link).toBeTruthy();
    expect(link).not.toContain('/auth/v1/auth/v1');           // regression: correct API_EXTERNAL_URL
    const local = new URL(link); const via = new URL(local.pathname + local.search, APP);
    const res = await fetch(via, { redirect: 'manual' });
    expect([302, 303]).toContain(res.status);
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/set-password');
    const hash = new URLSearchParams(loc.split('#')[1]);
    expect(hash.get('type')).toBe('recovery');
    const rc = client();
    await rc.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
    const newPw = pw();
    expect((await rc.auth.updateUser({ password: newPw })).error).toBeNull();
    expect((await client().auth.signInWithPassword({ email: u.email, password: u.password })).error).toBeTruthy();
    expect((await client().auth.signInWithPassword({ email: u.email, password: newPw })).error).toBeNull();
  });
});

describe('teacher isolation', () => {
  it('teacher only sees assigned classes', async () => {
    const { data } = await tA.from('classes').select('id');
    expect(data!.map((r) => r.id)).toEqual([W.classA1]);
  });
  it('fetching an unassigned class or its students by ID returns nothing', async () => {
    expect((await tA.from('classes').select('id').eq('id', W.classA2)).data).toEqual([]);
    expect((await tA.from('students').select('id').eq('current_class_id', W.classA2)).data).toEqual([]);
    expect((await tA.from('students').select('id').eq('id', W.stuA2[0])).data).toEqual([]);
  });
  it('cannot take attendance for an unassigned class', async () => {
    const { error } = await tA.rpc('save_attendance', { p_class_id: W.classA2, p_date: '2026-10-01', p_records: [{ student_id: W.stuA2[0], status: 'present' }], p_submit: false });
    expect(error?.code).toBe('42501');
  });
  it('cannot read billing or audit logs', async () => {
    expect((await tA.from('semester_billing').select('id')).data ?? []).toEqual([]);
    expect((await tA.from('audit_logs').select('id')).data ?? []).toEqual([]);
  });
});

describe('cross-school isolation & ID tampering', () => {
  it('headmaster A cannot list school B students even when filtering by B id', async () => {
    expect((await hmA.from('students').select('id').eq('school_id', W.schoolB)).data).toEqual([]);
    expect((await hmA.from('students').select('id').eq('id', W.stuB1[0])).data).toEqual([]);
  });
  it('updates against school B rows affect nothing', async () => {
    const { data } = await hmA.from('students').update({ first_name: 'Hacked' }).eq('id', W.stuB1[0]).select('id');
    expect(data).toEqual([]);
    const row = (await db.query('select first_name from public.students where id = $1', [W.stuB1[0]])).rows[0];
    expect(row.first_name).toBe('Ama');
  });
  it('inserting a student into school B is rejected', async () => {
    const { error } = await hmA.from('students').insert({ school_id: W.schoolB, admission_number: `X-${tag}`, first_name: 'X', last_name: 'Y' });
    expect(error).toBeTruthy();
  });
  it('moving a school A student into a school B class is rejected', async () => {
    const { error } = await hmA.rpc('transfer_student', { p_student_id: W.stuA1[0], p_to_class_id: W.classB1, p_reason: 'tamper' });
    expect(error).toBeTruthy();
  });
  it('headmaster cannot grant themselves super admin or change school status', async () => {
    expect((await hmA.from('platform_admins').insert({ user_id: W.hmA.id })).error).toBeTruthy();
    const { data } = await hmA.from('schools').update({ status: 'active', code: 'pwned' }).eq('id', W.schoolA).select('id');
    expect(data ?? []).toEqual([]);
  });
  it('headmaster dashboard RPC refuses another school', async () => {
    const { error } = await hmA.rpc('headmaster_dashboard', { p_school_id: W.schoolB, p_date: '2026-10-01' });
    expect(error).toBeTruthy();
  });
});

describe('attendance, grades, billing, audit, search', () => {
  it('saving attendance twice for the same day keeps one record per student', async () => {
    const recs = W.stuA1.map((id) => ({ student_id: id, status: 'present' }));
    expect((await tA.rpc('save_attendance', { p_class_id: W.classA1, p_date: '2026-10-05', p_records: recs, p_submit: false })).error).toBeNull();
    recs[0].status = 'late';
    expect((await tA.rpc('save_attendance', { p_class_id: W.classA1, p_date: '2026-10-05', p_records: recs, p_submit: true })).error).toBeNull();
    const rows = (await db.query('select status from public.attendance_records where class_id = $1 and attendance_date = $2', [W.classA1, '2026-10-05'])).rows;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'late')).toHaveLength(1);
    const { error } = await tA.from('attendance_records').insert({ school_id: W.schoolA, student_id: W.stuA1[1], class_id: W.classA1, attendance_date: '2026-10-05', status: 'absent' });
    expect(error).toBeTruthy();
  });
  it('rejects scores above the maximum or negative, accepts valid ones', async () => {
    const { data: a, error: ae } = await tA.from('assessments').insert({ school_id: W.schoolA, semester_id: W.semA, class_id: W.classA1, subject_id: W.mathA, name: 'Quiz', max_score: 20, weight: 10 }).select('id').single();
    expect(ae).toBeNull();
    expect((await tA.rpc('save_scores', { p_assessment_id: a!.id, p_scores: [{ student_id: W.stuA1[0], score: 21 }] })).error).toBeTruthy();
    expect((await tA.rpc('save_scores', { p_assessment_id: a!.id, p_scores: [{ student_id: W.stuA1[0], score: -1 }] })).error).toBeTruthy();
    expect((await tA.rpc('save_scores', { p_assessment_id: a!.id, p_scores: [{ student_id: W.stuA1[0], score: 17.5 }] })).error).toBeNull();
    const row = (await db.query('select score, entered_by from public.scores where assessment_id = $1', [a!.id])).rows[0];
    expect(Number(row.score)).toBe(17.5);
    expect(row.entered_by).toBe(W.tA.id);
  });
  it('billing = unique registered students × configured price', async () => {
    expect((await hmA.rpc('register_students_for_semester', { p_semester_id: W.semA })).error).toBeNull();
    expect((await hmA.rpc('register_students_for_semester', { p_semester_id: W.semA })).error).toBeNull(); // idempotent
    const { data: count } = await hmA.rpc('billable_student_count', { p_semester_id: W.semA });
    expect(count).toBe(4);
    const price = Number((await db.query('select price_per_student from public.platform_settings')).rows[0].price_per_student);
    // only the super admin can create billing; do it as the migration owner via the same function body
    const due = (await db.query('select count(distinct student_id) * $2::numeric as due from public.student_enrollments where semester_id = $1 and status <> $3', [W.semA, price, 'voided'])).rows[0].due;
    expect(Number(due)).toBe(4 * price);
    expect((await hmA.rpc('upsert_semester_billing', { p_semester_id: W.semA })).error).toBeTruthy(); // headmaster cannot bill
    expect((await hmA.rpc('record_payment', { p_billing_id: randomUUID(), p_amount: 8, p_method: 'cash' })).error).toBeTruthy(); // nor record payments
  });
  it('actions create audit records visible to the headmaster, not to other schools', async () => {
    const { data } = await hmA.from('audit_logs').select('action, entity_type, actor_id, school_id').eq('school_id', W.schoolA);
    expect(data!.some((r) => r.entity_type === 'attendance' && r.actor_id === W.tA.id)).toBe(true);
    expect(data!.some((r) => r.entity_type === 'score')).toBe(true);
    expect((await hmB.from('audit_logs').select('id').eq('school_id', W.schoolA)).data).toEqual([]);
  });
  it('whole-school search finds students by name or admission number', async () => {
    const byName = await hmA.from('students').select('admission_number').ilike('search_text', '%asantewaa%');
    expect(byName.data!.map((r) => r.admission_number)).toEqual(['A-2']);
    const byAdm = await hmA.from('students').select('first_name').ilike('search_text', '%a-4%');
    expect(byAdm.data!.map((r) => r.first_name)).toEqual(['Efua']);
    expect((await hmB.from('students').select('id').ilike('search_text', '%asantewaa%')).data).toEqual([]);
  });
  it('class counts RPC returns per-class totals for the headmaster', async () => {
    const { data, error } = await hmA.rpc('class_student_counts', { p_school_id: W.schoolA });
    expect(error).toBeNull();
    const byClass = Object.fromEntries((data as { class_id: string; active: number }[]).map((r) => [r.class_id, r]));
    expect(byClass[W.classA1]).toBeTruthy();
  });
});

describe('invite-user Edge Function', () => {
  const invoke = (c: SupabaseClient, body: Record<string, unknown>) => c.functions.invoke('invite-user', { body });
  it('headmaster invites a teacher; invitation email is sent with a set-password link', async () => {
    const email = `new.teacher.${tag}@it.local`;
    const { data, error } = await invoke(hmA, { email, full_name: 'New Teacher', role: 'teacher', school_id: W.schoolA });
    expect(error).toBeNull();
    expect(data.outcome).toBe('invited');
    const mail = await mailTo(email, /invit/i);
    const link = mail.links.find((l) => l.includes('/auth/v1/verify'))!;
    expect(link).toContain('type=invite');
    expect(decodeURIComponent(link)).toContain('/set-password');
    const m = (await db.query('select role, status from public.school_memberships where school_id = $1 and user_id = $2', [W.schoolA, data.user_id])).rows[0];
    expect(m).toEqual({ role: 'teacher', status: 'active' });
  });
  it('a second invite for an existing member is a 409', async () => {
    const { error } = await invoke(hmA, { email: W.tA.email, full_name: 'Teacher A', role: 'teacher', school_id: W.schoolA });
    expect((error as { context?: Response })?.context?.status).toBe(409);
  });
  it('headmaster cannot invite into another school or create headmasters', async () => {
    const r1 = await invoke(hmA, { email: `x.${tag}@it.local`, full_name: 'X Person', role: 'teacher', school_id: W.schoolB });
    expect((r1.error as { context?: Response })?.context?.status).toBe(403);
    const r2 = await invoke(hmA, { email: `y.${tag}@it.local`, full_name: 'Y Person', role: 'headmaster', school_id: W.schoolA });
    expect((r2.error as { context?: Response })?.context?.status).toBe(403);
  });
  it('teachers and anonymous callers cannot invite', async () => {
    const r1 = await invoke(tA, { email: `z.${tag}@it.local`, full_name: 'Z Person', role: 'teacher', school_id: W.schoolA });
    expect([401, 403]).toContain((r1.error as { context?: Response })?.context?.status);
    const r2 = await invoke(client(), { email: `w.${tag}@it.local`, full_name: 'W Person', role: 'teacher', school_id: W.schoolA });
    expect((r2.error as { context?: Response })?.context?.status).toBe(401);
  });
});
