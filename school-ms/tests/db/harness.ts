/**
 * Database test harness.
 *
 * Every test runs inside a transaction that is ROLLED BACK at the end, so the
 * suite leaves no data behind. Users are impersonated exactly the way Supabase
 * PostgREST does it: `SET LOCAL ROLE authenticated` + `request.jwt.claims`.
 *
 * TEST_DB_URL defaults to the local stack. You may point it at a Supabase
 * *development* project's direct connection string — never production.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const DB_URL = process.env.TEST_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export class PgError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export class Db {
  private sp = 0;
  constructor(public client: pg.Client) {}

  /** Run SQL as the superuser/migration owner (fixtures only). */
  async admin<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query<T>(sql, params);
    return res.rows;
  }

  /** Run SQL as an authenticated user (uid) or anonymous (null) with RLS applied. */
  async as<T extends pg.QueryResultRow = any>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    const name = `sp_${++this.sp}`;
    await this.client.query(`savepoint ${name}`);
    try {
      if (uid) {
        await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' }),
        ]);
        await this.client.query('set local role authenticated');
      } else {
        await this.client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
        await this.client.query('set local role anon');
      }
      const res = await this.client.query<T>(sql, params);
      await this.client.query('reset role');
      await this.client.query(`select set_config('request.jwt.claims', '', true)`);
      await this.client.query(`release savepoint ${name}`);
      return res.rows;
    } catch (e: any) {
      await this.client.query(`rollback to savepoint ${name}`);
      throw new PgError(e.message, e.code);
    }
  }

  /** Expect a statement to fail; returns the error. */
  async fails(uid: string | null, sql: string, params: unknown[] = []): Promise<PgError> {
    try {
      await this.as(uid, sql, params);
    } catch (e) {
      return e as PgError;
    }
    throw new Error(`Expected failure but statement succeeded: ${sql}`);
  }
}

export async function withTx(fn: (db: Db) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  await client.query('begin');
  try {
    await fn(new Db(client));
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

export interface World {
  superAdmin: string;
  hmA: string;
  hmB: string;
  teacherA1: string; // class teacher of A1 + Mathematics in A1
  teacherA2: string; // English in A2 only
  teacherB1: string;
  schoolA: string;
  schoolB: string;
  classA1: string;
  classA2: string;
  classB1: string;
  mathA: string;
  englishA: string;
  mathB: string;
  semA: string;
  semB: string;
  studentsA1: string[];
  studentsA2: string[];
  studentsB1: string[];
}

async function createUser(db: Db, label: string): Promise<string> {
  const id = randomUUID();
  await db.admin(
    `insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data, email_confirmed_at)
     values ($1, $2, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', $3, now())`,
    [id, `${label}.${id.slice(0, 8)}@test.local`, JSON.stringify({ full_name: label })],
  );
  return id;
}

/** Two schools, each with classes, subjects, teachers and students. */
export async function buildWorld(db: Db): Promise<World> {
  const superAdmin = await createUser(db, 'Super Admin');
  await db.admin('insert into public.platform_admins (user_id) values ($1)', [superAdmin]);
  const hmA = await createUser(db, 'Headmaster A');
  const hmB = await createUser(db, 'Headmaster B');
  const teacherA1 = await createUser(db, 'Teacher A1');
  const teacherA2 = await createUser(db, 'Teacher A2');
  const teacherB1 = await createUser(db, 'Teacher B1');

  const suffix = randomUUID().slice(0, 6);
  const [{ id: schoolA }] = await db.admin(
    `insert into public.schools (name, code) values ('Accra Test Academy', $1) returning id`, [`accra-${suffix}`]);
  const [{ id: schoolB }] = await db.admin(
    `insert into public.schools (name, code) values ('Kumasi Test School', $1) returning id`, [`kumasi-${suffix}`]);

  await db.admin(
    `insert into public.school_memberships (school_id, user_id, role) values
     ($1, $2, 'headmaster'), ($1, $3, 'teacher'), ($1, $4, 'teacher'),
     ($5, $6, 'headmaster'), ($5, $7, 'teacher')`,
    [schoolA, hmA, teacherA1, teacherA2, schoolB, hmB, teacherB1],
  );

  const cls = async (school: string, name: string, order: number) =>
    (await db.admin(`insert into public.classes (school_id, name, level_order) values ($1, $2, $3) returning id`, [school, name, order]))[0].id as string;
  const classA1 = await cls(schoolA, 'Class 1', 1);
  const classA2 = await cls(schoolA, 'Class 2', 2);
  const classB1 = await cls(schoolB, 'Class 1', 1);

  const subj = async (school: string, name: string) =>
    (await db.admin(`insert into public.subjects (school_id, name) values ($1, $2) returning id`, [school, name]))[0].id as string;
  const mathA = await subj(schoolA, 'Mathematics');
  const englishA = await subj(schoolA, 'English Language');
  const mathB = await subj(schoolB, 'Mathematics');

  await db.admin(
    `insert into public.teacher_assignments (school_id, teacher_id, class_id, subject_id) values
      ($1, $2, $3, null), ($1, $2, $3, $4), ($1, $5, $6, $7), ($8, $9, $10, $11)`,
    [schoolA, teacherA1, classA1, mathA, teacherA2, classA2, englishA, schoolB, teacherB1, classB1, mathB],
  );

  const sem = async (school: string) => {
    const [{ id: year }] = await db.admin(
      `insert into public.academic_years (school_id, name, starts_on, ends_on, is_current)
       values ($1, '2026/2027', '2026-09-01', '2027-07-31', true) returning id`, [school]);
    const [{ id }] = await db.admin(
      `insert into public.semesters (school_id, academic_year_id, name, starts_on, ends_on, registration_deadline, is_current)
       values ($1, $2, 'Semester 1', '2026-09-01', '2027-01-31', '2026-12-31', true) returning id`, [school, year]);
    return id as string;
  };
  const semA = await sem(schoolA);
  const semB = await sem(schoolB);

  const stu = async (school: string, cls: string, adm: string, first: string, last: string) =>
    (await db.admin(
      `insert into public.students (school_id, admission_number, first_name, last_name, current_class_id)
       values ($1, $2, $3, $4, $5) returning id`, [school, adm, first, last, cls]))[0].id as string;

  const studentsA1 = [
    await stu(schoolA, classA1, 'A001', 'Kwame', 'Mensah'),
    await stu(schoolA, classA1, 'A002', 'Ama', 'Owusu'),
    await stu(schoolA, classA1, 'A003', 'Yaw', 'Boateng'),
  ];
  const studentsA2 = [
    await stu(schoolA, classA2, 'A004', 'Akosua', 'Mensah'),
    await stu(schoolA, classA2, 'A005', 'Kofi', 'Asante'),
  ];
  const studentsB1 = [
    await stu(schoolB, classB1, 'B001', 'Esi', 'Mensah'),
    await stu(schoolB, classB1, 'B002', 'Kojo', 'Appiah'),
  ];

  return {
    superAdmin, hmA, hmB, teacherA1, teacherA2, teacherB1, schoolA, schoolB,
    classA1, classA2, classB1, mathA, englishA, mathB, semA, semB, studentsA1, studentsA2, studentsB1,
  };
}

/** Create an assessment as the superuser (fixture helper). */
export async function makeAssessment(db: Db, w: World, opts: {
  school: string; sem: string; cls: string; subject: string; name: string; max: number; weight: number;
}): Promise<string> {
  const [{ id }] = await db.admin(
    `insert into public.assessments (school_id, semester_id, class_id, subject_id, name, max_score, weight)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [opts.school, opts.sem, opts.cls, opts.subject, opts.name, opts.max, opts.weight]);
  return id;
}

export const today = () => new Date().toISOString().slice(0, 10);
