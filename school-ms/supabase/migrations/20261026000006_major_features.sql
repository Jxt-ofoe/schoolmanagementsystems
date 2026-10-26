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
