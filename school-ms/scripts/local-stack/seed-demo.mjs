#!/usr/bin/env node
/**
 * LOCAL DEMO SEED — never run against a real Supabase project.
 *
 * Creates a super admin, two schools (so cross-school isolation can be tried in
 * the UI), headmasters, teachers, classes, subjects, students, registrations,
 * two weeks of attendance, assessments with scores, billing and a payment.
 *
 * Safety:
 *  - refuses unless BOTH the auth URL and database URL point at localhost;
 *  - refuses when NODE_ENV=production;
 *  - passwords are random per run (no default credentials in the codebase) and are
 *    written only to .local-stack/demo-credentials.txt (git-ignored).
 *
 * Usage:  node scripts/local-stack/seed-demo.mjs        (stack must be running)
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTH_URL = process.env.SEED_AUTH_URL ?? 'http://127.0.0.1:9999';
const DB_URL = process.env.SEED_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function assertLocal(label, url) {
  const host = new URL(url).hostname;
  if (!LOCAL.has(host)) {
    console.error(`Refusing to seed: ${label} host "${host}" is not localhost. This script is for the local stack only.`);
    process.exit(1);
  }
}
assertLocal('auth', AUTH_URL);
assertLocal('database', DB_URL);
if (process.env.NODE_ENV === 'production') { console.error('Refusing to seed with NODE_ENV=production.'); process.exit(1); }

// Local-only service key derived from the local JWT secret (see keys.mjs). Never a real project key.
const keys = Object.fromEntries(
  execFileSync('node', [join(ROOT, 'scripts/local-stack/keys.mjs')], { env: process.env, encoding: 'utf8' })
    .trim().split('\n').map((l) => l.replace(/^export /, '').split('=')).map(([k, ...v]) => [k, v.join('=').replace(/^"|"$/g, '')]),
);
const SERVICE = keys.LOCAL_SERVICE_ROLE_KEY;

const pw = () => `${randomBytes(9).toString('base64url')}7a`;
const creds = [];

async function createUser(email, fullName) {
  const password = pw();
  const res = await fetch(`${AUTH_URL}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`create ${email}: ${res.status} ${JSON.stringify(body)}`);
  creds.push({ email, password, who: fullName });
  return body.id;
}

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

/** Run statements as a given user, exactly like PostgREST (RLS + auth.uid()). */
async function as(uid, fn) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' })]);
    await db.query('set local role authenticated');
    const r = await fn();
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback'); throw e; }
}

const existing = await q(`select id from public.schools where code = 'demo-accra'`);
if (existing.length) {
  console.log('Demo data already present (school code demo-accra). Credentials are in .local-stack/demo-credentials.txt.');
  console.log('To start over: ./scripts/local-stack/reset-db.sh (drops ALL local data), restart the stack, then re-run this script.');
  await db.end();
  process.exit(0);
}

const tag = randomUUID().slice(0, 4);
console.log('Creating accounts…');
const superAdmin = await createUser(`admin.${tag}@demo.local`, 'Platform Admin');
const hmA = await createUser(`headmaster.${tag}@accra.demo.local`, 'Mrs. Abena Owusu');
const tA1 = await createUser(`k.mensah.${tag}@accra.demo.local`, 'Mr. Kwame Mensah');
const tA2 = await createUser(`e.addo.${tag}@accra.demo.local`, 'Ms. Efua Addo');
const hmB = await createUser(`headmaster.${tag}@kumasi.demo.local`, 'Mr. Yaw Asante');
await q('insert into public.platform_admins (user_id) values ($1)', [superAdmin]);

console.log('Creating schools…');
const [{ id: schoolA }] = await q(`insert into public.schools (name, code, region, email, phone, motto, status)
  values ('Accra Demo Basic School', 'demo-accra', 'Greater Accra', 'office@accra.demo.local', '030 200 0000', 'Knowledge is light', 'active') returning id`);
const [{ id: schoolB }] = await q(`insert into public.schools (name, code, region, status)
  values ('Kumasi Demo JHS', 'demo-kumasi', 'Ashanti', 'active') returning id`);
await q(`insert into public.school_memberships (school_id, user_id, role) values ($1,$2,'headmaster'),($1,$3,'teacher'),($1,$4,'teacher'),($5,$6,'headmaster')`,
  [schoolA, hmA, tA1, tA2, schoolB, hmB]);

// Academic calendar around "today"
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const semStart = addDays(today, -45), semEnd = addDays(today, 75), yearStart = addDays(today, -60), yearEnd = addDays(today, 260);

async function calendar(school) {
  const [{ id: year }] = await q(`insert into public.academic_years (school_id, name, starts_on, ends_on, is_current) values ($1, $2, $3, $4, true) returning id`,
    [school, `${yearStart.getFullYear()}/${yearEnd.getFullYear()}`, iso(yearStart), iso(yearEnd)]);
  const [{ id: sem }] = await q(`insert into public.semesters (school_id, academic_year_id, name, starts_on, ends_on, registration_deadline, is_current)
    values ($1, $2, 'Semester 1', $3, $4, $5, true) returning id`, [school, year, iso(semStart), iso(semEnd), iso(addDays(semStart, 30))]);
  return sem;
}
const semA = await calendar(schoolA);
const semB = await calendar(schoolB);

console.log('Creating classes, subjects and assignments…');
const mkClass = async (school, name, section, order, cap) =>
  (await q(`insert into public.classes (school_id, name, section, level_order, capacity) values ($1,$2,$3,$4,$5) returning id`, [school, name, section, order, cap]))[0].id;
const cA = {
  b6: await mkClass(schoolA, 'Basic 6', null, 6, 40),
  j1a: await mkClass(schoolA, 'JHS 1', 'A', 7, 35),
  j1b: await mkClass(schoolA, 'JHS 1', 'B', 7, 35),
  j2: await mkClass(schoolA, 'JHS 2', null, 8, 40),
};
const cB = { j1: await mkClass(schoolB, 'Form 1', 'Gold', 1, 45) };
const mkSubj = async (school, name, code) => (await q(`insert into public.subjects (school_id, name, code) values ($1,$2,$3) returning id`, [school, name, code]))[0].id;
const sMath = await mkSubj(schoolA, 'Mathematics', 'MATH');
const sEng = await mkSubj(schoolA, 'English Language', 'ENG');
const sSci = await mkSubj(schoolA, 'Integrated Science', 'SCI');
await mkSubj(schoolA, 'Social Studies', 'SOC');
await mkSubj(schoolB, 'Mathematics', 'MATH');
await q(`insert into public.teacher_assignments (school_id, teacher_id, class_id, subject_id) values
  ($1,$2,$3,null), ($1,$2,$3,$4), ($1,$2,$5,$4), ($1,$6,$5,null), ($1,$6,$5,$7), ($1,$6,$3,$7), ($1,$6,$8,$9)`,
  [schoolA, tA1, cA.j1a, sMath, cA.j1b, tA2, sEng, cA.j2, sSci]);

console.log('Creating students…');
const male = ['Kwame', 'Kofi', 'Yaw', 'Kojo', 'Kwabena', 'Kwaku', 'Fiifi', 'Kwesi', 'Selorm', 'Mawuli', 'Nii', 'Elikem'];
const female = ['Ama', 'Akosua', 'Abena', 'Efua', 'Adwoa', 'Esi', 'Afua', 'Yaa', 'Aba', 'Dzifa', 'Naa', 'Akua'];
const last = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Osei', 'Addo', 'Agyeman', 'Darko', 'Quaye', 'Tetteh', 'Ansah', 'Amoah', 'Bonsu', 'Frimpong', 'Lartey', 'Adjei', 'Nkansah'];
let n = 0;
const studentsBy = {};
async function addStudents(school, prefix, classId, count) {
  studentsBy[classId] = [];
  for (let i = 0; i < count; i++) {
    n++;
    const isMale = n % 2 === 1;
    const f = (isMale ? male : female)[(n * 7) % 12], l = last[(n * 5) % last.length];
    const dob = iso(addDays(today, -(365 * 12 + ((n * 37) % 900))));
    const [{ id }] = await q(`insert into public.students (school_id, admission_number, first_name, last_name, gender, date_of_birth, current_class_id,
        admission_date, guardian_name, guardian_relationship, guardian_phone)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Parent',$10) returning id`,
      [school, `${prefix}/${String(n).padStart(4, '0')}`, f, l, isMale ? 'male' : 'female', dob, classId, iso(semStart),
        `${['Mr.', 'Mrs.'][n % 2]} ${l}`, `024${String(1000000 + n * 7919).slice(0, 7)}`]);
    studentsBy[classId].push(id);
  }
}
await addStudents(schoolA, 'ADB', cA.b6, 12);
await addStudents(schoolA, 'ADB', cA.j1a, 14);
await addStudents(schoolA, 'ADB', cA.j1b, 13);
await addStudents(schoolA, 'ADB', cA.j2, 11);
await addStudents(schoolB, 'KDJ', cB.j1, 9);
// one unplaced student, one withdrawn
await q(`insert into public.students (school_id, admission_number, first_name, last_name, admission_date) values ($1,'ADB/NEW1','Kekeli','Agbeko',$2)`, [schoolA, iso(today)]);

console.log('Registering students for the semester (headmaster)…');
await as(hmA, () => q('select public.register_students_for_semester($1)', [semA]));
await as(hmB, () => q('select public.register_students_for_semester($1)', [semB]));
await as(hmA, () => q(`select public.set_student_status($1, 'withdrawn', 'Family relocated to Takoradi')`, [studentsBy[cA.b6][11]]));

console.log('Recording attendance (teachers)…');
const statuses = (k, i) => { const r = (k * 31 + i * 17) % 23; return r === 0 ? 'absent' : r === 1 ? 'late' : r === 2 ? 'excused' : r === 3 ? 'absent' : 'present'; };
const weekdays = [];
for (let d = 1; weekdays.length < 10; d++) { const x = addDays(today, -d); if (x.getDay() % 6 !== 0) weekdays.push(iso(x)); }
for (const [teacher, cls] of [[tA1, cA.j1a], [tA2, cA.j2]]) {
  for (const [k, date] of weekdays.entries()) {
    const recs = studentsBy[cls].map((sid, i) => ({ student_id: sid, status: statuses(k, i), note: statuses(k, i) === 'excused' ? 'Hospital visit' : null }));
    await as(teacher, () => q('select public.save_attendance($1,$2,$3::jsonb,true,null)', [cls, date, JSON.stringify(recs)]));
  }
}
// today: JHS 1 A as a draft, others not started
await as(tA1, () => q('select public.save_attendance($1,$2,$3::jsonb,false,null)',
  [cA.j1a, iso(today), JSON.stringify(studentsBy[cA.j1a].slice(0, 8).map((sid) => ({ student_id: sid, status: 'present' })))]));

console.log('Creating assessments and scores (teachers)…');
async function assess(teacher, cls, subj, name, category, max, weight, filled = 1) {
  const [{ id }] = await as(teacher, () => q(`insert into public.assessments (school_id, semester_id, class_id, subject_id, name, category, max_score, weight, assessment_date)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [schoolA, semA, cls, subj, name, category, max, weight, iso(addDays(today, -14))]));
  const ids = studentsBy[cls].slice(0, Math.round(studentsBy[cls].length * filled));
  const scores = ids.map((sid, i) => ({ student_id: sid, score: Math.round(((i * 13 + max * 0.55) % max) * 2) / 2 }));
  await as(teacher, () => q('select public.save_scores($1,$2::jsonb)', [id, JSON.stringify(scores)]));
}
await assess(tA1, cA.j1a, sMath, 'Class exercise 1', 'class_score', 20, 15);
await assess(tA1, cA.j1a, sMath, 'Mid-semester test', 'class_score', 50, 25);
await assess(tA1, cA.j1b, sMath, 'Class exercise 1', 'class_score', 20, 20, 0.6);
await assess(tA2, cA.j1a, sEng, 'Composition', 'class_score', 30, 30);

console.log('Billing (super admin)…');
await as(superAdmin, () => q('select public.refresh_current_billing()'));
const [{ id: billA }] = await q('select id from public.semester_billing where semester_id = $1', [semA]);
await as(superAdmin, () => q(`select public.record_payment($1, 50, 'mobile_money', $2, $3, 'Part payment, MoMo confirmation checked')`,
  [billA, `MOMO-${tag}-001`, iso(addDays(today, -3))]));

await db.end();

const out = join(ROOT, '.local-stack', 'demo-credentials.txt');
mkdirSync(dirname(out), { recursive: true });
const lines = ['LOCAL DEMO ACCOUNTS — local stack only, random passwords generated ' + new Date().toISOString(), '',
  ...creds.map((c) => `${c.who.padEnd(20)} ${c.email.padEnd(42)} ${c.password}`)];
writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
console.log('\nDone. Accounts:\n' + lines.slice(2).join('\n') + `\n\n(saved to ${out})`);
