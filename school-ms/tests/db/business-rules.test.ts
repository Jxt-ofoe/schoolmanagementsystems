/**
 * Spec §15 tests 4, 5, 6, 8 and 9: duplicate attendance, grade validation,
 * semester billing, audit logging, class browsing & whole-school search.
 */
import { describe, it, expect } from 'vitest';
import { withTx, buildWorld, makeAssessment, today } from './harness';

describe('(4) duplicate attendance is blocked', () => {
  it('unique constraint rejects a second record for the same student/class/date', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const [{ id: session }] = await db.as(w.teacherA1,
        `insert into public.attendance_sessions (school_id, class_id, attendance_date) values ($1, $2, $3) returning id`,
        [w.schoolA, w.classA1, today()]);
      const insert = `insert into public.attendance_records (school_id, session_id, student_id, class_id, attendance_date, status)
                      values ($1, $2, $3, $4, $5, $6)`;
      await db.as(w.teacherA1, insert, [w.schoolA, session, w.studentsA1[0], w.classA1, today(), 'present']);
      const err = await db.fails(w.teacherA1, insert, [w.schoolA, session, w.studentsA1[0], w.classA1, today(), 'absent']);
      expect(err.code).toBe('23505');
      // a second session for the same class/date is also rejected
      const err2 = await db.fails(w.teacherA1,
        `insert into public.attendance_sessions (school_id, class_id, attendance_date) values ($1, $2, $3)`,
        [w.schoolA, w.classA1, today()]);
      expect(err2.code).toBe('23505');
    });
  });

  it('saving the register twice updates rather than duplicates', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const recs = (status: string) => JSON.stringify(w.studentsA1.map((id) => ({ student_id: id, status })));
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, false)', [w.classA1, today(), recs('present')]);
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [w.classA1, today(), recs('late')]);
      const rows = await db.admin('select status from public.attendance_records where class_id = $1 and attendance_date = $2', [w.classA1, today()]);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['late']));
      const [s] = await db.admin('select status, submitted_at from public.attendance_sessions where class_id = $1', [w.classA1]);
      expect(s.status).toBe('submitted');
      expect(s.submitted_at).not.toBeNull();
    });
  });

  it('future dates and invalid statuses are rejected', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      const e1 = await db.fails(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, false)', [
        w.classA1, future, JSON.stringify([{ student_id: w.studentsA1[0], status: 'present' }])]);
      expect(e1.message).toMatch(/future/);
      const e2 = await db.fails(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, false)', [
        w.classA1, today(), JSON.stringify([{ student_id: w.studentsA1[0], status: 'sleeping' }])]);
      expect(e2.code).toBe('23514');
    });
  });
});

describe('(5) invalid grades are rejected', () => {
  it('scores outside 0..max are rejected; valid scores accepted', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const a = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Quiz', max: 20, weight: 30 });
      const save = (score: number) => db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [a, JSON.stringify([{ student_id: w.studentsA1[0], score }])]);
      await expect(save(21)).rejects.toThrow(/between 0 and 20/);
      await expect(save(-1)).rejects.toThrow();
      await save(20);
      await save(12.5);
      const [r] = await db.admin('select score, entered_by, updated_by from public.scores where assessment_id = $1', [a]);
      expect(Number(r.score)).toBe(12.5);
      expect(r.entered_by).toBe(w.teacherA1);
    });
  });

  it('total weight per class/subject cannot exceed 100', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Class score', max: 30, weight: 30 });
      await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Exam', max: 100, weight: 70 });
      const err = await db.fails(w.teacherA1,
        `insert into public.assessments (school_id, semester_id, class_id, subject_id, name, max_score, weight)
         values ($1, $2, $3, $4, 'Extra', 10, 1)`, [w.schoolA, w.semA, w.classA1, w.mathA]);
      expect(err.message).toMatch(/max 100/);
    });
  });

  it('cannot score a student who is not in the assessment class', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const a = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Quiz', max: 10, weight: 10 });
      const err = await db.fails(w.hmA, 'select public.save_scores($1, $2::jsonb)', [a, JSON.stringify([{ student_id: w.studentsA2[0], score: 5 }])]);
      expect(err.message).toMatch(/not in the assessment/);
    });
  });

  it('weighted totals and grades follow the configured scale', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const cs = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Class score', max: 50, weight: 30 });
      const ex = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Exam', max: 100, weight: 70 });
      const [s1, s2] = w.studentsA1;
      await db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [cs, JSON.stringify([{ student_id: s1, score: 45 }, { student_id: s2, score: 20 }])]);
      await db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [ex, JSON.stringify([{ student_id: s1, score: 80 }, { student_id: s2, score: 40 }])]);
      const rows = await db.as(w.teacherA1, 'select * from public.class_subject_results($1, $2, $3)', [w.semA, w.classA1, w.mathA]);
      const r1 = rows.find((r) => r.student_id === s1)!;
      const r2 = rows.find((r) => r.student_id === s2)!;
      // s1: 45/50*30 + 80/100*70 = 27 + 56 = 83 -> A ; s2: 12 + 28 = 40 -> E
      expect(Number(r1.total)).toBe(83);
      expect(r1.grade).toBe('A');
      expect(Number(r2.total)).toBe(40);
      expect(r2.grade).toBe('E');
      expect(r1.scores_entered).toBe(2);
    });
  });

  it('headmaster correction is recorded with who changed it', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const a = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Quiz', max: 10, weight: 10 });
      await db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [a, JSON.stringify([{ student_id: w.studentsA1[0], score: 4 }])]);
      await db.as(w.hmA, 'select public.save_scores($1, $2::jsonb)', [a, JSON.stringify([{ student_id: w.studentsA1[0], score: 6 }])]);
      const [s] = await db.admin('select entered_by, updated_by, score from public.scores where assessment_id = $1', [a]);
      expect(s.entered_by).toBe(w.teacherA1);
      expect(s.updated_by).toBe(w.hmA);
      const [log] = await db.admin(`select actor_id, actor_role, metadata from public.audit_logs where action = 'score.updated' and entity_type = 'score'`);
      expect(log.actor_id).toBe(w.hmA);
      expect(log.actor_role).toBe('headmaster');
      expect(log.metadata.changes.score).toEqual({ old: 4, new: 6 });
    });
  });
});

describe('(6) semester billing', () => {
  it('counts unique registrations and applies the configured price', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const [{ register_students_for_semester: n1 }] = await db.as(w.hmA, 'select public.register_students_for_semester($1)', [w.semA]);
      expect(n1).toBe(5);
      // registering again does not double count
      const [{ register_students_for_semester: n2 }] = await db.as(w.hmA, 'select public.register_students_for_semester($1)', [w.semA]);
      expect(n2).toBe(0);
      // class transfer mid-semester does not create a second registration
      await db.as(w.hmA, 'select public.transfer_student($1, $2, $3)', [w.studentsA1[0], w.classA2, 'Promoted']);

      const [{ upsert_semester_billing: billingId }] = await db.as(w.superAdmin, 'select public.upsert_semester_billing($1)', [w.semA]);
      let [b] = await db.as(w.superAdmin, 'select * from public.billing_overview where id = $1', [billingId]);
      expect(b.student_count).toBe(5);
      expect(Number(b.price_per_student)).toBe(2);
      expect(Number(b.amount_due)).toBe(10);
      expect(b.payment_status).toBe('unpaid');
      expect(b.renewal_status).toBe('pending');

      // withdrawal keeps the registration billable; voiding (data-entry error) removes it
      await db.as(w.hmA, 'select public.set_student_status($1, $2, $3)', [w.studentsA1[1], 'withdrawn', 'Family relocated']);
      await db.as(w.hmA, `update public.student_enrollments set status = 'voided', status_reason = 'Registered by mistake' where student_id = $1`, [w.studentsA1[2]]);
      await db.as(w.superAdmin, 'select public.upsert_semester_billing($1)', [w.semA]);
      [b] = await db.as(w.superAdmin, 'select * from public.billing_overview where id = $1', [billingId]);
      expect(b.student_count).toBe(4);
      expect(Number(b.amount_due)).toBe(8);

      // payments: partial then full
      await db.as(w.superAdmin, `select public.record_payment($1, 5, 'mobile_money', 'MOMO-123')`, [billingId]);
      [b] = await db.as(w.superAdmin, 'select * from public.billing_overview where id = $1', [billingId]);
      expect(b.payment_status).toBe('partial');
      expect(Number(b.balance)).toBe(3);
      await db.as(w.superAdmin, `select public.record_payment($1, 3, 'cash', 'RCPT-9')`, [billingId]);
      [b] = await db.as(w.superAdmin, 'select * from public.billing_overview where id = $1', [billingId]);
      expect(b.payment_status).toBe('paid');
      expect(b.renewal_status).toBe('renewed');
      // the same receipt reference cannot be recorded twice
      const dup = await db.fails(w.superAdmin, `select public.record_payment($1, 3, 'cash', 'rcpt-9')`, [billingId]);
      expect(dup.code).toBe('23505');

      // headmaster sees own billing but cannot record payments or change price
      const own = await db.as(w.hmA, 'select id from public.billing_overview');
      expect(own.map((r) => r.id)).toEqual([billingId]);
      expect(await db.as(w.hmB, 'select id from public.billing_overview where id = $1', [billingId])).toHaveLength(0);
      expect((await db.fails(w.hmA, `select public.record_payment($1, 100, 'cash')`, [billingId])).code).toBe('42501');
      expect((await db.fails(w.hmA, `select public.update_billing_terms($1, 0)`, [billingId])).code).toBe('42501');
    });
  });

  it('price is configurable by the super admin only and snapshotted per record', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const [{ price_per_student }] = await db.as(w.hmA, 'select price_per_student from public.platform_settings');
      expect(Number(price_per_student)).toBe(2);
      // headmaster update affects 0 rows (RLS)
      const none = await db.as(w.hmA, 'update public.platform_settings set price_per_student = 0 returning id');
      expect(none).toHaveLength(0);

      await db.as(w.hmA, 'select public.register_students_for_semester($1)', [w.semA]);
      await db.as(w.hmB, 'select public.register_students_for_semester($1)', [w.semB]);
      const [{ upsert_semester_billing: billA }] = await db.as(w.superAdmin, 'select public.upsert_semester_billing($1)', [w.semA]);
      await db.as(w.superAdmin, 'update public.platform_settings set price_per_student = 3.5');
      const [{ upsert_semester_billing: billB }] = await db.as(w.superAdmin, 'select public.upsert_semester_billing($1)', [w.semB]);
      const [a] = await db.as(w.superAdmin, 'select amount_due, price_per_student from public.semester_billing where id = $1', [billA]);
      const [b] = await db.as(w.superAdmin, 'select amount_due, price_per_student from public.semester_billing where id = $1', [billB]);
      expect(Number(a.price_per_student)).toBe(2);      // existing record keeps its price
      expect(Number(a.amount_due)).toBe(10);            // 5 × 2
      expect(Number(b.price_per_student)).toBe(3.5);
      expect(Number(b.amount_due)).toBe(7);             // 2 × 3.5
      // explicit re-pricing is audited
      await db.as(w.superAdmin, 'select public.update_billing_terms($1, 3.5)', [billA]);
      const logs = await db.admin(`select metadata from public.audit_logs where entity_type = 'billing' and entity_id = $1 and action = 'billing.updated'`, [billA]);
      expect(logs.some((l) => l.metadata.changes?.price_per_student)).toBe(true);
      const settingsLog = await db.admin(`select actor_id from public.audit_logs where entity_type = 'platform_settings'`);
      expect(settingsLog[0].actor_id).toBe(w.superAdmin);
    });
  });

  it('late registrations are flagged and still counted once', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.admin(`update public.semesters set starts_on = '2026-01-01', registration_deadline = '2026-01-15', ends_on = '2027-12-31' where id = $1`, [w.semA]);
      await db.as(w.hmA, 'select public.register_students_for_semester($1, $2)', [w.semA, [w.studentsA1[0]]]);
      const [e] = await db.admin('select is_late from public.student_enrollments where student_id = $1', [w.studentsA1[0]]);
      expect(e.is_late).toBe(true);
      const [{ billable_student_count }] = await db.as(w.hmA, 'select public.billable_student_count($1)', [w.semA]);
      expect(billable_student_count).toBe(1);
    });
  });
});

describe('(8) important actions create audit records', () => {
  it('records actor, action, entity and school scope; never secrets', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const [{ id: sid }] = await db.as(w.hmA,
        `insert into public.students (school_id, admission_number, first_name, last_name, current_class_id)
         values ($1, 'a100', 'Abena', 'Darko', $2) returning id`, [w.schoolA, w.classA1]);
      await db.as(w.hmA, 'select public.transfer_student($1, $2, $3)', [sid, w.classA2, 'Moved up']);
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [
        w.classA1, today(), JSON.stringify(w.studentsA1.map((id) => ({ student_id: id, status: 'present' })))]);
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [
        w.classA1, today(), JSON.stringify([{ student_id: w.studentsA1[0], status: 'absent' }])]);
      await db.as(w.hmA, `insert into public.teacher_assignments (school_id, teacher_id, class_id, subject_id) values ($1, $2, $3, $4)`,
        [w.schoolA, w.teacherA2, w.classA1, w.englishA]);
      await db.as(w.superAdmin, `update public.schools set status = 'suspended' where id = $1`, [w.schoolB]);

      const logs = await db.admin(`select * from public.audit_logs where school_id in ($1, $2) order by id`, [w.schoolA, w.schoolB]);
      const actions = logs.map((l) => l.action);
      expect(actions).toContain('student.created');
      expect(actions).toContain('student.class_transferred');
      expect(actions).toContain('attendance.submitted');
      expect(actions).toContain('attendance_record.updated');
      expect(actions).toContain('teacher_assignment.created');
      expect(actions).toContain('school.status_changed');

      const created = logs.find((l) => l.action === 'student.created' && l.entity_id === sid);
      expect(created.actor_id).toBe(w.hmA);
      expect(created.actor_role).toBe('headmaster');
      expect(created.school_id).toBe(w.schoolA);
      expect(created.entity_id).toBe(sid);
      const status = logs.find((l) => l.action === 'school.status_changed');
      expect(status.actor_role).toBe('super_admin');
      expect(status.metadata.changes.status).toEqual({ old: 'active', new: 'suspended' });

      const hist = await db.as(w.hmA, 'select from_class_id, to_class_id, reason, moved_by from public.student_class_history where student_id = $1', [sid]);
      expect(hist).toEqual([{ from_class_id: w.classA1, to_class_id: w.classA2, reason: 'Moved up', moved_by: w.hmA }]);

      const blob = JSON.stringify(logs).toLowerCase();
      for (const secret of ['password', 'encrypted', 'token', 'secret']) expect(blob).not.toContain(secret);
    });
  });

  it('audit visibility is restricted by role', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.as(w.hmA, `update public.students set first_name = 'Kwame Jr' where id = $1`, [w.studentsA1[0]]);
      await db.as(w.hmB, `update public.students set first_name = 'Esi Jr' where id = $1`, [w.studentsB1[0]]);
      const hmAlogs = await db.as(w.hmA, 'select school_id from public.audit_logs');
      expect(hmAlogs.length).toBeGreaterThan(0);
      expect(hmAlogs.every((l) => l.school_id === w.schoolA)).toBe(true);
      expect(await db.as(w.teacherA1, 'select id from public.audit_logs')).toHaveLength(0);
      const all = await db.as(w.superAdmin, 'select distinct school_id from public.audit_logs where school_id in ($1, $2)', [w.schoolA, w.schoolB]);
      expect(all).toHaveLength(2);
    });
  });
});

describe('(9) class browsing and whole-school search', () => {
  it('headmaster browses by class and searches the whole school', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const byClass = await db.as(w.hmA, 'select current_class_id, count(*)::int n from public.students group by 1 order by 2 desc');
      expect(byClass).toEqual([{ current_class_id: w.classA1, n: 3 }, { current_class_id: w.classA2, n: 2 }]);
      // "mensah" exists in A1, A2 and school B — search must span classes but not schools
      const found = await db.as(w.hmA, `select id, current_class_id from public.students where search_text ilike $1`, ['%mensah%']);
      expect(found).toHaveLength(2);
      expect(new Set(found.map((r) => r.current_class_id))).toEqual(new Set([w.classA1, w.classA2]));
      const byAdm = await db.as(w.hmA, `select id from public.students where search_text ilike $1`, ['%a004%']);
      expect(byAdm.map((r) => r.id)).toEqual([w.studentsA2[0]]);
    });
  });

  it('teacher search only covers their own classes', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const found = await db.as(w.teacherA1, `select id from public.students where search_text ilike $1`, ['%mensah%']);
      expect(found.map((r) => r.id)).toEqual([w.studentsA1[0]]);
    });
  });

  it('duplicate students are prevented', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const e1 = await db.fails(w.hmA,
        `insert into public.students (school_id, admission_number, first_name, last_name) values ($1, 'a001', 'Other', 'Person')`, [w.schoolA]);
      expect(e1.code).toBe('23505');
      await db.as(w.hmA, `insert into public.students (school_id, admission_number, first_name, last_name, date_of_birth) values ($1, 'N1', 'Efua', 'Sarpong', '2015-03-02')`, [w.schoolA]);
      const e2 = await db.fails(w.hmA,
        `insert into public.students (school_id, admission_number, first_name, last_name, date_of_birth) values ($1, 'N2', ' efua ', 'SARPONG', '2015-03-02')`, [w.schoolA]);
      expect(e2.code).toBe('23505');
      // the same admission number in a different school is fine
      await db.as(w.hmB, `insert into public.students (school_id, admission_number, first_name, last_name) values ($1, 'A001', 'Same', 'Number')`, [w.schoolB]);
    });
  });
});
