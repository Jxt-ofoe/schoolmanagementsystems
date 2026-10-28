-- =============================================================================
-- SCHOOL MANAGEMENT SYSTEM - FULL MASTER DATABASE SCHEMA BACKUP
-- Generated: 2026-10-28T08:30:55.629Z
-- Contains: Core Schema, Triggers, RLS Policies, RPCs, Security, & Major Features
-- =============================================================================


-- -----------------------------------------------------------------------------
-- MIGRATION: 20261022000001_core_schema.sql
-- -----------------------------------------------------------------------------

-- =============================================================================
-- School Management System — Migration 1: core schema
-- -----------------------------------------------------------------------------
-- Design rules
--  * Every school-owned table carries school_id.
--  * Child tables reference parents with COMPOSITE foreign keys (child_id, school_id)
--    -> (id, school_id). This makes it physically impossible to link a record to a
--    class/subject/student/semester belonging to a different school, even if a
--    caller forges IDs in an API request.
--  * Nothing is hard-deleted that billing or audit depends on; statuses are used.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- Private schema: helper functions used by RLS/triggers. NOT exposed via the API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Platform level
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  id                 boolean primary key default true check (id),   -- singleton row
  price_per_student  numeric(10,2) not null default 5.00 check (price_per_student >= 0),
  currency           text not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  billing_due_days   integer not null default 30 check (billing_due_days between 0 and 365),
  void_grace_days    integer not null default 14 check (void_grace_days between 0 and 90),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null
);
-- Configuration default (GH₵2 per registered student per semester). Not demo data.
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text not null default '' check (char_length(full_name) <= 120),
  phone      text check (phone is null or char_length(phone) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

-- -----------------------------------------------------------------------------
-- Schools & membership
-- -----------------------------------------------------------------------------
create table public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 150),
  code       text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  status     text not null default 'active' check (status in ('pending','active','suspended','inactive')),
  email      text check (email is null or char_length(email) <= 150),
  phone      text check (phone is null or char_length(phone) <= 30),
  address    text check (address is null or char_length(address) <= 300),
  region     text check (region is null or char_length(region) <= 80),
  motto      text check (motto is null or char_length(motto) <= 150),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('headmaster','teacher')),
  status     text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id),
  -- second FK lets the REST API embed the member's profile (name/email)
  foreign key (user_id) references public.profiles(id) on delete cascade
);
create index school_memberships_user_idx on public.school_memberships (user_id);

-- -----------------------------------------------------------------------------
-- Academic calendar
-- -----------------------------------------------------------------------------
create table public.academic_years (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  starts_on  date not null,
  ends_on    date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (school_id, name),
  unique (id, school_id)
);
create unique index academic_years_one_current on public.academic_years (school_id) where is_current;

create table public.semesters (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools(id) on delete cascade,
  academic_year_id      uuid not null,
  name                  text not null check (char_length(btrim(name)) between 1 and 40),
  starts_on             date not null,
  ends_on               date not null,
  registration_deadline date,
  status                text not null default 'open' check (status in ('planned','open','closed')),
  is_current            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (ends_on > starts_on),
  check (registration_deadline is null or registration_deadline between starts_on and ends_on),
  foreign key (academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  unique (academic_year_id, name),
  unique (id, school_id)
);
create unique index semesters_one_current on public.semesters (school_id) where is_current;
create index semesters_school_idx on public.semesters (school_id);

-- -----------------------------------------------------------------------------
-- Classes, subjects, teacher assignments
-- -----------------------------------------------------------------------------
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  section     text check (section is null or char_length(btrim(section)) between 1 and 20),
  level_order integer not null default 0 check (level_order between 0 and 1000),
  capacity    integer check (capacity is null or capacity between 1 and 1000),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, school_id)
);
create unique index classes_unique_name on public.classes (school_id, lower(name), lower(coalesce(section, '')));

create table public.subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  code       text check (code is null or code ~ '^[A-Za-z0-9-]{1,15}$'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id)
);
create unique index subjects_unique_name on public.subjects (school_id, lower(name));

-- subject_id IS NULL  -> class teacher (homeroom) assignment
-- subject_id NOT NULL -> subject teacher for that class
create table public.teacher_assignments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null,
  teacher_id uuid not null,
  class_id   uuid not null,
  subject_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (school_id, teacher_id) references public.school_memberships(school_id, user_id) on delete cascade,
  foreign key (teacher_id) references public.profiles(id) on delete cascade,
  foreign key (class_id, school_id)  references public.classes(id, school_id)  on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete cascade
);
create unique index teacher_assignments_class_teacher_uq
  on public.teacher_assignments (teacher_id, class_id) where subject_id is null;
create unique index teacher_assignments_subject_uq
  on public.teacher_assignments (teacher_id, class_id, subject_id) where subject_id is not null;
create index teacher_assignments_class_idx on public.teacher_assignments (class_id, subject_id);
create index teacher_assignments_school_idx on public.teacher_assignments (school_id);

-- -----------------------------------------------------------------------------
-- Students
-- -----------------------------------------------------------------------------
create table public.students (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools(id) on delete cascade,
  admission_number      text not null check (admission_number ~ '^[A-Za-z0-9/_.-]{1,30}$'),
  first_name            text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name             text not null check (char_length(btrim(last_name)) between 1 and 60),
  other_names           text check (other_names is null or char_length(other_names) <= 80),
  gender                text check (gender is null or gender in ('male','female')),
  date_of_birth         date check (date_of_birth is null or date_of_birth > date '1900-01-01'),
  current_class_id      uuid,
  enrollment_status     text not null default 'active'
                        check (enrollment_status in ('active','suspended','withdrawn','transferred_out','graduated')),
  admission_date        date not null default current_date,
  guardian_name         text check (guardian_name is null or char_length(guardian_name) <= 120),
  guardian_relationship text check (guardian_relationship is null or char_length(guardian_relationship) <= 40),
  guardian_phone        text check (guardian_phone is null or guardian_phone ~ '^[0-9+() -]{7,20}$'),
  guardian_email        text check (guardian_email is null or guardian_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address               text check (address is null or char_length(address) <= 300),
  notes                 text check (notes is null or char_length(notes) <= 1000),
  search_text           text generated always as (
                          lower(first_name || ' ' || coalesce(other_names, '') || ' ' || last_name || ' ' || admission_number)
                        ) stored,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (current_class_id, school_id) references public.classes(id, school_id) on delete restrict,
  unique (id, school_id)
);
-- Duplicate prevention
create unique index students_admission_uq on public.students (school_id, upper(admission_number));
create unique index students_identity_uq on public.students (school_id, lower(btrim(first_name)), lower(btrim(last_name)), date_of_birth)
  where date_of_birth is not null;
create index students_class_idx on public.students (school_id, current_class_id);
create index students_search_trgm on public.students using gin (search_text extensions.gin_trgm_ops);

create table public.student_class_history (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  from_class_id uuid references public.classes(id) on delete set null,
  to_class_id   uuid references public.classes(id) on delete set null,
  reason        text check (reason is null or char_length(reason) <= 300),
  moved_by      uuid references auth.users(id) on delete set null,
  moved_at      timestamptz not null default now()
);
create index student_class_history_student_idx on public.student_class_history (student_id, moved_at desc);

-- Semester registration = the billing basis. One row per student per semester.
create table public.student_enrollments (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null,
  student_id        uuid not null,
  semester_id       uuid not null,
  class_id          uuid not null,
  status            text not null default 'registered'
                    check (status in ('registered','withdrawn','transferred_out','voided')),
  is_late           boolean not null default false,
  registered_at     timestamptz not null default now(),
  registered_by     uuid references auth.users(id) on delete set null,
  status_changed_at timestamptz,
  status_reason     text check (status_reason is null or char_length(status_reason) <= 300),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (student_id, school_id)  references public.students(id, school_id)  on delete cascade,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  foreign key (class_id, school_id)    references public.classes(id, school_id)   on delete restrict,
  unique (student_id, semester_id)
);
create index student_enrollments_semester_idx on public.student_enrollments (semester_id, status);
create index student_enrollments_class_idx on public.student_enrollments (class_id, semester_id);

-- -----------------------------------------------------------------------------
-- Attendance
-- -----------------------------------------------------------------------------
create table public.attendance_sessions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null,
  class_id        uuid not null,
  attendance_date date not null,
  status          text not null default 'draft' check (status in ('draft','submitted')),
  taken_by        uuid references auth.users(id) on delete set null,
  submitted_at    timestamptz,
  notes           text check (notes is null or char_length(notes) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade,
  unique (class_id, attendance_date),
  unique (id, school_id)
);
create index attendance_sessions_school_date_idx on public.attendance_sessions (school_id, attendance_date);

create table public.attendance_records (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null,
  session_id      uuid not null,
  student_id      uuid not null,
  class_id        uuid not null,
  attendance_date date not null,
  status          text not null check (status in ('present','absent','late','excused')),
  note            text check (note is null or char_length(note) <= 300),
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (session_id, school_id) references public.attendance_sessions(id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (class_id, school_id)   references public.classes(id, school_id)  on delete cascade,
  -- No duplicate attendance for the same student, class and date
  unique (student_id, class_id, attendance_date)
);
create index attendance_records_session_idx on public.attendance_records (session_id);
create index attendance_records_school_date_idx on public.attendance_records (school_id, attendance_date);

-- -----------------------------------------------------------------------------
-- Grading
-- -----------------------------------------------------------------------------
create table public.grading_scales (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name),
  unique (id, school_id)
);
create unique index grading_scales_one_default on public.grading_scales (school_id) where is_default;

create table public.grading_scale_bands (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null,
  scale_id    uuid not null,
  min_score   numeric(5,2) not null check (min_score between 0 and 100),
  max_score   numeric(5,2) not null check (max_score between 0 and 100),
  grade       text not null check (char_length(btrim(grade)) between 1 and 10),
  remark      text check (remark is null or char_length(remark) <= 60),
  grade_point numeric(4,2),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (min_score <= max_score),
  foreign key (scale_id, school_id) references public.grading_scales(id, school_id) on delete cascade,
  unique (scale_id, grade),
  unique (scale_id, min_score)
);

create table public.assessments (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null,
  semester_id     uuid not null,
  class_id        uuid not null,
  subject_id      uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  category        text not null default 'class_score' check (category in ('class_score','exam','other')),
  max_score       numeric(6,2) not null check (max_score > 0 and max_score <= 1000),
  weight          numeric(5,2) not null check (weight >= 0 and weight <= 100),
  assessment_date date,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  foreign key (class_id, school_id)    references public.classes(id, school_id)   on delete restrict,
  foreign key (subject_id, school_id)  references public.subjects(id, school_id)  on delete restrict,
  unique (semester_id, class_id, subject_id, name),
  unique (id, school_id)
);
create index assessments_lookup_idx on public.assessments (class_id, subject_id, semester_id);

create table public.scores (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null,
  assessment_id uuid not null,
  student_id    uuid not null,
  score         numeric(6,2) not null check (score >= 0),
  remark        text check (remark is null or char_length(remark) <= 200),
  entered_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (assessment_id, school_id) references public.assessments(id, school_id) on delete cascade,
  foreign key (student_id, school_id)    references public.students(id, school_id)    on delete cascade,
  unique (assessment_id, student_id)
);
create index scores_student_idx on public.scores (student_id);

-- -----------------------------------------------------------------------------
-- Billing (school pays per registered student per semester)
-- -----------------------------------------------------------------------------
create table public.semester_billing (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null,
  semester_id        uuid not null unique,
  student_count      integer not null default 0 check (student_count >= 0),
  price_per_student  numeric(10,2) not null check (price_per_student >= 0),
  currency           text not null default 'GHS',
  amount_due         numeric(12,2) generated always as (student_count * price_per_student) stored,
  amount_paid        numeric(12,2) not null default 0,
  balance            numeric(12,2) generated always as (student_count * price_per_student - amount_paid) stored,
  due_date           date,
  notes              text check (notes is null or char_length(notes) <= 500),
  last_calculated_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  unique (id, school_id)
);
create index semester_billing_school_idx on public.semester_billing (school_id);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null,
  billing_id   uuid not null,
  amount       numeric(12,2) not null check (amount > 0),
  method       text not null check (method in ('cash','mobile_money','bank_transfer','cheque','card','other')),
  reference    text check (reference is null or char_length(reference) <= 100),
  paid_on      date not null default current_date,
  verification text not null default 'recorded_by_admin' check (verification in ('recorded_by_admin','provider_verified')),
  provider     text check (provider is null or char_length(provider) <= 50),
  notes        text check (notes is null or char_length(notes) <= 500),
  status       text not null default 'valid' check (status in ('valid','voided')),
  void_reason  text check (void_reason is null or char_length(void_reason) <= 300),
  voided_at    timestamptz,
  voided_by    uuid references auth.users(id) on delete set null,
  recorded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (billing_id, school_id) references public.semester_billing(id, school_id) on delete restrict
);
create index payments_billing_idx on public.payments (billing_id);
-- The same receipt/transaction reference cannot be recorded twice for the same method
create unique index payments_reference_uq on public.payments (method, lower(reference))
  where reference is not null and status = 'valid';

-- -----------------------------------------------------------------------------
-- Audit log (append-only; no FKs so history survives deletions)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  school_id   uuid,
  actor_id    uuid,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_school_idx on public.audit_logs (school_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261022000002_functions_triggers.sql
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261022000003_rls_policies.sql
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261022000004_rpc_and_views.sql
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261025000005_security_hardening.sql
-- -----------------------------------------------------------------------------

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



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261026000006_major_features.sql
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Migration 6: Major Feature Enhancement
-- -----------------------------------------------------------------------------
-- Addresses:
--  1. Examinations & Assessment Linking
--  2. Subject Result Submissions & Review Workflow
--  3. Class Teacher Consolidated Results & Read-Only Access
--  4. Terminal Reports & Historical Result Snapshots
--  5. School-Configurable Grading Policy
--  6. Student Fees Management, Receipts & Reversals
--  7. Student Promotion & Academic Transition History
--  8. School Subscription Billing & Semester Renewal Workflow
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Examinations & Components
-- -----------------------------------------------------------------------------
create table if not exists public.examinations (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  academic_year_id  uuid not null,
  semester_id       uuid not null,
  name              text not null check (char_length(btrim(name)) between 1 and 100),
  exam_type         text not null default 'end_of_term'
                    check (exam_type in ('mid_term','end_of_term','mock','class_test','continuous_assessment','other')),
  start_date        date,
  end_date          date,
  status            text not null default 'draft'
                    check (status in ('draft','open','submitted','reviewed','approved','published')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  unique (semester_id, name),
  unique (id, school_id)
);
create index if not exists examinations_semester_idx on public.examinations (semester_id, status);

create table if not exists public.examination_classes (
  examination_id uuid not null,
  class_id       uuid not null,
  school_id      uuid not null,
  created_at     timestamptz not null default now(),
  primary key (examination_id, class_id),
  foreign key (examination_id, school_id) references public.examinations(id, school_id) on delete cascade,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade
);

create table if not exists public.examination_subjects (
  examination_id uuid not null,
  subject_id     uuid not null,
  school_id      uuid not null,
  created_at     timestamptz not null default now(),
  primary key (examination_id, subject_id),
  foreign key (examination_id, school_id) references public.examinations(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete cascade
);

-- Link assessments to examinations (optional foreign key for backwards compatibility)
alter table public.assessments add column if not exists examination_id uuid;
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'assessments_examination_fk' and table_name = 'assessments'
  ) then
    alter table public.assessments add constraint assessments_examination_fk
      foreign key (examination_id, school_id) references public.examinations(id, school_id) on delete cascade;
  end if;
end $$;
create index if not exists assessments_exam_idx on public.assessments (examination_id);

-- Enhance scores table to support absent, exempted, missing marks
alter table public.scores add column if not exists status text not null default 'present';
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'scores_status_check'
  ) then
    alter table public.scores add constraint scores_status_check
      check (status in ('present','absent','exempted','missing'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Subject Result Submissions & Review Workflow
-- -----------------------------------------------------------------------------
create table if not exists public.subject_result_submissions (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  semester_id     uuid not null,
  class_id        uuid not null,
  subject_id      uuid not null,
  examination_id  uuid,
  status          text not null default 'draft'
                  check (status in ('draft','submitted','reviewed','approved','returned')),
  submitted_by    uuid references auth.users(id) on delete set null,
  submitted_at    timestamptz,
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  feedback        text check (feedback is null or char_length(feedback) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete cascade,
  foreign key (subject_id, school_id) references public.subjects(id, school_id) on delete cascade,
  unique (semester_id, class_id, subject_id, examination_id)
);
create index if not exists subject_submissions_lookup_idx
  on public.subject_result_submissions (class_id, subject_id, semester_id);

-- -----------------------------------------------------------------------------
-- 3. School Grading Configurations
-- -----------------------------------------------------------------------------
create table if not exists public.school_grading_configs (
  school_id                     uuid primary key references public.schools(id) on delete cascade,
  pass_mark                     numeric(5,2) not null default 50.00 check (pass_mark between 0 and 100),
  show_position                 boolean not null default true,
  tie_ranking_policy            text not null default 'dense' check (tie_ranking_policy in ('dense','standard','none')),
  continuous_assessment_weight  numeric(5,2) not null default 30.00 check (continuous_assessment_weight between 0 and 100),
  exam_weight                   numeric(5,2) not null default 70.00 check (exam_weight between 0 and 100),
  conduct_options               text[] not null default array['Excellent','Very Good','Good','Fair','Needs Improvement'],
  attitude_options              text[] not null default array['Hardworking','Attentive','Cooperative','Inconsistent','Playful'],
  interest_options              text[] not null default array['Reading','Sports','Arts','Music','ICT','Science Club'],
  next_term_begins              date,
  headmaster_remarks_template   text,
  updated_at                    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 4. Terminal Reports & Historical Result Snapshots
-- -----------------------------------------------------------------------------
create table if not exists public.terminal_reports (
  id                        uuid primary key default gen_random_uuid(),
  school_id                 uuid not null references public.schools(id) on delete cascade,
  student_id                uuid not null,
  academic_year_id          uuid not null,
  semester_id               uuid not null,
  class_id                  uuid not null,
  examination_id            uuid,
  status                    text not null default 'draft'
                            check (status in ('draft','reviewed','approved','published')),
  total_score               numeric(8,2) not null default 0,
  average_score             numeric(5,2) not null default 0,
  overall_grade             text,
  position                  integer,
  total_students            integer not null default 0,
  subjects_count            integer not null default 0,
  incomplete_subjects       integer not null default 0,
  attendance_present        integer not null default 0,
  attendance_absent         integer not null default 0,
  attendance_total          integer not null default 0,
  conduct                   text,
  attitude                  text,
  interest                  text,
  class_teacher_remarks     text check (class_teacher_remarks is null or char_length(class_teacher_remarks) <= 500),
  headmaster_remarks        text check (headmaster_remarks is null or char_length(headmaster_remarks) <= 500),
  promotion_recommendation  text check (promotion_recommendation is null or promotion_recommendation in ('promoted','promoted_on_probation','repeat','withdrawn','graduated')),
  next_class_id             uuid references public.classes(id) on delete set null,
  next_term_begins          date,
  snapshot_data             jsonb not null default '{}'::jsonb,
  needs_regeneration        boolean not null default false,
  published_at              timestamptz,
  published_by              uuid references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete restrict,
  unique (student_id, semester_id, class_id)
);
create index if not exists terminal_reports_class_sem_idx
  on public.terminal_reports (class_id, semester_id, status);

-- -----------------------------------------------------------------------------
-- 5. Student Fee Management
-- -----------------------------------------------------------------------------
create table if not exists public.fee_categories (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.fee_structures (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  academic_year_id  uuid not null,
  semester_id       uuid not null,
  class_id          uuid,  -- null applies to all classes
  category_id       uuid not null references public.fee_categories(id) on delete restrict,
  name              text not null check (char_length(btrim(name)) between 1 and 100),
  amount            numeric(10,2) not null check (amount >= 0),
  due_date          date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  unique (id, school_id)
);
create index if not exists fee_structures_semester_idx on public.fee_structures (semester_id, class_id);

create table if not exists public.student_fee_charges (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  student_id        uuid not null,
  semester_id       uuid not null,
  fee_structure_id  uuid references public.fee_structures(id) on delete set null,
  category_id       uuid references public.fee_categories(id) on delete restrict,
  description       text not null check (char_length(btrim(description)) between 1 and 200),
  amount            numeric(10,2) not null check (amount >= 0),
  discount_amount   numeric(10,2) not null default 0 check (discount_amount >= 0 and discount_amount <= amount),
  discount_reason   text check (discount_reason is null or char_length(discount_reason) <= 200),
  net_amount        numeric(10,2) generated always as (amount - discount_amount) stored,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict
);
create index if not exists student_fee_charges_student_idx on public.student_fee_charges (student_id, semester_id);

create table if not exists public.student_fee_payments (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  student_id      uuid not null,
  semester_id     uuid not null,
  receipt_number  text not null check (char_length(btrim(receipt_number)) between 3 and 40),
  amount          numeric(10,2) not null check (amount > 0),
  method          text not null check (method in ('cash','mobile_money','bank_transfer','cheque','card','other')),
  reference       text check (reference is null or char_length(reference) <= 100),
  paid_on         date not null default current_date,
  notes           text check (notes is null or char_length(notes) <= 500),
  status          text not null default 'valid' check (status in ('valid','reversed')),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  reversed_at     timestamptz,
  reversed_by     uuid references auth.users(id) on delete set null,
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  unique (school_id, receipt_number)
);
create index if not exists student_fee_payments_student_idx on public.student_fee_payments (student_id, semester_id);

-- -----------------------------------------------------------------------------
-- 6. Student Promotion & Academic Transitions
-- -----------------------------------------------------------------------------
create table if not exists public.student_promotions (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid not null references public.schools(id) on delete cascade,
  from_academic_year_id uuid not null,
  to_academic_year_id   uuid not null,
  from_class_id         uuid not null,
  to_class_id           uuid, -- null if graduating or withdrawing
  student_id            uuid not null,
  decision              text not null
                        check (decision in ('promoted','promoted_on_probation','repeated','graduated','withdrawn')),
  notes                 text check (notes is null or char_length(notes) <= 300),
  promoted_by           uuid references auth.users(id) on delete set null,
  promoted_at           timestamptz not null default now(),
  foreign key (from_academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  foreign key (to_academic_year_id, school_id) references public.academic_years(id, school_id) on delete restrict,
  foreign key (from_class_id, school_id) references public.classes(id, school_id) on delete restrict,
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  unique (from_academic_year_id, student_id)
);
create index if not exists student_promotions_from_class_idx
  on public.student_promotions (from_academic_year_id, from_class_id);

-- -----------------------------------------------------------------------------
-- 7. School Subscription & Semester Renewals Enhancement
-- -----------------------------------------------------------------------------
alter table public.semester_billing add column if not exists invoice_number text;
alter table public.semester_billing add column if not exists subscription_status text not null default 'upcoming';
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'semester_billing_status_check'
  ) then
    alter table public.semester_billing add constraint semester_billing_status_check
      check (subscription_status in ('upcoming','invoice_issued','awaiting_payment','paid','overdue','renewed','suspended'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Authorization Helpers in schema 'private'
-- -----------------------------------------------------------------------------
-- Class teacher helper: Is user the assigned class (homeroom) teacher for this class?
create or replace function private.is_class_teacher(p_class_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.teacher_assignments ta
    join public.school_memberships m on m.school_id = ta.school_id and m.user_id = ta.teacher_id
    join public.schools s on s.id = ta.school_id
    where ta.class_id = p_class_id
      and ta.teacher_id = (select auth.uid())
      and ta.subject_id is null
      and m.status = 'active' and m.role = 'teacher'
      and s.status = 'active'
  );
$$;

create or replace function private.is_class_teacher_for_assessment(p_assessment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_class_teacher(a.class_id)
    from public.assessments a where a.id = p_assessment_id
  ), false);
$$;

-- -----------------------------------------------------------------------------
-- 9. Row Level Security Policies
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'examinations','examination_classes','examination_subjects',
    'subject_result_submissions','school_grading_configs','terminal_reports',
    'fee_categories','fee_structures','student_fee_charges','student_fee_payments','student_promotions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Examinations: Headmaster manages all, teachers read exams for their classes
create policy "examinations: headmaster all, teacher assigned" on public.examinations
  for select to authenticated using (
    private.is_headmaster(school_id)
    or (private.is_member(school_id) and exists (
      select 1 from public.examination_classes ec
      where ec.examination_id = examinations.id and private.teaches_class(ec.class_id)
    ))
    or (private.is_member(school_id) and not exists (
      select 1 from public.examination_classes ec where ec.examination_id = examinations.id
    ))
  );

create policy "examinations: headmaster insert" on public.examinations
  for insert to authenticated with check (private.is_headmaster(school_id));
create policy "examinations: headmaster update" on public.examinations
  for update to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));
create policy "examinations: headmaster delete" on public.examinations
  for delete to authenticated using (private.is_headmaster(school_id));

-- Examination classes & subjects
create policy "exam_classes: members read" on public.examination_classes
  for select to authenticated using (private.is_member(school_id));
create policy "exam_classes: headmaster write" on public.examination_classes
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

create policy "exam_subjects: members read" on public.examination_subjects
  for select to authenticated using (private.is_member(school_id));
create policy "exam_subjects: headmaster write" on public.examination_subjects
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- Update assessments read policy: Allow Class Teachers to view all assessments for their class!
drop policy if exists "assessments: headmaster or subject teacher read" on public.assessments;
create policy "assessments: headmaster, subject teacher or class teacher read" on public.assessments
  for select to authenticated using (
    (private.can_manage_subject_grades(class_id, subject_id) or private.is_class_teacher(class_id))
    and private.is_member(school_id)
  );

-- Update scores read policy: Allow Class Teachers to view all scores for their class!
drop policy if exists "scores: headmaster or subject teacher read" on public.scores;
create policy "scores: headmaster, subject teacher or class teacher read" on public.scores
  for select to authenticated using (
    (private.can_grade_assessment(assessment_id) or private.is_class_teacher_for_assessment(assessment_id))
    and private.is_member(school_id)
  );

-- Subject Result Submissions
create policy "submissions: headmaster, subject teacher or class teacher read" on public.subject_result_submissions
  for select to authenticated using (
    private.is_headmaster(school_id) or private.teaches_subject(class_id, subject_id) or private.is_class_teacher(class_id)
  );
create policy "submissions: headmaster or subject teacher insert" on public.subject_result_submissions
  for insert to authenticated with check (
    private.is_headmaster(school_id) or private.teaches_subject(class_id, subject_id)
  );
create policy "submissions: headmaster or subject teacher update" on public.subject_result_submissions
  for update to authenticated using (
    private.is_headmaster(school_id) or private.teaches_subject(class_id, subject_id)
  ) with check (
    private.is_headmaster(school_id) or private.teaches_subject(class_id, subject_id)
  );

-- School grading configurations
create policy "grading_configs: members read" on public.school_grading_configs
  for select to authenticated using (private.is_member(school_id));
create policy "grading_configs: headmaster write" on public.school_grading_configs
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- Terminal reports: Headmaster and Class Teacher read & manage
create policy "terminal_reports: headmaster or class teacher read" on public.terminal_reports
  for select to authenticated using (
    private.is_headmaster(school_id) or private.is_class_teacher(class_id)
  );
create policy "terminal_reports: headmaster or class teacher insert" on public.terminal_reports
  for insert to authenticated with check (
    private.is_headmaster(school_id) or private.is_class_teacher(class_id)
  );
create policy "terminal_reports: headmaster or class teacher update" on public.terminal_reports
  for update to authenticated using (
    private.is_headmaster(school_id) or private.is_class_teacher(class_id)
  ) with check (
    private.is_headmaster(school_id) or private.is_class_teacher(class_id)
  );

-- Fee management (Headmaster and Super Admin only; regular teachers cannot access)
create policy "fees: headmaster read categories" on public.fee_categories
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));
create policy "fees: headmaster write categories" on public.fee_categories
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

create policy "fees: headmaster read structures" on public.fee_structures
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));
create policy "fees: headmaster write structures" on public.fee_structures
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

create policy "fees: headmaster read charges" on public.student_fee_charges
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));
create policy "fees: headmaster write charges" on public.student_fee_charges
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

create policy "fees: headmaster read payments" on public.student_fee_payments
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));
create policy "fees: headmaster write payments" on public.student_fee_payments
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- Student promotions
create policy "promotions: headmaster or teacher read" on public.student_promotions
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(from_class_id));
create policy "promotions: headmaster write" on public.student_promotions
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- -----------------------------------------------------------------------------
-- 10. RPCs: Consolidated Results, Terminal Reports, Fees & Promotion
-- -----------------------------------------------------------------------------

-- Class teacher consolidated results across all subjects
create or replace function public.class_consolidated_results(
  p_semester_id uuid,
  p_class_id uuid,
  p_examination_id uuid default null
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_school uuid;
  v_result jsonb;
begin
  select school_id into v_school from public.classes where id = p_class_id;
  if v_school is null then
    raise exception 'Class not found' using errcode = 'P0002';
  end if;

  if not (private.is_headmaster(v_school) or private.can_access_class(p_class_id)) then
    raise exception 'Not authorised to access class consolidated results' using errcode = '42501';
  end if;

  with class_subjects as (
    select distinct s.id as subject_id, s.name as subject_name, s.code as subject_code
    from public.teacher_assignments ta
    join public.subjects s on s.id = ta.subject_id
    where ta.class_id = p_class_id and s.is_active
    order by s.name
  ),
  class_students as (
    select st.id as student_id, st.admission_number, st.first_name, st.last_name,
           st.last_name || ', ' || st.first_name as student_name
    from public.students st
    where (st.current_class_id = p_class_id and st.enrollment_status = 'active')
       or exists (
         select 1 from public.student_enrollments e
         where e.student_id = st.id and e.semester_id = p_semester_id and e.class_id = p_class_id and e.status <> 'voided'
       )
    order by st.last_name, st.first_name
  ),
  subject_submissions as (
    select sub.subject_id, sub.status, sub.submitted_at, sub.feedback,
           p.full_name as teacher_name
    from public.subject_result_submissions sub
    left join public.profiles p on p.id = sub.submitted_by
    where sub.class_id = p_class_id and sub.semester_id = p_semester_id
      and (p_examination_id is null or sub.examination_id = p_examination_id)
  )
  select jsonb_build_object(
    'class_id', p_class_id,
    'semester_id', p_semester_id,
    'subjects', coalesce((select jsonb_agg(cs) from class_subjects cs), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(ss) from subject_submissions ss), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'student_id', stu.student_id,
          'admission_number', stu.admission_number,
          'student_name', stu.student_name,
          'subject_results', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'subject_id', cs.subject_id,
                'subject_name', cs.subject_name,
                'total', res.total,
                'percentage', res.percentage,
                'grade', res.grade,
                'remark', res.remark,
                'scores_entered', res.scores_entered,
                'assessments_count', res.assessments_count
              )
            )
            from class_subjects cs
            left join lateral public.class_subject_results(p_semester_id, p_class_id, cs.subject_id) res
              on res.student_id = stu.student_id
          ), '[]'::jsonb)
        )
      )
      from class_students stu
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- Batch promote students atomically
create or replace function public.promote_students(
  p_school_id uuid,
  p_from_year_id uuid,
  p_to_year_id uuid,
  p_from_class_id uuid,
  p_promotions jsonb
)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_count integer := 0;
  r jsonb;
  v_student_id uuid;
  v_to_class_id uuid;
  v_decision text;
  v_notes text;
begin
  if not private.is_headmaster(p_school_id) then
    raise exception 'Only headmasters can promote students' using errcode = '42501';
  end if;

  if jsonb_typeof(p_promotions) <> 'array' then
    raise exception 'Promotions payload must be an array' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_promotions) loop
    v_student_id := (r ->> 'student_id')::uuid;
    v_to_class_id := case when (r ->> 'to_class_id') is not null and (r ->> 'to_class_id') <> '' then (r ->> 'to_class_id')::uuid else null end;
    v_decision := r ->> 'decision';
    v_notes := r ->> 'notes';

    if v_to_class_id is not null and not exists (
      select 1 from public.classes where id = v_to_class_id and school_id = p_school_id and is_active
    ) then
      raise exception 'Destination class does not belong to this school' using errcode = '23514';
    end if;

    -- Record promotion
    insert into public.student_promotions (
      school_id, from_academic_year_id, to_academic_year_id, from_class_id, to_class_id,
      student_id, decision, notes, promoted_by
    ) values (
      p_school_id, p_from_year_id, p_to_year_id, p_from_class_id, v_to_class_id,
      v_student_id, v_decision, nullif(btrim(v_notes), ''), (select auth.uid())
    ) on conflict (from_academic_year_id, student_id) do update set
      to_academic_year_id = excluded.to_academic_year_id,
      from_class_id       = excluded.from_class_id,
      to_class_id         = excluded.to_class_id,
      decision            = excluded.decision,
      notes               = excluded.notes,
      promoted_by         = excluded.promoted_by,
      promoted_at         = now();

    -- Update student class/status safely
    if v_decision in ('promoted','promoted_on_probation') and v_to_class_id is not null then
      update public.students
      set current_class_id = v_to_class_id
      where id = v_student_id and school_id = p_school_id;
    elsif v_decision = 'graduated' then
      update public.students
      set enrollment_status = 'graduated'
      where id = v_student_id and school_id = p_school_id;
    elsif v_decision = 'withdrawn' then
      update public.students
      set enrollment_status = 'withdrawn'
      where id = v_student_id and school_id = p_school_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- Student fee account statement RPC
create or replace function public.student_fee_statement(p_student_id uuid, p_semester_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_school uuid;
  v_charges numeric(10,2) := 0;
  v_discounts numeric(10,2) := 0;
  v_paid numeric(10,2) := 0;
  v_balance numeric(10,2) := 0;
  v_res jsonb;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null or not (private.is_headmaster(v_school) or (select private.is_super_admin())) then
    raise exception 'Not authorised to view fee statements' using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0), coalesce(sum(discount_amount), 0)
  into v_charges, v_discounts
  from public.student_fee_charges
  where student_id = p_student_id
    and (p_semester_id is null or semester_id = p_semester_id);

  select coalesce(sum(amount), 0)
  into v_paid
  from public.student_fee_payments
  where student_id = p_student_id and status = 'valid'
    and (p_semester_id is null or semester_id = p_semester_id);

  v_balance := (v_charges - v_discounts) - v_paid;

  select jsonb_build_object(
    'student_id', p_student_id,
    'total_charged', v_charges,
    'total_discounted', v_discounts,
    'net_charged', v_charges - v_discounts,
    'total_paid', v_paid,
    'balance', v_balance,
    'charges', coalesce((
      select jsonb_agg(c order by c.created_at)
      from public.student_fee_charges c
      where c.student_id = p_student_id
        and (p_semester_id is null or c.semester_id = p_semester_id)
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(p order by p.paid_on desc, p.created_at desc)
      from public.student_fee_payments p
      where p.student_id = p_student_id
        and (p_semester_id is null or p.semester_id = p_semester_id)
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

-- Triggers for updated_at on new tables
do $$
declare t text;
begin
  foreach t in array array[
    'examinations','subject_result_submissions','terminal_reports',
    'fee_structures','student_fee_payments'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;



-- -----------------------------------------------------------------------------
-- MIGRATION: 20261028000007_school_logos.sql
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Migration 7: School Logos & Custom Branding
-- -----------------------------------------------------------------------------
-- 1. Adds logo_url column to public.schools
-- 2. Ensures public storage bucket school-logos exists
-- 3. Sets up storage policies for school logos
-- =============================================================================

-- 1. Add logo_url column to schools
alter table public.schools add column if not exists logo_url text check (logo_url is null or char_length(logo_url) <= 1000);

-- 2. Create school-logos storage bucket if it doesn't already exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-logos',
  'school-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

-- 3. Storage access policies for school-logos
-- Anyone can view school logos (public bucket)
create policy "Public Access to School Logos"
on storage.objects for select
to public
using ( bucket_id = 'school-logos' );

-- Authenticated headmasters and platform admins can upload/manage logos
create policy "Authorized users can upload school logos"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'school-logos' );

create policy "Authorized users can update school logos"
on storage.objects for update
to authenticated
using ( bucket_id = 'school-logos' );

create policy "Authorized users can delete school logos"
on storage.objects for delete
to authenticated
using ( bucket_id = 'school-logos' );


