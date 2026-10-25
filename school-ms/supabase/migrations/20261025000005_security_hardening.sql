-- =============================================================================
-- School Management System — Migration 5: Security Hardening & Integrity Fixes
-- -----------------------------------------------------------------------------
-- Addresses:
--  * F-03: Profiles email lock (prevents unauthorized profile email manipulation)
--  * F-05: Server-side registration timestamp & actor enforcement
--  * F-07: Attendance session reopening restriction & attribution lock
--  * F-09: Attribution field immutability on students, assessments, and scores
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profiles: prevent direct email and ID tampering (F-03)
-- -----------------------------------------------------------------------------
create or replace function private.validate_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id <> old.id then
    raise exception 'Profile ID cannot be changed' using errcode = '42501';
  end if;
  -- Only auth-sync trigger or super admin can change email on profiles
  if new.email is distinct from old.email and not (select private.is_super_admin()) then
    raise exception 'Email address cannot be changed directly on profile' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists validate_profile_update on public.profiles;
create trigger validate_profile_update
  before update on public.profiles
  for each row execute function private.validate_profile_update();

-- -----------------------------------------------------------------------------
-- 2. Enrollments: enforce server timestamp and auth.uid() on INSERT (F-05)
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
    -- Unless super admin is performing audited backfill, enforce now() and auth.uid()
    if not (select private.is_super_admin()) then
      new.registered_at := now();
      new.registered_by := (select auth.uid());
    else
      new.registered_at := coalesce(new.registered_at, now());
      new.registered_by := coalesce(new.registered_by, (select auth.uid()));
    end if;
    new.is_late := v_deadline is not null and (new.registered_at at time zone 'UTC')::date > v_deadline;
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
      if now() > old.registered_at + make_interval(days => v_grace) and not (select private.is_super_admin()) then
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

-- -----------------------------------------------------------------------------
-- 3. Attendance sessions: restrict draft reset to headmaster and lock attribution (F-07)
-- -----------------------------------------------------------------------------
create or replace function private.validate_attendance_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.attendance_date > current_date then
    raise exception 'Attendance cannot be recorded for a future date' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.taken_by := coalesce((select auth.uid()), new.taken_by);
  end if;
  if tg_op = 'UPDATE' then
    if (new.class_id <> old.class_id or new.attendance_date <> old.attendance_date) then
      raise exception 'Attendance class and date cannot be changed' using errcode = '42501';
    end if;
    -- Only headmaster can reopen a submitted session
    if old.status = 'submitted' and new.status = 'draft' and not private.is_headmaster(old.school_id) then
      raise exception 'Only the headmaster can reopen a submitted attendance register' using errcode = '42501';
    end if;
    new.taken_by := old.taken_by;
    if old.submitted_at is not null then
      new.submitted_at := old.submitted_at;
    end if;
  end if;
  if new.status = 'submitted' and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Attribution locks for students, assessments, and scores (F-09)
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
    new.created_by := coalesce((select auth.uid()), new.created_by);
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

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
    new.created_by := old.created_by;
  else
    new.created_by := coalesce((select auth.uid()), new.created_by);
  end if;
  return new;
end $$;

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
  if tg_op = 'UPDATE' then
    new.entered_by := old.entered_by;
  end if;
  return new;
end $$;
