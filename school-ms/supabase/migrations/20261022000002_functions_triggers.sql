-- =============================================================================
-- Migration 2: authorization helpers, integrity triggers, audit logging
-- All helpers live in schema "private" (not exposed through the REST API).
-- SECURITY DEFINER helpers always pin search_path = '' and fully-qualify names.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helpers (used by RLS policies)
-- -----------------------------------------------------------------------------
create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

-- Active membership with one of the roles, in a school that is ACTIVE.
create or replace function private.has_school_role(p_school_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.school_memberships m
    join public.schools s on s.id = m.school_id
    where m.school_id = p_school_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = any (p_roles)
      and s.status = 'active'
  );
$$;

create or replace function private.is_headmaster(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_school_role(p_school_id, array['headmaster']);
$$;

create or replace function private.is_member(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_school_role(p_school_id, array['headmaster','teacher']);
$$;

-- Active membership regardless of school status (lets a headmaster of a suspended
-- school still read the school profile and its billing so they can settle it).
create or replace function private.is_member_any_school_status(p_school_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.school_memberships m
    where m.school_id = p_school_id and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any (p_roles)
  );
$$;

-- Teacher has ANY assignment (class teacher or subject teacher) for this class.
create or replace function private.teaches_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    join public.school_memberships m on m.school_id = ta.school_id and m.user_id = ta.teacher_id
    join public.schools s on s.id = ta.school_id
    where ta.class_id = p_class_id
      and ta.teacher_id = (select auth.uid())
      and m.status = 'active' and m.role = 'teacher'
      and s.status = 'active'
  );
$$;

create or replace function private.teaches_subject(p_class_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    join public.school_memberships m on m.school_id = ta.school_id and m.user_id = ta.teacher_id
    join public.schools s on s.id = ta.school_id
    where ta.class_id = p_class_id
      and ta.subject_id = p_subject_id
      and ta.teacher_id = (select auth.uid())
      and m.status = 'active' and m.role = 'teacher'
      and s.status = 'active'
  );
$$;

create or replace function private.class_school(p_class_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.classes where id = p_class_id;
$$;

create or replace function private.can_access_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_headmaster(private.class_school(p_class_id)) or private.teaches_class(p_class_id);
$$;

create or replace function private.can_manage_subject_grades(p_class_id uuid, p_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_headmaster(private.class_school(p_class_id)) or private.teaches_subject(p_class_id, p_subject_id);
$$;

create or replace function private.can_grade_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.can_manage_subject_grades(a.class_id, a.subject_id)
    from public.assessments a where a.id = p_assessment_id
  ), false);
$$;

-- A teacher may see a student who is currently placed in one of their classes.
create or replace function private.can_access_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_headmaster(s.school_id)
        or (s.current_class_id is not null and private.teaches_class(s.current_class_id))
    from public.students s where s.id = p_student_id
  ), false);
$$;

create or replace function private.current_actor_role(p_school_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then 'system'
    when private.is_super_admin() then 'super_admin'
    else coalesce(
      (select m.role from public.school_memberships m
        where m.user_id = (select auth.uid()) and m.school_id = p_school_id limit 1),
      'unknown')
  end;
$$;

-- -----------------------------------------------------------------------------
-- Generic triggers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.prevent_school_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.school_id is distinct from old.school_id then
    raise exception 'Records cannot be moved between schools' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'platform_settings','profiles','schools','school_memberships','academic_years','semesters',
    'classes','subjects','teacher_assignments','students','student_enrollments',
    'attendance_sessions','attendance_records','grading_scales','grading_scale_bands',
    'assessments','scores','semester_billing','payments']
  loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
  foreach t in array array[
    'school_memberships','academic_years','semesters','classes','subjects','teacher_assignments',
    'students','student_class_history','student_enrollments','attendance_sessions','attendance_records',
    'grading_scales','grading_scale_bands','assessments','scores','semester_billing','payments']
  loop
    execute format('create trigger prevent_school_change before update of school_id on public.%I
                    for each row execute function private.prevent_school_change()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Auth integration: profile row for every auth user
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Schools: only super admins may change status/code; default grading scale
-- -----------------------------------------------------------------------------
create or replace function private.guard_school_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.status is distinct from old.status or new.code is distinct from old.code)
     and (select auth.uid()) is not null and not private.is_super_admin() then
    raise exception 'Only the platform super admin can change a school''s status or code' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_school_update before update on public.schools
  for each row execute function private.guard_school_update();

create or replace function private.create_default_grading_scale()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_scale uuid;
begin
  insert into public.grading_scales (school_id, name, is_default)
  values (new.id, 'Default scale', true) returning id into v_scale;
  insert into public.grading_scale_bands (school_id, scale_id, min_score, max_score, grade, remark, grade_point) values
    (new.id, v_scale, 80, 100,   'A', 'Excellent',  4.0),
    (new.id, v_scale, 70, 79.99, 'B', 'Very good',  3.5),
    (new.id, v_scale, 60, 69.99, 'C', 'Good',       3.0),
    (new.id, v_scale, 50, 59.99, 'D', 'Credit',     2.5),
    (new.id, v_scale, 40, 49.99, 'E', 'Pass',       2.0),
    (new.id, v_scale, 0,  39.99, 'F', 'Fail',       0.0);
  return new;
end $$;

create trigger create_default_grading_scale after insert on public.schools
  for each row execute function private.create_default_grading_scale();

-- -----------------------------------------------------------------------------
-- Membership guards
-- -----------------------------------------------------------------------------
create or replace function private.guard_membership_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Membership user cannot be changed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role and (select auth.uid()) is not null and not private.is_super_admin() then
    raise exception 'Only the platform super admin can change a member''s role' using errcode = '42501';
  end if;
  if new.user_id = (select auth.uid()) and new.status = 'disabled' then
    raise exception 'You cannot disable your own account' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger guard_membership_update before update on public.school_memberships
  for each row execute function private.guard_membership_update();

create or replace function private.validate_teacher_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.school_memberships
    where school_id = new.school_id and user_id = new.teacher_id and role = 'teacher' and status = 'active'
  ) then
    raise exception 'Assignments can only be made to active teachers of this school' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger validate_teacher_assignment before insert or update on public.teacher_assignments
  for each row execute function private.validate_teacher_assignment();

-- -----------------------------------------------------------------------------
-- Students: class transfer history + enrollment status propagation
-- -----------------------------------------------------------------------------
create or replace function private.validate_student()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.admission_number := upper(btrim(new.admission_number));
  if new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception 'Date of birth cannot be in the future' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  return new;
end $$;

create trigger validate_student before insert or update on public.students
  for each row execute function private.validate_student();

create or replace function private.track_student_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_current_semester uuid;
begin
  select id into v_current_semester from public.semesters where school_id = new.school_id and is_current;

  if new.current_class_id is distinct from old.current_class_id then
    insert into public.student_class_history (school_id, student_id, from_class_id, to_class_id, reason, moved_by)
    values (new.school_id, new.id, old.current_class_id, new.current_class_id,
            nullif(current_setting('app.transfer_reason', true), ''), (select auth.uid()));
    -- keep the current semester registration pointing at the new class
    if v_current_semester is not null and new.current_class_id is not null then
      update public.student_enrollments set class_id = new.current_class_id
      where student_id = new.id and semester_id = v_current_semester and status = 'registered';
    end if;
  end if;

  if new.enrollment_status is distinct from old.enrollment_status
     and new.enrollment_status in ('withdrawn','transferred_out')
     and v_current_semester is not null then
    -- The registration stays billable (see BILLING_POLICY.md) but is marked.
    update public.student_enrollments
       set status = new.enrollment_status, status_changed_at = now(),
           status_reason = coalesce(nullif(current_setting('app.transfer_reason', true), ''), 'Student ' || new.enrollment_status)
     where student_id = new.id and semester_id = v_current_semester and status = 'registered';
  end if;
  return new;
end $$;

create trigger track_student_changes after update on public.students
  for each row execute function private.track_student_changes();

-- -----------------------------------------------------------------------------
-- Enrollments: late flag, void grace period, immutability of key fields
-- -----------------------------------------------------------------------------
create or replace function private.validate_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_deadline date; v_grace int; v_status text;
begin
  if tg_op = 'INSERT' then
    select registration_deadline, status into v_deadline, v_status from public.semesters where id = new.semester_id;
    if v_status = 'closed' then
      raise exception 'Registration is closed for this semester' using errcode = '23514';
    end if;
    new.is_late := v_deadline is not null and (new.registered_at at time zone 'UTC')::date > v_deadline;
    new.registered_by := coalesce(new.registered_by, (select auth.uid()));
    if new.status <> 'registered' then
      raise exception 'New registrations must have status "registered"' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.student_id <> old.student_id or new.semester_id <> old.semester_id or new.registered_at <> old.registered_at then
    raise exception 'Registration student, semester and date cannot be changed' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'voided' then
      select void_grace_days into v_grace from public.platform_settings where id;
      if now() > old.registered_at + make_interval(days => v_grace) and not private.is_super_admin() then
        raise exception 'Registrations can only be voided within % days of registration', v_grace using errcode = '23514';
      end if;
      if coalesce(btrim(new.status_reason), '') = '' then
        raise exception 'A reason is required to void a registration' using errcode = '23514';
      end if;
    end if;
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create trigger validate_enrollment before insert or update on public.student_enrollments
  for each row execute function private.validate_enrollment();

-- -----------------------------------------------------------------------------
-- Attendance integrity
-- -----------------------------------------------------------------------------
create or replace function private.validate_attendance_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.attendance_date > current_date then
    raise exception 'Attendance cannot be recorded for a future date' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.class_id <> old.class_id or new.attendance_date <> old.attendance_date) then
    raise exception 'Attendance class and date cannot be changed' using errcode = '42501';
  end if;
  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end $$;

create trigger validate_attendance_session before insert or update on public.attendance_sessions
  for each row execute function private.validate_attendance_session();

create or replace function private.validate_attendance_record()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_session record;
begin
  select class_id, attendance_date into v_session from public.attendance_sessions where id = new.session_id;
  if v_session.class_id <> new.class_id or v_session.attendance_date <> new.attendance_date then
    raise exception 'Attendance record does not match its session' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.student_id <> old.student_id or new.class_id <> old.class_id
                          or new.attendance_date <> old.attendance_date) then
    raise exception 'Attendance student, class and date cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.students s where s.id = new.student_id and s.current_class_id = new.class_id
  ) then
    raise exception 'Student is not in this class' using errcode = '23514';
  end if;
  new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
  return new;
end $$;

create trigger validate_attendance_record before insert or update on public.attendance_records
  for each row execute function private.validate_attendance_record();

-- -----------------------------------------------------------------------------
-- Assessments & scores integrity
-- -----------------------------------------------------------------------------
create or replace function private.validate_assessment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_total numeric; v_max_existing numeric;
begin
  select coalesce(sum(weight), 0) into v_total
  from public.assessments
  where semester_id = new.semester_id and class_id = new.class_id and subject_id = new.subject_id
    and id <> new.id;
  if v_total + new.weight > 100 then
    raise exception 'Total assessment weight for this class and subject would be % (max 100)', v_total + new.weight
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.class_id <> old.class_id or new.subject_id <> old.subject_id or new.semester_id <> old.semester_id then
      raise exception 'Assessment class, subject and semester cannot be changed' using errcode = '42501';
    end if;
    select max(score) into v_max_existing from public.scores where assessment_id = new.id;
    if v_max_existing is not null and v_max_existing > new.max_score then
      raise exception 'Maximum mark cannot be lower than an existing score (%)', v_max_existing using errcode = '23514';
    end if;
  else
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  return new;
end $$;

create trigger validate_assessment before insert or update on public.assessments
  for each row execute function private.validate_assessment();

create or replace function private.validate_score()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a record;
begin
  select max_score, class_id, semester_id into v_a from public.assessments where id = new.assessment_id;
  if new.score < 0 or new.score > v_a.max_score then
    raise exception 'Score must be between 0 and %', v_a.max_score using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.assessment_id <> old.assessment_id or new.student_id <> old.student_id) then
    raise exception 'Score student and assessment cannot be changed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.students s
    where s.id = new.student_id
      and (s.current_class_id = v_a.class_id
           or exists (select 1 from public.student_enrollments e
                      where e.student_id = s.id and e.semester_id = v_a.semester_id
                        and e.class_id = v_a.class_id and e.status <> 'voided'))
  ) then
    raise exception 'Student is not in the assessment''s class' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.entered_by := coalesce((select auth.uid()), new.entered_by);
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;

create trigger validate_score before insert or update on public.scores
  for each row execute function private.validate_score();

-- -----------------------------------------------------------------------------
-- Billing: payments keep amount_paid in sync
-- -----------------------------------------------------------------------------
create or replace function private.sync_amount_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_billing uuid := coalesce(new.billing_id, old.billing_id);
begin
  update public.semester_billing b
     set amount_paid = coalesce((select sum(amount) from public.payments p
                                 where p.billing_id = v_billing and p.status = 'valid'), 0)
   where b.id = v_billing;
  return null;
end $$;

create trigger sync_amount_paid after insert or update or delete on public.payments
  for each row execute function private.sync_amount_paid();

create or replace function private.stamp_platform_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := (select auth.uid());
  return new;
end $$;

create trigger stamp_platform_settings before update on public.platform_settings
  for each row execute function private.stamp_platform_settings();

-- -----------------------------------------------------------------------------
-- Audit logging
-- Never logs secrets: auth tables are not audited and the excluded keys strip
-- derived/noise columns. Metadata holds only the changed business fields.
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entity   text := coalesce(tg_argv[0], tg_table_name);
  v_old      jsonb;
  v_new      jsonb;
  v_row      jsonb;
  v_changes  jsonb := '{}'::jsonb;
  v_key      text;
  v_meta     jsonb;
  v_school   uuid;
  v_action   text;
  v_excluded text[] := array['created_at','updated_at','search_text','last_calculated_at'];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old) - v_excluded; end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new) - v_excluded; end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;  -- nothing meaningful changed
    end if;
    v_meta := jsonb_build_object('changes', v_changes);
  elsif tg_op = 'INSERT' then
    v_meta := jsonb_build_object('new', v_new);
  else
    v_meta := jsonb_build_object('old', v_old);
  end if;

  v_school := case when tg_table_name = 'schools' then (v_row ->> 'id')::uuid
                   else (v_row ->> 'school_id')::uuid end;

  v_action := v_entity || '.' || lower(case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end);
  if tg_table_name = 'schools' and tg_op = 'UPDATE' and v_changes ? 'status' then
    v_action := 'school.status_changed';
  elsif tg_table_name = 'students' and tg_op = 'UPDATE' and v_changes ? 'current_class_id' then
    v_action := 'student.class_transferred';
  elsif tg_table_name = 'attendance_sessions' and v_new ->> 'status' = 'submitted'
        and (tg_op = 'INSERT' or v_changes ? 'status') then
    v_action := 'attendance.submitted';
  elsif tg_table_name = 'payments' and tg_op = 'UPDATE' and v_changes ? 'status' and v_new ->> 'status' = 'voided' then
    v_action := 'payment.voided';
  end if;

  insert into public.audit_logs (school_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (v_school, (select auth.uid()), private.current_actor_role(v_school), v_action, v_entity,
          v_row ->> case when tg_table_name = 'platform_admins' then 'user_id' else 'id' end, v_meta);
  return coalesce(new, old);
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('schools','school','insert or update or delete'),
    ('school_memberships','membership','insert or update or delete'),
    ('platform_settings','platform_settings','update'),
    ('platform_admins','platform_admin','insert or delete'),
    ('academic_years','academic_year','insert or update or delete'),
    ('semesters','semester','insert or update or delete'),
    ('classes','class','insert or update or delete'),
    ('subjects','subject','insert or update or delete'),
    ('teacher_assignments','teacher_assignment','insert or update or delete'),
    ('students','student','insert or update or delete'),
    ('student_enrollments','enrollment','insert or update or delete'),
    ('attendance_sessions','attendance','insert or update or delete'),
    ('attendance_records','attendance_record','update or delete'),   -- initial marks are summarised on the session
    ('grading_scale_bands','grading_band','insert or update or delete'),
    ('assessments','assessment','insert or update or delete'),
    ('scores','score','insert or update or delete'),
    ('semester_billing','billing','insert or update or delete'),
    ('payments','payment','insert or update or delete')
  ) as t(tbl, entity, events)
  loop
    execute format('create trigger audit_%s after %s on public.%I for each row execute function private.audit_row_change(%L)',
                   r.tbl, r.events, r.tbl, r.entity);
  end loop;
end $$;
