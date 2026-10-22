-- =============================================================================
-- Migration 3: privileges + Row Level Security
-- -----------------------------------------------------------------------------
--  * anon gets NOTHING on application tables.
--  * authenticated gets table privileges, but RLS decides which rows.
--  * Billing, payments, audit logs, history and platform admins are read-only
--    through the API; they change only via SECURITY DEFINER RPCs / triggers.
--  * Platform super admins manage schools, memberships, calendars and billing,
--    but deliberately do NOT get row access to student PII, attendance or grades
--    (they get aggregate counts through dedicated functions instead).
-- =============================================================================

-- ---------- privileges ------------------------------------------------------
revoke all on all tables in schema public from anon, public;
revoke all on all sequences in schema public from anon, public;
revoke all on all functions in schema private from public, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- read-only through the API
revoke insert, update, delete on public.audit_logs, public.semester_billing, public.payments,
  public.platform_admins, public.student_class_history from authenticated;
-- no hard deletes for records that billing/history depend on
revoke delete on public.schools, public.students, public.student_enrollments, public.school_memberships,
  public.attendance_sessions, public.attendance_records, public.platform_settings, public.profiles from authenticated;
revoke insert on public.platform_settings, public.profiles from authenticated;

-- ---------- enable RLS everywhere ------------------------------------------
-- (Not FORCE: SECURITY DEFINER helpers are owned by the migration owner and must
-- be able to read membership tables without recursing into these policies.)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- platform -------------------------------------------------------
create policy "settings readable by signed-in users" on public.platform_settings
  for select to authenticated using (true);
create policy "settings updatable by super admin" on public.platform_settings
  for update to authenticated using ((select private.is_super_admin())) with check ((select private.is_super_admin()));

create policy "platform admins visible to self and super admins" on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()) or (select private.is_super_admin()));

-- ---------- profiles -------------------------------------------------------
create policy "profiles: own, super admin, or headmaster of a shared school" on public.profiles
  for select to authenticated using (
    id = (select auth.uid())
    or (select private.is_super_admin())
    or exists (select 1 from public.school_memberships m
               where m.user_id = profiles.id and private.is_headmaster(m.school_id))
  );
create policy "profiles: users update their own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------- schools --------------------------------------------------------
create policy "schools: super admin or member" on public.schools
  for select to authenticated using (
    (select private.is_super_admin()) or private.is_member_any_school_status(id, array['headmaster','teacher'])
  );
create policy "schools: super admin creates" on public.schools
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "schools: super admin or own headmaster updates" on public.schools
  for update to authenticated
  using ((select private.is_super_admin()) or private.is_headmaster(id))
  with check ((select private.is_super_admin()) or private.is_headmaster(id));

-- ---------- memberships ----------------------------------------------------
create policy "memberships: own, headmaster of school, super admin" on public.school_memberships
  for select to authenticated using (
    user_id = (select auth.uid()) or private.is_headmaster(school_id) or (select private.is_super_admin())
  );
create policy "memberships: super admin inserts" on public.school_memberships
  for insert to authenticated with check ((select private.is_super_admin()));
create policy "memberships: headmaster manages teachers; super admin all" on public.school_memberships
  for update to authenticated
  using ((select private.is_super_admin()) or (private.is_headmaster(school_id) and role = 'teacher'))
  with check ((select private.is_super_admin()) or (private.is_headmaster(school_id) and role = 'teacher'));

-- ---------- academic years & semesters ------------------------------------
create policy "academic_years: members and super admin read" on public.academic_years
  for select to authenticated using (
    private.is_member(school_id)
    or private.is_member_any_school_status(school_id, array['headmaster'])  -- needed to read billing while suspended
    or (select private.is_super_admin()));
create policy "academic_years: headmaster insert" on public.academic_years
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "academic_years: headmaster update" on public.academic_years
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "academic_years: headmaster delete" on public.academic_years
  for delete to authenticated using (private.is_headmaster(school_id));

create policy "semesters: members and super admin read" on public.semesters
  for select to authenticated using (
    private.is_member(school_id)
    or private.is_member_any_school_status(school_id, array['headmaster'])  -- needed to read billing while suspended
    or (select private.is_super_admin()));
create policy "semesters: headmaster insert" on public.semesters
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "semesters: headmaster update" on public.semesters
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "semesters: headmaster delete" on public.semesters
  for delete to authenticated using (private.is_headmaster(school_id));

-- ---------- classes & subjects --------------------------------------------
create policy "classes: headmaster all rows, teacher assigned only" on public.classes
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(id));
create policy "classes: headmaster insert" on public.classes
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "classes: headmaster update" on public.classes
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "classes: headmaster delete" on public.classes
  for delete to authenticated using (private.is_headmaster(school_id));

create policy "subjects: headmaster all, teacher assigned only" on public.subjects
  for select to authenticated using (
    private.is_headmaster(school_id)
    or exists (select 1 from public.teacher_assignments ta
               where ta.subject_id = subjects.id and ta.teacher_id = (select auth.uid())
                 and private.is_member(ta.school_id))
  );
create policy "subjects: headmaster insert" on public.subjects
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "subjects: headmaster update" on public.subjects
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "subjects: headmaster delete" on public.subjects
  for delete to authenticated using (private.is_headmaster(school_id));

-- ---------- teacher assignments -------------------------------------------
create policy "assignments: headmaster or the teacher" on public.teacher_assignments
  for select to authenticated using (
    private.is_headmaster(school_id) or (teacher_id = (select auth.uid()) and private.is_member(school_id))
  );
create policy "assignments: headmaster insert" on public.teacher_assignments
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "assignments: headmaster update" on public.teacher_assignments
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "assignments: headmaster delete" on public.teacher_assignments
  for delete to authenticated using (private.is_headmaster(school_id));

-- ---------- students ------------------------------------------------------
create policy "students: headmaster, or teacher of the student's class" on public.students
  for select to authenticated using (
    private.is_headmaster(school_id)
    or (current_class_id is not null and private.teaches_class(current_class_id))
  );
create policy "students: headmaster insert" on public.students
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "students: headmaster update" on public.students
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

create policy "class history: headmaster or teacher of student" on public.student_class_history
  for select to authenticated using (private.is_headmaster(school_id) or private.can_access_student(student_id));

create policy "enrollments: headmaster, or teacher of the class" on public.student_enrollments
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(class_id));
create policy "enrollments: headmaster insert" on public.student_enrollments
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "enrollments: headmaster update" on public.student_enrollments
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- ---------- attendance ----------------------------------------------------
create policy "attendance sessions: headmaster or class teacher read" on public.attendance_sessions
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(class_id));
create policy "attendance sessions: headmaster or class teacher insert" on public.attendance_sessions
  for insert to authenticated with check (private.is_headmaster(school_id) or private.teaches_class(class_id));
create policy "attendance sessions: headmaster or class teacher update" on public.attendance_sessions
  for update to authenticated
  using (private.is_headmaster(school_id) or private.teaches_class(class_id))
  with check (private.is_headmaster(school_id) or private.teaches_class(class_id));

create policy "attendance records: headmaster or class teacher read" on public.attendance_records
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(class_id));
create policy "attendance records: headmaster or class teacher insert" on public.attendance_records
  for insert to authenticated with check (private.is_headmaster(school_id) or private.teaches_class(class_id));
create policy "attendance records: headmaster or class teacher update" on public.attendance_records
  for update to authenticated
  using (private.is_headmaster(school_id) or private.teaches_class(class_id))
  with check (private.is_headmaster(school_id) or private.teaches_class(class_id));

-- ---------- grading -------------------------------------------------------
create policy "grading scales: members read" on public.grading_scales
  for select to authenticated using (private.is_member(school_id));
create policy "grading scales: headmaster insert" on public.grading_scales
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "grading scales: headmaster update" on public.grading_scales
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "grading scales: headmaster delete" on public.grading_scales
  for delete to authenticated using (private.is_headmaster(school_id));

create policy "grading bands: members read" on public.grading_scale_bands
  for select to authenticated using (private.is_member(school_id));
create policy "grading bands: headmaster insert" on public.grading_scale_bands
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "grading bands: headmaster update" on public.grading_scale_bands
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "grading bands: headmaster delete" on public.grading_scale_bands
  for delete to authenticated using (private.is_headmaster(school_id));

create policy "assessments: headmaster or subject teacher read" on public.assessments
  for select to authenticated using (private.can_manage_subject_grades(class_id, subject_id) and private.is_member(school_id));
create policy "assessments: headmaster or subject teacher insert" on public.assessments
  for insert to authenticated with check (private.can_manage_subject_grades(class_id, subject_id) and private.is_member(school_id));
create policy "assessments: headmaster or subject teacher update" on public.assessments
  for update to authenticated
  using (private.can_manage_subject_grades(class_id, subject_id) and private.is_member(school_id))
  with check (private.can_manage_subject_grades(class_id, subject_id) and private.is_member(school_id));
create policy "assessments: headmaster or subject teacher delete" on public.assessments
  for delete to authenticated using (private.can_manage_subject_grades(class_id, subject_id) and private.is_member(school_id));

create policy "scores: headmaster or subject teacher read" on public.scores
  for select to authenticated using (private.can_grade_assessment(assessment_id) and private.is_member(school_id));
create policy "scores: headmaster or subject teacher insert" on public.scores
  for insert to authenticated with check (private.can_grade_assessment(assessment_id) and private.is_member(school_id));
create policy "scores: headmaster or subject teacher update" on public.scores
  for update to authenticated
  using (private.can_grade_assessment(assessment_id) and private.is_member(school_id))
  with check (private.can_grade_assessment(assessment_id) and private.is_member(school_id));
create policy "scores: headmaster or subject teacher delete" on public.scores
  for delete to authenticated using (private.can_grade_assessment(assessment_id) and private.is_member(school_id));

-- ---------- billing (read-only via API) -----------------------------------
create policy "billing: super admin or own headmaster" on public.semester_billing
  for select to authenticated using (
    (select private.is_super_admin()) or private.is_member_any_school_status(school_id, array['headmaster'])
  );
create policy "payments: super admin or own headmaster" on public.payments
  for select to authenticated using (
    (select private.is_super_admin()) or private.is_member_any_school_status(school_id, array['headmaster'])
  );

-- ---------- audit logs (read-only; role-scoped) ---------------------------
create policy "audit: role-scoped read" on public.audit_logs
  for select to authenticated using (
    (select private.is_super_admin())
    or (school_id is not null and private.is_headmaster(school_id))
    or actor_id = (select auth.uid())
  );
