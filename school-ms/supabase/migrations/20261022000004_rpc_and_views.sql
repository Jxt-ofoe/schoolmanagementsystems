-- =============================================================================
-- Migration 4: business RPCs, reporting functions, views
--  * SECURITY INVOKER functions run with the caller's RLS (preferred).
--  * SECURITY DEFINER is used only where an aggregate across RLS boundaries or a
--    write to a read-only table is required; each one checks authorization first.
-- =============================================================================

create or replace function private.class_label(p_name text, p_section text)
returns text language sql immutable set search_path = '' as $$
  select case when p_section is null or p_section = '' then p_name else p_name || ' ' || p_section end;
$$;
grant execute on function private.class_label(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Session context: who am I?
-- ---------------------------------------------------------------------------
create or replace function public.my_context()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'is_super_admin', private.is_super_admin(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = (select auth.uid())),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id, 'school_id', m.school_id, 'role', m.role, 'status', m.status,
        'school_name', s.name, 'school_code', s.code, 'school_status', s.status) order by s.name)
      from public.school_memberships m join public.schools s on s.id = m.school_id
      where m.user_id = (select auth.uid()) and m.status = 'active'
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Academic calendar
-- ---------------------------------------------------------------------------
create or replace function public.set_current_semester(p_semester_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_school uuid; v_year uuid;
begin
  select school_id, academic_year_id into v_school, v_year from public.semesters where id = p_semester_id;
  if v_school is null or not private.is_headmaster(v_school) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  update public.semesters set is_current = false where school_id = v_school and is_current and id <> p_semester_id;
  update public.semesters set is_current = true, status = case when status = 'planned' then 'open' else status end
   where id = p_semester_id;
  update public.academic_years set is_current = false where school_id = v_school and is_current and id <> v_year;
  update public.academic_years set is_current = true where id = v_year;
end $$;

-- Register students for a semester (idempotent: never double-registers).
create or replace function public.register_students_for_semester(p_semester_id uuid, p_student_ids uuid[] default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_school uuid; v_count integer;
begin
  select school_id into v_school from public.semesters where id = p_semester_id;
  if v_school is null or not private.is_headmaster(v_school) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  insert into public.student_enrollments (school_id, student_id, semester_id, class_id)
  select s.school_id, s.id, p_semester_id, s.current_class_id
  from public.students s
  where s.school_id = v_school
    and s.enrollment_status = 'active'
    and s.current_class_id is not null
    and (p_student_ids is null or s.id = any (p_student_ids))
  on conflict (student_id, semester_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------
create or replace function public.transfer_student(p_student_id uuid, p_to_class_id uuid, p_reason text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_school uuid; v_from uuid;
begin
  select school_id, current_class_id into v_school, v_from from public.students where id = p_student_id;
  if v_school is null or not private.is_headmaster(v_school) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if v_from is not distinct from p_to_class_id then
    raise exception 'Student is already in this class' using errcode = '23514';
  end if;
  if not exists (select 1 from public.classes where id = p_to_class_id and school_id = v_school and is_active) then
    raise exception 'Target class not found in this school' using errcode = '23514';
  end if;
  perform set_config('app.transfer_reason', coalesce(left(p_reason, 300), ''), true);
  update public.students set current_class_id = p_to_class_id where id = p_student_id;
end $$;

create or replace function public.set_student_status(p_student_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null or not private.is_headmaster(v_school) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform set_config('app.transfer_reason', coalesce(left(p_reason, 300), ''), true);
  update public.students set enrollment_status = p_status where id = p_student_id;
end $$;

create or replace function public.class_student_counts(p_school_id uuid)
returns table (class_id uuid, active integer, total integer)
language sql stable security invoker set search_path = '' as $$
  select s.current_class_id, count(*) filter (where s.enrollment_status = 'active')::int, count(*)::int
  from public.students s
  where s.school_id = p_school_id
  group by s.current_class_id;
$$;

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create or replace function public.save_attendance(
  p_class_id uuid, p_date date, p_records jsonb, p_submit boolean default false, p_notes text default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_school uuid; v_session uuid;
begin
  if not private.can_access_class(p_class_id) then
    raise exception 'You are not assigned to this class' using errcode = '42501';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Records must be an array' using errcode = '22023';
  end if;
  select school_id into v_school from public.classes where id = p_class_id;

  insert into public.attendance_sessions (school_id, class_id, attendance_date, status, taken_by, submitted_at, notes)
  values (v_school, p_class_id, p_date, case when p_submit then 'submitted' else 'draft' end,
          (select auth.uid()), case when p_submit then now() end, nullif(btrim(p_notes), ''))
  on conflict (class_id, attendance_date) do update set
    status       = case when p_submit or public.attendance_sessions.status = 'submitted' then 'submitted' else 'draft' end,
    submitted_at = case when p_submit and public.attendance_sessions.status = 'draft' then now()
                        else public.attendance_sessions.submitted_at end,
    notes        = coalesce(excluded.notes, public.attendance_sessions.notes)
  returning id into v_session;

  insert into public.attendance_records (school_id, session_id, student_id, class_id, attendance_date, status, note)
  select v_school, v_session, (r ->> 'student_id')::uuid, p_class_id, p_date, r ->> 'status', nullif(btrim(r ->> 'note'), '')
  from jsonb_array_elements(p_records) r
  on conflict (student_id, class_id, attendance_date) do update
    set status = excluded.status, note = excluded.note
    where public.attendance_records.status is distinct from excluded.status
       or public.attendance_records.note is distinct from excluded.note;

  return v_session;
end $$;

-- Per-class status for one date (headmaster: whole school; teacher: own classes)
create or replace function public.attendance_overview(p_school_id uuid, p_date date)
returns table (
  class_id uuid, class_name text, level_order integer, students integer,
  session_id uuid, session_status text, submitted_at timestamptz, taken_by_name text,
  present integer, absent integer, late integer, excused integer, marked integer)
language sql stable security invoker set search_path = '' as $$
  select c.id, private.class_label(c.name, c.section), c.level_order,
         (select count(*) from public.students s where s.current_class_id = c.id and s.enrollment_status = 'active')::int,
         se.id, coalesce(se.status, 'not_started'), se.submitted_at, p.full_name,
         count(r.id) filter (where r.status = 'present')::int,
         count(r.id) filter (where r.status = 'absent')::int,
         count(r.id) filter (where r.status = 'late')::int,
         count(r.id) filter (where r.status = 'excused')::int,
         count(r.id)::int
  from public.classes c
  left join public.attendance_sessions se on se.class_id = c.id and se.attendance_date = p_date
  left join public.attendance_records r on r.session_id = se.id
  left join public.profiles p on p.id = se.taken_by
  where c.school_id = p_school_id and c.is_active
  group by c.id, se.id, p.full_name
  order by c.level_order, c.name, c.section;
$$;

-- Per-student attendance summary for a range with optional filters
create or replace function public.attendance_report(
  p_school_id uuid, p_from date, p_to date, p_class_id uuid default null, p_teacher_id uuid default null)
returns table (
  student_id uuid, admission_number text, student_name text, class_name text,
  days_marked integer, present integer, absent integer, late integer, excused integer, attendance_rate numeric)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.admission_number, s.last_name || ', ' || s.first_name, private.class_label(c.name, c.section),
         count(r.id)::int,
         count(r.id) filter (where r.status = 'present')::int,
         count(r.id) filter (where r.status = 'absent')::int,
         count(r.id) filter (where r.status = 'late')::int,
         count(r.id) filter (where r.status = 'excused')::int,
         case when count(r.id) filter (where r.status <> 'excused') = 0 then null
              else round(100.0 * count(r.id) filter (where r.status in ('present','late'))
                         / count(r.id) filter (where r.status <> 'excused'), 1) end
  from public.attendance_records r
  join public.students s on s.id = r.student_id
  join public.classes c on c.id = r.class_id
  join public.attendance_sessions se on se.id = r.session_id
  where r.school_id = p_school_id
    and r.attendance_date between p_from and p_to
    and (p_class_id is null or r.class_id = p_class_id)
    and (p_teacher_id is null or se.taken_by = p_teacher_id)
  group by s.id, c.id
  order by c.level_order, c.name, 3;
$$;

create or replace function public.student_attendance_summary(p_student_id uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'days_marked', count(*),
    'present', count(*) filter (where status = 'present'),
    'absent', count(*) filter (where status = 'absent'),
    'late', count(*) filter (where status = 'late'),
    'excused', count(*) filter (where status = 'excused'),
    'rate', case when count(*) filter (where status <> 'excused') = 0 then null
                 else round(100.0 * count(*) filter (where status in ('present','late'))
                            / count(*) filter (where status <> 'excused'), 1) end,
    'recent', coalesce((select jsonb_agg(x order by x.attendance_date desc) from (
        select attendance_date, status, note from public.attendance_records
        where student_id = p_student_id order by attendance_date desc limit 15) x), '[]'::jsonb)
  )
  from public.attendance_records
  where student_id = p_student_id and attendance_date between p_from and p_to;
$$;

-- ---------------------------------------------------------------------------
-- Grades
-- ---------------------------------------------------------------------------
create or replace function public.save_scores(p_assessment_id uuid, p_scores jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v_school uuid; v_count integer := 0; r jsonb;
begin
  if not private.can_grade_assessment(p_assessment_id) then
    raise exception 'You are not assigned to this class and subject' using errcode = '42501';
  end if;
  if jsonb_typeof(p_scores) <> 'array' then
    raise exception 'Scores must be an array' using errcode = '22023';
  end if;
  select school_id into v_school from public.assessments where id = p_assessment_id;
  for r in select value from jsonb_array_elements(p_scores) loop
    if (r -> 'score') is null or jsonb_typeof(r -> 'score') = 'null' then
      delete from public.scores where assessment_id = p_assessment_id and student_id = (r ->> 'student_id')::uuid;
    else
      insert into public.scores (school_id, assessment_id, student_id, score, remark)
      values (v_school, p_assessment_id, (r ->> 'student_id')::uuid, (r ->> 'score')::numeric, nullif(btrim(r ->> 'remark'), ''))
      on conflict (assessment_id, student_id) do update
        set score = excluded.score, remark = excluded.remark
        where public.scores.score is distinct from excluded.score
           or public.scores.remark is distinct from excluded.remark;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Weighted totals: total = Σ(score / max_score × weight); percentage = total / Σweight × 100
create or replace function public.class_subject_results(p_semester_id uuid, p_class_id uuid, p_subject_id uuid)
returns table (
  student_id uuid, admission_number text, student_name text, total numeric, weight_total numeric,
  percentage numeric, grade text, remark text, scores_entered integer, assessments_count integer)
language sql stable security invoker set search_path = '' as $$
  with a as (
    select id, max_score, weight from public.assessments
    where semester_id = p_semester_id and class_id = p_class_id and subject_id = p_subject_id
  ),
  wt as (select coalesce(sum(weight), 0) as w, count(*) as n from a),
  st as (
    select s.id, s.admission_number, s.last_name || ', ' || s.first_name as name, s.school_id
    from public.students s
    where (s.current_class_id = p_class_id and s.enrollment_status = 'active')
       or exists (select 1 from public.student_enrollments e
                  where e.student_id = s.id and e.semester_id = p_semester_id
                    and e.class_id = p_class_id and e.status <> 'voided')
  ),
  agg as (
    select st.id, round(coalesce(sum(sc.score / a.max_score * a.weight), 0), 2) as total, count(sc.id) as cnt
    from st
    left join public.scores sc on sc.student_id = st.id and sc.assessment_id in (select id from a)
    left join a on a.id = sc.assessment_id
    group by st.id
  )
  select st.id, st.admission_number, st.name, agg.total, wt.w,
         case when wt.w > 0 then round(agg.total * 100 / wt.w, 2) end,
         b.grade, b.remark, agg.cnt::int, wt.n::int
  from st
  join agg on agg.id = st.id
  cross join wt
  left join lateral (
    select gb.grade, gb.remark
    from public.grading_scale_bands gb
    join public.grading_scales gs on gs.id = gb.scale_id
    where gs.school_id = st.school_id and gs.is_default and wt.w > 0
      and gb.min_score <= round(agg.total * 100 / wt.w, 2)
    order by gb.min_score desc limit 1
  ) b on true
  order by st.name;
$$;

-- All subject results for a single student in a semester
create or replace function public.student_semester_results(p_student_id uuid, p_semester_id uuid)
returns table (subject_id uuid, subject_name text, total numeric, weight_total numeric, percentage numeric,
               grade text, remark text, scores_entered integer, assessments_count integer)
language sql stable security invoker set search_path = '' as $$
  with subj as (
    select distinct a.subject_id, a.class_id from public.assessments a
    where a.semester_id = p_semester_id
      and a.class_id in (
        select class_id from public.student_enrollments where student_id = p_student_id and semester_id = p_semester_id
        union select current_class_id from public.students where id = p_student_id)
  )
  select subj.subject_id, sub.name, r.total, r.weight_total, r.percentage, r.grade, r.remark, r.scores_entered, r.assessments_count
  from subj
  join public.subjects sub on sub.id = subj.subject_id
  cross join lateral public.class_subject_results(p_semester_id, subj.class_id, subj.subject_id) r
  where r.student_id = p_student_id
  order by sub.name;
$$;

-- Grade-entry progress per class/subject assignment
create or replace function public.grade_entry_status(p_school_id uuid, p_semester_id uuid)
returns table (class_id uuid, class_name text, subject_id uuid, subject_name text, teacher_names text,
               assessments integer, weight_total numeric, students integer, scores_entered integer, scores_expected integer)
language sql stable security invoker set search_path = '' as $$
  with cs as (
    select ta.class_id, ta.subject_id, string_agg(distinct coalesce(nullif(p.full_name, ''), p.email), ', ') as teachers
    from public.teacher_assignments ta
    left join public.profiles p on p.id = ta.teacher_id
    where ta.school_id = p_school_id and ta.subject_id is not null
    group by ta.class_id, ta.subject_id
  )
  select c.id, private.class_label(c.name, c.section), s.id, s.name, cs.teachers,
         (select count(*) from public.assessments a where a.class_id = c.id and a.subject_id = s.id and a.semester_id = p_semester_id)::int,
         (select coalesce(sum(weight), 0) from public.assessments a where a.class_id = c.id and a.subject_id = s.id and a.semester_id = p_semester_id),
         (select count(*) from public.students st where st.current_class_id = c.id and st.enrollment_status = 'active')::int,
         (select count(*) from public.scores sc join public.assessments a on a.id = sc.assessment_id
           where a.class_id = c.id and a.subject_id = s.id and a.semester_id = p_semester_id)::int,
         ((select count(*) from public.assessments a where a.class_id = c.id and a.subject_id = s.id and a.semester_id = p_semester_id)
          * (select count(*) from public.students st where st.current_class_id = c.id and st.enrollment_status = 'active'))::int
  from cs
  join public.classes c on c.id = cs.class_id
  join public.subjects s on s.id = cs.subject_id
  order by c.level_order, c.name, s.name;
$$;

-- ---------------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------------
create or replace function public.headmaster_dashboard(p_school_id uuid, p_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_sem record; v_result jsonb;
begin
  if not private.is_headmaster(p_school_id) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select id, name, starts_on, ends_on into v_sem from public.semesters where school_id = p_school_id and is_current;

  select jsonb_build_object(
    'students_active', (select count(*) from public.students where school_id = p_school_id and enrollment_status = 'active'),
    'students_total',  (select count(*) from public.students where school_id = p_school_id),
    'students_unplaced', (select count(*) from public.students where school_id = p_school_id and enrollment_status = 'active' and current_class_id is null),
    'teachers',  (select count(*) from public.school_memberships where school_id = p_school_id and role = 'teacher' and status = 'active'),
    'classes',   (select count(*) from public.classes where school_id = p_school_id and is_active),
    'subjects',  (select count(*) from public.subjects where school_id = p_school_id and is_active),
    'current_semester', case when v_sem.id is null then null else jsonb_build_object(
        'id', v_sem.id, 'name', v_sem.name, 'starts_on', v_sem.starts_on, 'ends_on', v_sem.ends_on) end,
    'registered_this_semester', (select count(*) from public.student_enrollments
                                 where semester_id = v_sem.id and status <> 'voided'),
    'attendance_today', (
      select jsonb_build_object(
        'classes', count(*),
        'submitted', count(*) filter (where se.status = 'submitted'),
        'draft', count(*) filter (where se.status = 'draft'),
        'not_started', count(*) filter (where se.id is null))
      from public.classes c
      left join public.attendance_sessions se on se.class_id = c.id and se.attendance_date = p_date
      where c.school_id = p_school_id and c.is_active),
    'attendance_trend', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d.day::date, 'marked', coalesce(t.marked, 0), 'rate', t.rate) order by d.day), '[]'::jsonb)
      from generate_series(p_date - 13, p_date, interval '1 day') d(day)
      left join lateral (
        select count(*) as marked,
               case when count(*) filter (where r.status <> 'excused') = 0 then null
                    else round(100.0 * count(*) filter (where r.status in ('present','late'))
                               / count(*) filter (where r.status <> 'excused'), 1) end as rate
        from public.attendance_records r
        where r.school_id = p_school_id and r.attendance_date = d.day::date
      ) t on true),
    'grade_entry', (
      select jsonb_build_object('assignments', count(*),
                                'with_assessments', count(*) filter (where g.assessments > 0),
                                'scores_entered', coalesce(sum(g.scores_entered), 0),
                                'scores_expected', coalesce(sum(g.scores_expected), 0))
      from public.grade_entry_status(p_school_id, v_sem.id) g)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.teacher_dashboard(p_school_id uuid, p_date date default current_date)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_sem uuid;
begin
  if not private.is_member(p_school_id) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  select id into v_sem from public.semesters where school_id = p_school_id and is_current;
  return jsonb_build_object(
    'current_semester_id', v_sem,
    'current_semester', (select name from public.semesters where id = v_sem),
    'classes', coalesce((
      select jsonb_agg(x.obj order by x.level_order, x.class_name)
      from (
        select c.level_order, private.class_label(c.name, c.section) as class_name,
               jsonb_build_object(
                 'class_id', c.id, 'class_name', private.class_label(c.name, c.section),
                 'is_class_teacher', bool_or(ta.subject_id is null),
                 'subjects', coalesce(jsonb_agg(jsonb_build_object('subject_id', s.id, 'subject_name', s.name)
                                      order by s.name) filter (where s.id is not null), '[]'::jsonb),
                 'students', (select count(*) from public.students st
                              where st.current_class_id = c.id and st.enrollment_status = 'active'),
                 'attendance_status', coalesce((select se.status from public.attendance_sessions se
                                                where se.class_id = c.id and se.attendance_date = p_date), 'not_started')
               ) as obj
        from public.teacher_assignments ta
        join public.classes c on c.id = ta.class_id
        left join public.subjects s on s.id = ta.subject_id
        where ta.teacher_id = (select auth.uid()) and ta.school_id = p_school_id
        group by c.id
      ) x
    ), '[]'::jsonb),
    'grade_tasks', coalesce((
      select jsonb_agg(to_jsonb(g)) from public.grade_entry_status(p_school_id, v_sem) g
      where exists (select 1 from public.teacher_assignments ta
                    where ta.teacher_id = (select auth.uid()) and ta.class_id = g.class_id and ta.subject_id = g.subject_id)
    ), '[]'::jsonb)
  );
end $$;

-- Super admin: platform-wide aggregates (no student PII)
create or replace function public.platform_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schools_total', (select count(*) from public.schools),
    'schools_active', (select count(*) from public.schools where status = 'active'),
    'schools_inactive', (select count(*) from public.schools where status <> 'active'),
    'students_active', (select count(*) from public.students where enrollment_status = 'active'),
    'registered_current', (select count(*) from public.student_enrollments e
                           join public.semesters s on s.id = e.semester_id
                           where s.is_current and e.status <> 'voided'),
    'teachers', (select count(*) from public.school_memberships where role = 'teacher' and status = 'active'),
    'billing_current', (
      select jsonb_build_object(
        'records', count(*), 'due', coalesce(sum(b.amount_due), 0), 'paid', coalesce(sum(b.amount_paid), 0),
        'balance', coalesce(sum(b.balance), 0),
        'renewed', count(*) filter (where b.amount_due > 0 and b.balance <= 0),
        'pending', count(*) filter (where b.balance > 0 and (b.due_date is null or b.due_date >= current_date)),
        'overdue', count(*) filter (where b.balance > 0 and b.due_date < current_date))
      from public.semester_billing b join public.semesters s on s.id = b.semester_id where s.is_current),
    'schools_without_billing', (
      select count(*) from public.schools sc
      join public.semesters s on s.school_id = sc.id and s.is_current
      where sc.status = 'active' and not exists (select 1 from public.semester_billing b where b.semester_id = s.id)),
    'recent_activity', coalesce((
      select jsonb_agg(x) from (
        select a.id, a.created_at, a.action, a.entity_type, a.actor_role, sc.name as school_name,
               coalesce(nullif(p.full_name, ''), p.email) as actor_name
        from public.audit_logs a
        left join public.schools sc on sc.id = a.school_id
        left join public.profiles p on p.id = a.actor_id
        order by a.created_at desc limit 12) x), '[]'::jsonb)
  );
end $$;

create or replace function public.platform_school_summaries()
returns table (
  school_id uuid, name text, code text, status text, region text, created_at timestamptz,
  headmasters text, teachers integer, students_active integer,
  current_semester_id uuid, current_semester text, registered_current integer,
  billing_id uuid, amount_due numeric, amount_paid numeric, balance numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select sc.id, sc.name, sc.code, sc.status, sc.region, sc.created_at,
         (select string_agg(coalesce(nullif(p.full_name, ''), p.email), ', ')
            from public.school_memberships m join public.profiles p on p.id = m.user_id
           where m.school_id = sc.id and m.role = 'headmaster' and m.status = 'active'),
         (select count(*) from public.school_memberships m where m.school_id = sc.id and m.role = 'teacher' and m.status = 'active')::int,
         (select count(*) from public.students st where st.school_id = sc.id and st.enrollment_status = 'active')::int,
         se.id, se.name,
         (select count(*) from public.student_enrollments e where e.semester_id = se.id and e.status <> 'voided')::int,
         b.id, b.amount_due, b.amount_paid, b.balance
  from public.schools sc
  left join public.semesters se on se.school_id = sc.id and se.is_current
  left join public.semester_billing b on b.semester_id = se.id
  order by sc.name;
end $$;

-- ---------------------------------------------------------------------------
-- Billing (super admin)
-- ---------------------------------------------------------------------------
-- Billable = DISTINCT students with a non-voided registration in the semester.
create or replace function public.billable_student_count(p_semester_id uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.semesters where id = p_semester_id;
  if v_school is null then return 0; end if;
  if not (private.is_super_admin() or private.is_member_any_school_status(v_school, array['headmaster'])) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return (select count(distinct student_id) from public.student_enrollments
          where semester_id = p_semester_id and status <> 'voided');
end $$;

create or replace function public.upsert_semester_billing(p_semester_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_school uuid; v_start date; v_count integer; v_settings record; v_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'Only the platform super admin can generate billing' using errcode = '42501';
  end if;
  select school_id, starts_on into v_school, v_start from public.semesters where id = p_semester_id;
  if v_school is null then
    raise exception 'Semester not found' using errcode = 'P0002';
  end if;
  v_count := public.billable_student_count(p_semester_id);
  select price_per_student, currency, billing_due_days into v_settings from public.platform_settings where id;

  insert into public.semester_billing (school_id, semester_id, student_count, price_per_student, currency, due_date, last_calculated_at)
  values (v_school, p_semester_id, v_count, v_settings.price_per_student, v_settings.currency,
          greatest(v_start, current_date) + v_settings.billing_due_days, now())
  on conflict (semester_id) do update
    set student_count = excluded.student_count, last_calculated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Generate/refresh billing for every active school's current semester
create or replace function public.refresh_current_billing()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if not private.is_super_admin() then
    raise exception 'Only the platform super admin can generate billing' using errcode = '42501';
  end if;
  for r in select s.id from public.semesters s join public.schools sc on sc.id = s.school_id
           where s.is_current and sc.status = 'active' loop
    perform public.upsert_semester_billing(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.update_billing_terms(
  p_billing_id uuid, p_price_per_student numeric default null, p_due_date date default null, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_price_per_student is not null and p_price_per_student < 0 then
    raise exception 'Price cannot be negative' using errcode = '23514';
  end if;
  update public.semester_billing
     set price_per_student = coalesce(p_price_per_student, price_per_student),
         due_date = coalesce(p_due_date, due_date),
         notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = p_billing_id;
  if not found then raise exception 'Billing record not found' using errcode = 'P0002'; end if;
end $$;

create or replace function public.record_payment(
  p_billing_id uuid, p_amount numeric, p_method text, p_reference text default null,
  p_paid_on date default current_date, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_school uuid; v_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'Only an authorised platform administrator can record payments' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '23514';
  end if;
  if p_paid_on > current_date then
    raise exception 'Payment date cannot be in the future' using errcode = '23514';
  end if;
  select school_id into v_school from public.semester_billing where id = p_billing_id;
  if v_school is null then raise exception 'Billing record not found' using errcode = 'P0002'; end if;
  insert into public.payments (school_id, billing_id, amount, method, reference, paid_on, notes, verification, recorded_by)
  values (v_school, p_billing_id, round(p_amount, 2), p_method, nullif(btrim(p_reference), ''), p_paid_on,
          nullif(btrim(p_notes), ''), 'recorded_by_admin', (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to void a payment' using errcode = '23514';
  end if;
  update public.payments set status = 'voided', void_reason = left(btrim(p_reason), 300),
         voided_at = now(), voided_by = (select auth.uid())
   where id = p_payment_id and status = 'valid';
  if not found then raise exception 'Payment not found or already voided' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Views (security_invoker => caller's RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.billing_overview with (security_invoker = true) as
select b.id, b.school_id, sc.name as school_name, sc.code as school_code, sc.status as school_status,
       b.semester_id, se.name as semester_name, ay.name as academic_year_name, se.is_current,
       b.student_count, b.price_per_student, b.currency, b.amount_due, b.amount_paid, b.balance,
       b.due_date, b.notes, b.last_calculated_at, b.created_at,
       case when b.amount_due = 0 then 'no_charge'
            when b.amount_paid <= 0 then 'unpaid'
            when b.amount_paid < b.amount_due then 'partial'
            when b.amount_paid = b.amount_due then 'paid'
            else 'overpaid' end as payment_status,
       case when b.amount_due = 0 then 'not_applicable'
            when b.balance <= 0 then 'renewed'
            when b.due_date is not null and b.due_date < current_date then 'overdue'
            else 'pending' end as renewal_status
from public.semester_billing b
join public.schools sc on sc.id = b.school_id
join public.semesters se on se.id = b.semester_id
join public.academic_years ay on ay.id = se.academic_year_id;

grant select on public.billing_overview to authenticated;
revoke all on public.billing_overview from anon;

-- ---------------------------------------------------------------------------
-- Function privileges: authenticated only (never anon)
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
