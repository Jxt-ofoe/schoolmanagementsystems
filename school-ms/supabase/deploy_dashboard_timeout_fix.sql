-- =============================================================================
-- DEPLOY DASHBOARD PERFORMANCE FIX & INDEXES TO SUPABASE
-- Run this script in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- This permanently fixes "canceling statement due to statement timeout"
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Performance Indexes for 60,000+ Students & High Concurrency
-- -----------------------------------------------------------------------------

create index if not exists students_school_enrollment_class_idx
  on public.students (school_id, enrollment_status, current_class_id);

create index if not exists student_enrollments_school_sem_status_idx
  on public.student_enrollments (school_id, semester_id, status);

create index if not exists assessments_school_sem_class_subj_idx
  on public.assessments (school_id, semester_id, class_id, subject_id);

create index if not exists scores_school_assessment_idx
  on public.scores (school_id, assessment_id);

create index if not exists semesters_is_current_idx
  on public.semesters (id) where is_current;


-- -----------------------------------------------------------------------------
-- 2. Optimized grade_entry_status (CTEs instead of correlated subqueries)
-- -----------------------------------------------------------------------------
create or replace function public.grade_entry_status(p_school_id uuid, p_semester_id uuid)
returns table (
  class_id uuid,
  class_name text,
  subject_id uuid,
  subject_name text,
  teacher_names text,
  assessments integer,
  weight_total numeric,
  students integer,
  scores_entered integer,
  scores_expected integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Authorization check
  if not (private.is_headmaster(p_school_id) or private.is_member(p_school_id) or private.is_super_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  with
    -- 1. Count active students per class in this school (single grouped scan)
    class_students as (
      select st.current_class_id as cid, count(*)::int as active_students
      from public.students st
      where st.school_id = p_school_id
        and st.enrollment_status = 'active'
        and st.current_class_id is not null
      group by st.current_class_id
    ),
    -- 2. Aggregate assessments count & total weight for this school & semester
    assessment_stats as (
      select a.class_id as cid, a.subject_id as sid,
             count(*)::int as assessments_count,
             coalesce(sum(a.weight), 0)::numeric as weight_sum
      from public.assessments a
      where a.school_id = p_school_id and a.semester_id = p_semester_id
      group by a.class_id, a.subject_id
    ),
    -- 3. Aggregate scores entered
    score_stats as (
      select a.class_id as cid, a.subject_id as sid,
             count(sc.id)::int as scores_entered_count
      from public.assessments a
      join public.scores sc on sc.assessment_id = a.id and sc.school_id = p_school_id
      where a.school_id = p_school_id and a.semester_id = p_semester_id
      group by a.class_id, a.subject_id
    ),
    -- 4. Teacher names per class & subject
    cs as (
      select ta.class_id as cid, ta.subject_id as sid,
             string_agg(distinct coalesce(nullif(p.full_name, ''), p.email), ', ') as teachers
      from public.teacher_assignments ta
      left join public.profiles p on p.id = ta.teacher_id
      where ta.school_id = p_school_id and ta.subject_id is not null
      group by ta.class_id, ta.subject_id
    )
  select
    c.id as class_id,
    private.class_label(c.name, c.section) as class_name,
    s.id as subject_id,
    s.name as subject_name,
    cs.teachers,
    coalesce(ast.assessments_count, 0)::int as assessments,
    coalesce(ast.weight_sum, 0)::numeric as weight_total,
    coalesce(cst.active_students, 0)::int as students,
    coalesce(sst.scores_entered_count, 0)::int as scores_entered,
    (coalesce(ast.assessments_count, 0) * coalesce(cst.active_students, 0))::int as scores_expected
  from cs
  join public.classes c on c.id = cs.cid
  join public.subjects s on s.id = cs.sid
  left join class_students cst on cst.cid = c.id
  left join assessment_stats ast on ast.cid = c.id and ast.sid = s.id
  left join score_stats sst on sst.cid = c.id and sst.sid = s.id
  order by c.level_order, c.name, s.name;
end;
$$;

grant execute on function public.grade_entry_status(uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 3. Optimized headmaster_dashboard (Single pass aggregation + SECURITY DEFINER)
-- -----------------------------------------------------------------------------
create or replace function public.headmaster_dashboard(p_school_id uuid, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_sem record;
  v_result jsonb;
  v_students_active integer;
  v_students_total integer;
  v_students_unplaced integer;
  v_teachers integer;
  v_classes integer;
  v_subjects integer;
  v_registered_this_semester integer;
  v_attendance_today jsonb;
  v_attendance_trend jsonb;
  v_grade_entry jsonb;
begin
  if not (private.is_headmaster(p_school_id) or private.is_super_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select id, name, starts_on, ends_on into v_sem
  from public.semesters
  where school_id = p_school_id and is_current
  limit 1;

  -- 1. Student counts in single pass using conditional aggregation
  select
    count(*) filter (where enrollment_status = 'active'),
    count(*),
    count(*) filter (where enrollment_status = 'active' and current_class_id is null)
  into v_students_active, v_students_total, v_students_unplaced
  from public.students
  where school_id = p_school_id;

  -- 2. Staff, classes, subjects
  select count(*) into v_teachers
  from public.school_memberships
  where school_id = p_school_id and role = 'teacher' and status = 'active';

  select count(*) into v_classes
  from public.classes
  where school_id = p_school_id and is_active;

  select count(*) into v_subjects
  from public.subjects
  where school_id = p_school_id and is_active;

  -- 3. Enrollments for current semester
  if v_sem.id is not null then
    select count(*) into v_registered_this_semester
    from public.student_enrollments
    where school_id = p_school_id and semester_id = v_sem.id and status <> 'voided';
  else
    v_registered_this_semester := 0;
  end if;

  -- 4. Attendance today
  select jsonb_build_object(
    'classes', count(*),
    'submitted', count(*) filter (where se.status = 'submitted'),
    'draft', count(*) filter (where se.status = 'draft'),
    'not_started', count(*) filter (where se.id is null))
  into v_attendance_today
  from public.classes c
  left join public.attendance_sessions se on se.class_id = c.id and se.attendance_date = p_date and se.school_id = p_school_id
  where c.school_id = p_school_id and c.is_active;

  -- 5. Attendance trend (last 14 days) in single grouped query
  with date_range as (
    select generate_series(p_date - 13, p_date, interval '1 day')::date as day
  ),
  att_summary as (
    select
      r.attendance_date as day,
      count(*) as marked,
      case when count(*) filter (where r.status <> 'excused') = 0 then null
           else round(100.0 * count(*) filter (where r.status in ('present','late'))
                      / count(*) filter (where r.status <> 'excused'), 1) end as rate
    from public.attendance_records r
    where r.school_id = p_school_id
      and r.attendance_date between (p_date - 13) and p_date
    group by r.attendance_date
  )
  select coalesce(jsonb_agg(
    jsonb_build_object('date', dr.day, 'marked', coalesce(a.marked, 0), 'rate', a.rate)
    order by dr.day
  ), '[]'::jsonb)
  into v_attendance_trend
  from date_range dr
  left join att_summary a on a.day = dr.day;

  -- 6. Grade entry summary
  if v_sem.id is not null then
    select jsonb_build_object(
      'assignments', count(*),
      'with_assessments', count(*) filter (where g.assessments > 0),
      'scores_entered', coalesce(sum(g.scores_entered), 0),
      'scores_expected', coalesce(sum(g.scores_expected), 0)
    )
    into v_grade_entry
    from public.grade_entry_status(p_school_id, v_sem.id) g;
  else
    v_grade_entry := jsonb_build_object('assignments', 0, 'with_assessments', 0, 'scores_entered', 0, 'scores_expected', 0);
  end if;

  v_result := jsonb_build_object(
    'students_active', coalesce(v_students_active, 0),
    'students_total',  coalesce(v_students_total, 0),
    'students_unplaced', coalesce(v_students_unplaced, 0),
    'teachers',  coalesce(v_teachers, 0),
    'classes',   coalesce(v_classes, 0),
    'subjects',  coalesce(v_subjects, 0),
    'current_semester', case when v_sem.id is null then null else jsonb_build_object(
        'id', v_sem.id, 'name', v_sem.name, 'starts_on', v_sem.starts_on, 'ends_on', v_sem.ends_on) end,
    'registered_this_semester', coalesce(v_registered_this_semester, 0),
    'attendance_today', coalesce(v_attendance_today, jsonb_build_object('classes', 0, 'submitted', 0, 'draft', 0, 'not_started', 0)),
    'attendance_trend', coalesce(v_attendance_trend, '[]'::jsonb),
    'grade_entry', coalesce(v_grade_entry, jsonb_build_object('assignments', 0, 'with_assessments', 0, 'scores_entered', 0, 'scores_expected', 0))
  );

  return v_result;
end;
$$;

grant execute on function public.headmaster_dashboard(uuid, date) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 4. Optimized teacher_dashboard
-- -----------------------------------------------------------------------------
create or replace function public.teacher_dashboard(p_school_id uuid, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_sem uuid;
  v_sem_name text;
begin
  if not (private.is_headmaster(p_school_id) or private.is_member(p_school_id) or private.is_super_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select id, name into v_sem, v_sem_name
  from public.semesters
  where school_id = p_school_id and is_current
  limit 1;

  return jsonb_build_object(
    'current_semester_id', v_sem,
    'current_semester', v_sem_name,
    'classes', coalesce((
      select jsonb_agg(x.obj order by x.level_order, x.class_name)
      from (
        select c.level_order, private.class_label(c.name, c.section) as class_name,
               jsonb_build_object(
                 'class_id', c.id, 'class_name', private.class_label(c.name, c.section),
                 'is_class_teacher', bool_or(ta.subject_id is null),
                 'subjects', coalesce(jsonb_agg(jsonb_build_object('subject_id', s.id, 'subject_name', s.name)
                                      order by s.name) filter (where s.id is not null), '[]'::jsonb),
                 'students', coalesce(cst.active_students, 0),
                 'attendance_status', coalesce(se.status, 'not_started')
               ) as obj
        from public.teacher_assignments ta
        join public.classes c on c.id = ta.class_id
        left join public.subjects s on s.id = ta.subject_id
        left join lateral (
          select count(*)::int as active_students
          from public.students st
          where st.school_id = p_school_id and st.current_class_id = c.id and st.enrollment_status = 'active'
        ) cst on true
        left join public.attendance_sessions se on se.class_id = c.id and se.attendance_date = p_date and se.school_id = p_school_id
        where ta.teacher_id = auth.uid() and ta.school_id = p_school_id
        group by c.id, c.level_order, c.name, c.section, cst.active_students, se.status
      ) x
    ), '[]'::jsonb),
    'grade_tasks', coalesce((
      select jsonb_agg(to_jsonb(g))
      from public.grade_entry_status(p_school_id, v_sem) g
      where exists (
        select 1 from public.teacher_assignments ta
        where ta.teacher_id = auth.uid() and ta.school_id = p_school_id
          and ta.class_id = g.class_id and ta.subject_id = g.subject_id
      )
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.teacher_dashboard(uuid, date) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. Optimized platform_dashboard
-- -----------------------------------------------------------------------------
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
    'registered_current', (
      select count(*)
      from public.student_enrollments e
      where e.status <> 'voided'
        and exists (select 1 from public.semesters s where s.id = e.semester_id and s.is_current)
    ),
    'teachers', (select count(*) from public.school_memberships where role = 'teacher' and status = 'active'),
    'billing_current', (
      select jsonb_build_object(
        'records', count(*),
        'due', coalesce(sum(b.amount_due), 0),
        'paid', coalesce(sum(b.amount_paid), 0),
        'balance', coalesce(sum(b.balance), 0),
        'renewed', count(*) filter (where b.amount_due > 0 and b.balance <= 0),
        'pending', count(*) filter (where b.balance > 0 and (b.due_date is null or b.due_date >= current_date)),
        'overdue', count(*) filter (where b.balance > 0 and b.due_date < current_date))
      from public.semester_billing b
      join public.semesters s on s.id = b.semester_id
      where s.is_current),
    'schools_without_billing', (
      select count(*)
      from public.schools sc
      join public.semesters s on s.school_id = sc.id and s.is_current
      where sc.status = 'active'
        and not exists (select 1 from public.semester_billing b where b.semester_id = s.id)),
    'recent_activity', coalesce((
      select jsonb_agg(x) from (
        select a.id, a.created_at, a.action, a.entity_type, a.actor_role, sc.name as school_name,
               coalesce(nullif(p.full_name, ''), p.email) as actor_name
        from public.audit_logs a
        left join public.schools sc on sc.id = a.school_id
        left join public.profiles p on p.id = a.actor_id
        order by a.created_at desc limit 12) x), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.platform_dashboard() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 6. Instant School Fees Summary RPC
-- -----------------------------------------------------------------------------
create or replace function public.school_dashboard_fees_summary(p_school_id uuid, p_semester_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_structures jsonb;
  v_total_charged numeric(14,2) := 0;
  v_total_discounted numeric(14,2) := 0;
  v_total_paid numeric(14,2) := 0;
  v_charges_count integer := 0;
  v_structures_count integer := 0;
begin
  if not (private.is_headmaster(p_school_id) or private.is_member(p_school_id) or private.is_super_admin()) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'amount', amount)), '[]'::jsonb),
         count(*)
  into v_structures, v_structures_count
  from public.fee_structures
  where school_id = p_school_id and semester_id = p_semester_id;

  select coalesce(sum(amount), 0), coalesce(sum(discount_amount), 0), count(*)
  into v_total_charged, v_total_discounted, v_charges_count
  from public.student_fee_charges
  where school_id = p_school_id and semester_id = p_semester_id;

  select coalesce(sum(amount), 0)
  into v_total_paid
  from public.student_fee_payments
  where school_id = p_school_id and semester_id = p_semester_id and status = 'valid';

  return jsonb_build_object(
    'structuresCount', v_structures_count,
    'structures', v_structures,
    'totalCharged', v_total_charged,
    'totalDiscounted', v_total_discounted,
    'netCharged', greatest(0, v_total_charged - v_total_discounted),
    'totalPaid', v_total_paid,
    'balance', greatest(0, (v_total_charged - v_total_discounted) - v_total_paid),
    'hasCharges', (v_charges_count > 0)
  );
end;
$$;

grant execute on function public.school_dashboard_fees_summary(uuid, uuid) to authenticated, service_role;

