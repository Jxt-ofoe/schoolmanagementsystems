/**
 * Spec §15 tests 1, 2, 3 and 7: role separation, school separation,
 * ID tampering and RLS coverage.
 */
import { describe, it, expect } from 'vitest';
import { withTx, buildWorld, makeAssessment, today } from './harness';

describe('(1) teachers cannot access unassigned classes or subjects', () => {
  it('teacher sees only assigned classes, subjects and students', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const classes = await db.as(w.teacherA1, 'select id from public.classes');
      expect(classes.map((r) => r.id)).toEqual([w.classA1]);

      const subjects = await db.as(w.teacherA1, 'select id from public.subjects');
      expect(subjects.map((r) => r.id)).toEqual([w.mathA]);

      const students = await db.as(w.teacherA1, 'select id from public.students');
      expect(students.map((r) => r.id).sort()).toEqual([...w.studentsA1].sort());

      const a2 = await db.as(w.teacherA1, 'select id from public.students where current_class_id = $1', [w.classA2]);
      expect(a2).toHaveLength(0);
    });
  });

  it('teacher cannot take attendance for an unassigned class', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const err = await db.fails(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [
        w.classA2, today(), JSON.stringify([{ student_id: w.studentsA2[0], status: 'present' }]),
      ]);
      expect(err.code).toBe('42501');
      // direct table insert is also blocked by RLS
      const err2 = await db.fails(w.teacherA1,
        `insert into public.attendance_sessions (school_id, class_id, attendance_date) values ($1, $2, $3)`,
        [w.schoolA, w.classA2, today()]);
      expect(err2.message).toMatch(/row-level security/);
    });
  });

  it('teacher cannot enter grades for an unassigned subject, even in their own class', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      // English in class A1 is not assigned to teacherA1 (only Mathematics is)
      const engA1 = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.englishA, name: 'Test 1', max: 20, weight: 10 });
      const err = await db.fails(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [
        engA1, JSON.stringify([{ student_id: w.studentsA1[0], score: 10 }]),
      ]);
      expect(err.code).toBe('42501');
      const visible = await db.as(w.teacherA1, 'select id from public.assessments where id = $1', [engA1]);
      expect(visible).toHaveLength(0);
      // creating an assessment for the unassigned subject is blocked
      const err2 = await db.fails(w.teacherA1,
        `insert into public.assessments (school_id, semester_id, class_id, subject_id, name, max_score, weight)
         values ($1, $2, $3, $4, 'Sneaky', 10, 5)`, [w.schoolA, w.semA, w.classA1, w.englishA]);
      expect(err2.message).toMatch(/row-level security/);
    });
  });

  it('teacher CAN work in assigned class/subject', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [
        w.classA1, today(), JSON.stringify(w.studentsA1.map((id) => ({ student_id: id, status: 'present' }))),
      ]);
      const [{ id: aid }] = await db.as(w.teacherA1,
        `insert into public.assessments (school_id, semester_id, class_id, subject_id, name, max_score, weight)
         values ($1, $2, $3, $4, 'Class Test 1', 20, 30) returning id`, [w.schoolA, w.semA, w.classA1, w.mathA]);
      const [{ save_scores }] = await db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [
        aid, JSON.stringify([{ student_id: w.studentsA1[0], score: 15 }]),
      ]);
      expect(save_scores).toBe(1);
    });
  });

  it('a disabled teacher loses all access', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.as(w.hmA, `update public.school_memberships set status = 'disabled' where user_id = $1 and school_id = $2`, [w.teacherA1, w.schoolA]);
      expect(await db.as(w.teacherA1, 'select id from public.students')).toHaveLength(0);
      expect(await db.as(w.teacherA1, 'select id from public.classes')).toHaveLength(0);
    });
  });
});

describe('(2) headmasters cannot access other schools', () => {
  it('reads are scoped to own school', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const schools = await db.as(w.hmA, 'select id from public.schools');
      expect(schools.map((r) => r.id)).toEqual([w.schoolA]);
      for (const table of ['students', 'classes', 'subjects', 'semesters', 'teacher_assignments', 'school_memberships']) {
        const rows = await db.as(w.hmA, `select id from public.${table} where school_id = $1`, [w.schoolB]);
        expect(rows, table).toHaveLength(0);
      }
      const profiles = await db.as(w.hmA, 'select id from public.profiles where id = $1', [w.teacherB1]);
      expect(profiles).toHaveLength(0);
    });
  });

  it('writes into another school are rejected', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const e1 = await db.fails(w.hmA,
        `insert into public.students (school_id, admission_number, first_name, last_name) values ($1, 'X1', 'Evil', 'Insert')`, [w.schoolB]);
      expect(e1.message).toMatch(/row-level security/);
      const e2 = await db.fails(w.hmA, `insert into public.classes (school_id, name) values ($1, 'Hijack')`, [w.schoolB]);
      expect(e2.message).toMatch(/row-level security/);
      const updated = await db.as(w.hmA, `update public.students set first_name = 'Hacked' where school_id = $1 returning id`, [w.schoolB]);
      expect(updated).toHaveLength(0);
      const del = await db.as(w.hmA, `delete from public.classes where id = $1 returning id`, [w.classB1]);
      expect(del).toHaveLength(0);
      const e3 = await db.fails(w.hmA, 'select public.headmaster_dashboard($1)', [w.schoolB]);
      expect(e3.code).toBe('42501');
    });
  });
});

describe('(3) changing record IDs cannot bypass permissions', () => {
  it('cannot move a record to another school by changing school_id', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const err = await db.fails(w.hmA, 'update public.students set school_id = $1 where id = $2', [w.schoolB, w.studentsA1[0]]);
      expect(err.message).toMatch(/row-level security|cannot be moved/);
    });
  });

  it('composite foreign keys block cross-school references even inside own school_id', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      // own school_id, but class belongs to school B
      const e1 = await db.fails(w.hmA,
        `insert into public.students (school_id, admission_number, first_name, last_name, current_class_id)
         values ($1, 'Z9', 'Cross', 'Ref', $2)`, [w.schoolA, w.classB1]);
      expect(e1.code).toBe('23503');
      const e2 = await db.fails(w.hmA,
        `insert into public.teacher_assignments (school_id, teacher_id, class_id) values ($1, $2, $3)`,
        [w.schoolA, w.teacherB1, w.classA1]);
      // rejected by the membership validation trigger (23514) before the composite FK (23503)
      expect(['23503', '23514']).toContain(e2.code);
      const e3 = await db.fails(w.hmA,
        `insert into public.student_enrollments (school_id, student_id, semester_id, class_id) values ($1, $2, $3, $4)`,
        [w.schoolA, w.studentsB1[0], w.semA, w.classA1]);
      expect(e3.code).toBe('23503');
    });
  });

  it('RPCs re-check authorization on the target record', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const e1 = await db.fails(w.hmA, 'select public.transfer_student($1, $2, null)', [w.studentsA1[0], w.classB1]);
      expect(e1.message).toMatch(/not found in this school/);
      const e2 = await db.fails(w.hmA, 'select public.transfer_student($1, $2, null)', [w.studentsB1[0], w.classA1]);
      expect(e2.code).toBe('42501');
      const bAssess = await makeAssessment(db, w, { school: w.schoolB, sem: w.semB, cls: w.classB1, subject: w.mathB, name: 'B test', max: 10, weight: 10 });
      const e3 = await db.fails(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [bAssess, JSON.stringify([{ student_id: w.studentsB1[0], score: 5 }])]);
      expect(e3.code).toBe('42501');
      const e4 = await db.fails(w.teacherA1, 'select public.register_students_for_semester($1)', [w.semA]);
      expect(e4.code).toBe('42501');
      // fetching a specific foreign student by ID returns nothing
      expect(await db.as(w.teacherA1, 'select * from public.students where id = $1', [w.studentsA2[0]])).toHaveLength(0);
    });
  });

  it('teacher cannot record attendance for a student from another class inside their own session', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const err = await db.fails(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, false)', [
        w.classA1, today(), JSON.stringify([{ student_id: w.studentsA2[0], status: 'absent' }]),
      ]);
      expect(err.message).toMatch(/not in this class/);
    });
  });
});

describe('(7) RLS policies work', () => {
  it('RLS is enabled on every public table', async () => {
    await withTx(async (db) => {
      const rows = await db.admin(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname <> '_local_migrations'`);
      expect(rows).toEqual([]);
    });
  });

  it('anonymous users can read nothing', async () => {
    await withTx(async (db) => {
      await buildWorld(db);
      for (const table of ['students', 'schools', 'profiles', 'scores', 'payments', 'audit_logs', 'platform_settings']) {
        const err = await db.fails(null, `select * from public.${table} limit 1`);
        expect(err.code, table).toBe('42501');
      }
      const err = await db.fails(null, 'select public.my_context()');
      expect(err.code).toBe('42501');
    });
  });

  it('only the super admin can change school status; headmaster can edit profile', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const err = await db.fails(w.hmA, `update public.schools set status = 'active', code = 'new-code' where id = $1`, [w.schoolA]);
      expect(err.code).toBe('42501');
      const ok = await db.as(w.hmA, `update public.schools set motto = 'Knowledge is light' where id = $1 returning id`, [w.schoolA]);
      expect(ok).toHaveLength(1);
      const s = await db.as(w.superAdmin, `update public.schools set status = 'suspended' where id = $1 returning status`, [w.schoolB]);
      expect(s[0].status).toBe('suspended');
    });
  });

  it('suspending a school locks out its staff (except headmaster billing view)', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.as(w.superAdmin, `update public.schools set status = 'suspended' where id = $1`, [w.schoolA]);
      expect(await db.as(w.teacherA1, 'select id from public.students')).toHaveLength(0);
      expect(await db.as(w.hmA, 'select id from public.students')).toHaveLength(0);
      expect(await db.as(w.hmA, 'select id from public.schools')).toHaveLength(1);
    });
  });

  it('teachers cannot create students, classes or assignments, or invite staff', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const e1 = await db.fails(w.teacherA1,
        `insert into public.students (school_id, admission_number, first_name, last_name) values ($1, 'T1', 'A', 'B')`, [w.schoolA]);
      expect(e1.message).toMatch(/row-level security/);
      const e2 = await db.fails(w.teacherA1, `insert into public.classes (school_id, name) values ($1, 'X')`, [w.schoolA]);
      expect(e2.message).toMatch(/row-level security/);
      const e3 = await db.fails(w.teacherA1,
        `insert into public.teacher_assignments (school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)`,
        [w.schoolA, w.teacherA1, w.classA2, w.englishA]);
      expect(e3.message).toMatch(/row-level security/);
      const e4 = await db.fails(w.hmA,
        `insert into public.school_memberships (school_id, user_id, role) values ($1, $2, 'headmaster')`, [w.schoolA, w.teacherB1]);
      expect(e4.message).toMatch(/row-level security/);
      const e5 = await db.fails(w.hmA, `update public.school_memberships set role = 'headmaster' where user_id = $1`, [w.teacherA1]);
      expect(e5.code).toBe('42501');
    });
  });

  it('super admin manages the platform but cannot read student PII or grades', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      expect(await db.as(w.superAdmin, 'select id from public.students')).toHaveLength(0);
      expect(await db.as(w.superAdmin, 'select id from public.scores')).toHaveLength(0);
      const schools = await db.as(w.superAdmin, 'select id from public.schools where id in ($1, $2)', [w.schoolA, w.schoolB]);
      expect(schools).toHaveLength(2);
      const [{ platform_dashboard: d }] = await db.as(w.superAdmin, 'select public.platform_dashboard()');
      expect(d.students_active).toBeGreaterThanOrEqual(7);
      const err = await db.fails(w.hmA, 'select public.platform_dashboard()');
      expect(err.code).toBe('42501');
    });
  });

  it('billing, payments and audit logs are read-only via the API', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      for (const sql of [
        `insert into public.semester_billing (school_id, semester_id, price_per_student) values ('${w.schoolA}', '${w.semA}', 0)`,
        `insert into public.audit_logs (action, entity_type) values ('fake', 'fake')`,
        `delete from public.audit_logs`,
        `insert into public.platform_admins (user_id) values ('${w.hmA}')`,
      ]) {
        const err = await db.fails(w.hmA, sql);
        expect(err.code, sql).toBe('42501');
      }
      const err = await db.fails(w.superAdmin, `delete from public.audit_logs`);
      expect(err.code).toBe('42501');
    });
  });
});
