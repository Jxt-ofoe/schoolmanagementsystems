/** Dashboards & reports derive figures from the database for each role. */
import { describe, it, expect } from 'vitest';
import { withTx, buildWorld, makeAssessment, today } from './harness';

describe('(10 - data) dashboards and reports', () => {
  it('headmaster dashboard, attendance overview/report and grade-entry status', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      await db.as(w.hmA, 'select public.register_students_for_semester($1)', [w.semA]);
      await db.as(w.teacherA1, 'select public.save_attendance($1, $2, $3::jsonb, true)', [
        w.classA1, today(), JSON.stringify([
          { student_id: w.studentsA1[0], status: 'present' },
          { student_id: w.studentsA1[1], status: 'absent' },
          { student_id: w.studentsA1[2], status: 'late' },
        ])]);
      const a = await makeAssessment(db, w, { school: w.schoolA, sem: w.semA, cls: w.classA1, subject: w.mathA, name: 'Quiz', max: 10, weight: 40 });
      await db.as(w.teacherA1, 'select public.save_scores($1, $2::jsonb)', [a, JSON.stringify([{ student_id: w.studentsA1[0], score: 9 }])]);

      const [{ headmaster_dashboard: d }] = await db.as(w.hmA, 'select public.headmaster_dashboard($1, $2)', [w.schoolA, today()]);
      expect(d.students_active).toBe(5);
      expect(d.teachers).toBe(2);
      expect(d.classes).toBe(2);
      expect(d.registered_this_semester).toBe(5);
      expect(d.attendance_today).toEqual({ classes: 2, submitted: 1, draft: 0, not_started: 1 });
      expect(d.attendance_trend).toHaveLength(14);
      expect(d.attendance_trend[13].rate).toBe(66.7);
      expect(d.grade_entry.scores_entered).toBe(1);

      const overview = await db.as(w.hmA, 'select * from public.attendance_overview($1, $2)', [w.schoolA, today()]);
      expect(overview.map((r) => r.session_status)).toEqual(['submitted', 'not_started']);
      expect(overview[0]).toMatchObject({ present: 1, absent: 1, late: 1, marked: 3, students: 3, taken_by_name: 'Teacher A1' });

      const report = await db.as(w.hmA, 'select * from public.attendance_report($1, $2, $3, $4, $5)', [w.schoolA, today(), today(), w.classA1, w.teacherA1]);
      expect(report).toHaveLength(3);

      const status = await db.as(w.hmA, 'select * from public.grade_entry_status($1, $2)', [w.schoolA, w.semA]);
      expect(status).toHaveLength(2);
      const math = status.find((s) => s.subject_id === w.mathA);
      expect(math).toMatchObject({ assessments: 1, students: 3, scores_entered: 1, scores_expected: 3 });

      const [{ student_attendance_summary: sum }] = await db.as(w.hmA, 'select public.student_attendance_summary($1, $2, $3)', [w.studentsA1[2], today(), today()]);
      expect(sum).toMatchObject({ days_marked: 1, late: 1, rate: 100 });
      const res = await db.as(w.hmA, 'select * from public.student_semester_results($1, $2)', [w.studentsA1[0], w.semA]);
      expect(res).toHaveLength(1);
      expect(Number(res[0].percentage)).toBe(90);
    });
  });

  it('teacher dashboard lists only assigned work', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const [{ teacher_dashboard: t }] = await db.as(w.teacherA1, 'select public.teacher_dashboard($1, $2)', [w.schoolA, today()]);
      expect(t.classes).toHaveLength(1);
      expect(t.classes[0]).toMatchObject({ class_id: w.classA1, is_class_teacher: true, students: 3, attendance_status: 'not_started' });
      expect(t.grade_tasks).toHaveLength(1);
      expect(t.grade_tasks[0].subject_id).toBe(w.mathA);
      const overview = await db.as(w.teacherA1, 'select class_id from public.attendance_overview($1, $2)', [w.schoolA, today()]);
      expect(overview.map((r) => r.class_id)).toEqual([w.classA1]);
      const e = await db.fails(w.teacherB1, 'select public.teacher_dashboard($1)', [w.schoolA]);
      expect(e.code).toBe('42501');
    });
  });

  it('platform summaries and my_context', async () => {
    await withTx(async (db) => {
      const w = await buildWorld(db);
      const rows = await db.as(w.superAdmin, 'select * from public.platform_school_summaries() where school_id = $1', [w.schoolA]);
      expect(rows[0]).toMatchObject({ teachers: 2, students_active: 5, current_semester: 'Semester 1', headmasters: 'Headmaster A' });
      const [{ refresh_current_billing: n }] = await db.as(w.superAdmin, 'select public.refresh_current_billing()');
      expect(n).toBeGreaterThanOrEqual(2);
      const [{ my_context: ctx }] = await db.as(w.teacherA1, 'select public.my_context()');
      expect(ctx.is_super_admin).toBe(false);
      expect(ctx.memberships).toEqual([expect.objectContaining({ school_id: w.schoolA, role: 'teacher' })]);
      expect((await db.fails(w.hmA, 'select * from public.platform_school_summaries()')).code).toBe('42501');
    });
  });
});
