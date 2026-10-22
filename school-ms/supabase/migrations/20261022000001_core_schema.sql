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
  price_per_student  numeric(10,2) not null default 2.00 check (price_per_student >= 0),
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
