-- =============================================================================
-- Migration 13: Convert School Billing to Per-Term Billing Model
-- -----------------------------------------------------------------------------
-- Rules:
-- 1. Default pricing: GHS 3.00 per student per term.
-- 2. Term bill = number of active students × price per student.
-- 3. Remove monthly billing: all schools are billed per term only.
-- 4. Active student count snapshotted on invoice (e.g. week 2 / configured date).
-- 5. RPC to generate one invoice per term with fixed student snapshot count.
-- 6. Batch RPC to generate current-term invoices for all active schools.
-- 7. Convert any existing monthly configs to term billing. Old invoices/history preserved.
-- =============================================================================

-- 1. Update platform default settings to GHS 3.00
update public.platform_settings
set price_per_student = 3.00
where id = true;

-- Ensure default in platform_settings schema is 3.00
alter table public.platform_settings
  alter column price_per_student set default 3.00;

-- 2. Update default price in school_billing_configs table
alter table public.school_billing_configs
  alter column price_per_student set default 3.00,
  alter column billing_frequency set default 'term';

-- Drop the check constraint that only allowed 'monthly' and 'semester', allowing 'term' or 'semester'
alter table public.school_billing_configs
  drop constraint if exists school_billing_configs_billing_frequency_check;

alter table public.school_billing_configs
  add constraint school_billing_configs_billing_frequency_check
  check (billing_frequency in ('term', 'semester', 'monthly'));

-- 3. Migration: Convert all existing configs to term billing
update public.school_billing_configs
set billing_frequency = 'term',
    updated_at = now()
where billing_frequency in ('monthly', 'semester');

-- Also update any future default provisioning
create or replace function private.provision_school_billing_config()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_default_price numeric(10,2) := 3.00;
  v_due_days integer := 14;
begin
  select coalesce(price_per_student, 3.00)
    into v_default_price
    from public.platform_settings
   where id = true;

  insert into public.school_billing_configs (
    school_id,
    price_per_student,
    billing_frequency,
    billing_start_date,
    next_billing_date,
    due_days,
    grace_period_days,
    discount_type,
    discount_value,
    pass_fee_markup,
    fee_markup_percent,
    auto_charge_card,
    status
  ) values (
    new.id,
    v_default_price,
    'term',
    current_date,
    current_date + interval '90 days',
    v_due_days,
    7,
    'none',
    0.00,
    true,
    3.00,
    false,
    'active'
  )
  on conflict (school_id) do nothing;

  return new;
end $$;

-- 4. Update semester_billing table check constraint
alter table public.semester_billing
  drop constraint if exists semester_billing_billing_frequency_check;

alter table public.semester_billing
  add constraint semester_billing_billing_frequency_check
  check (billing_frequency in ('term', 'semester', 'monthly'));

-- Add snapshot_date column if not present
alter table public.semester_billing
  add column if not exists snapshot_date date;

-- 5. RPC: Count active students for a school on a snapshot date (week 2 of term or current date)
create or replace function public.school_active_student_snapshot(
  p_school_id     uuid,
  p_semester_id   uuid default null,
  p_snapshot_date date default null
)
returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer := 0;
  v_sem_start date;
  v_effective_snapshot date := p_snapshot_date;
begin
  if p_semester_id is not null then
    select starts_on into v_sem_start
    from public.semesters
    where id = p_semester_id;
  end if;

  -- If no snapshot date is explicitly given, default to week 2 of the term (starts_on + 14 days) or current_date
  if v_effective_snapshot is null then
    if v_sem_start is not null then
      v_effective_snapshot := v_sem_start + interval '14 days';
    else
      v_effective_snapshot := current_date;
    end if;
  end if;

  -- Active students count: students belonging to the school who were admitted on or before snapshot date
  -- and whose status is active (or became inactive only after snapshot date).
  select count(distinct id) into v_count
  from public.students
  where school_id = p_school_id
    and enrollment_status = 'active'
    and (admission_date is null or admission_date <= v_effective_snapshot);

  -- Fallback if zero (e.g. all admission_dates unset or in future)
  if v_count = 0 then
    select count(distinct id) into v_count
    from public.students
    where school_id = p_school_id
      and enrollment_status = 'active';
  end if;

  return v_count;
end $$;

-- 6. RPC: Generate School Invoice for a Term
create or replace function public.generate_school_invoice(
  p_school_id      uuid,
  p_period_date    date default current_date,
  p_semester_id    uuid default null
)
returns public.semester_billing
language plpgsql security definer set search_path = '' as $$
declare
  v_caller         uuid := auth.uid();
  v_cfg            public.school_billing_configs;
  v_student_count  integer := 0;
  v_price          numeric(10,2);
  v_subtotal       numeric(12,2);
  v_discount       numeric(12,2) := 0.00;
  v_markup         numeric(12,2) := 0.00;
  v_total          numeric(12,2);
  v_due_date       date;
  v_grace_end      date;
  v_period_label   text;
  v_inv_number     text;
  v_snapshot_date  date;
  v_sem_start      date;
  v_result         public.semester_billing;
begin
  if not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can generate invoices' using errcode = '42501';
  end if;

  select * into v_cfg from public.school_billing_configs where school_id = p_school_id;
  if not found then
    insert into public.school_billing_configs (school_id, price_per_student, billing_frequency)
    values (p_school_id, 3.00, 'term')
    returning * into v_cfg;
  end if;

  v_price := coalesce(v_cfg.price_per_student, 3.00);

  -- Determine target semester/term
  if p_semester_id is null then
    select id, starts_on into p_semester_id, v_sem_start
    from public.semesters
    where school_id = p_school_id and is_current = true
    limit 1;
  else
    select starts_on into v_sem_start
    from public.semesters
    where id = p_semester_id;
  end if;

  if p_semester_id is null then
    raise exception 'No current term/semester found for school %', p_school_id using errcode = 'P0002';
  end if;

  -- Week 2 snapshot date (starts_on + 14 days)
  if v_sem_start is not null then
    v_snapshot_date := v_sem_start + interval '14 days';
  else
    v_snapshot_date := coalesce(p_period_date, current_date);
  end if;

  -- Snapshot student count: once stored, existing invoices preserve their count
  v_student_count := public.school_active_student_snapshot(p_school_id, p_semester_id, v_snapshot_date);

  select se.name || ' · ' || ay.name into v_period_label
  from public.semesters se
  join public.academic_years ay on ay.id = se.academic_year_id
  where se.id = p_semester_id;

  if v_period_label is null then
    select name into v_period_label from public.semesters where id = p_semester_id;
  end if;

  v_due_date := coalesce(v_sem_start, p_period_date, current_date) + (v_cfg.due_days || ' days')::interval;
  v_grace_end := v_due_date + (v_cfg.grace_period_days || ' days')::interval;
  v_inv_number := 'INV-' || to_char(coalesce(p_period_date, current_date), 'YYMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  v_subtotal := v_student_count * v_price;

  if v_cfg.discount_type = 'percentage' and v_cfg.discount_value > 0 then
    v_discount := round(v_subtotal * (v_cfg.discount_value / 100.0), 2);
  elsif v_cfg.discount_type = 'fixed' and v_cfg.discount_value > 0 then
    v_discount := least(v_subtotal, v_cfg.discount_value);
  end if;

  if v_cfg.pass_fee_markup and v_cfg.fee_markup_percent > 0 then
    v_markup := round((v_subtotal - v_discount) * (v_cfg.fee_markup_percent / 100.0), 2);
  end if;

  v_total := v_subtotal - v_discount + v_markup;

  insert into public.semester_billing (
    school_id,
    semester_id,
    billing_frequency,
    period_label,
    student_count,
    price_per_student,
    currency,
    discount_amount,
    fee_markup_amount,
    total_payable,
    due_date,
    grace_period_end,
    invoice_number,
    snapshot_date,
    subscription_status,
    last_calculated_at
  ) values (
    p_school_id,
    p_semester_id,
    'term',
    v_period_label,
    v_student_count,
    v_price,
    'GHS',
    v_discount,
    v_markup,
    v_total,
    v_due_date,
    v_grace_end,
    v_inv_number,
    v_snapshot_date,
    'awaiting_payment',
    now()
  )
  on conflict (school_id, semester_id) where semester_id is not null
  do update set
    -- If already generated, do NOT overwrite snapshot student_count or price_per_student unless recalculate requested
    period_label       = coalesce(public.semester_billing.period_label, excluded.period_label),
    due_date           = coalesce(public.semester_billing.due_date, excluded.due_date),
    grace_period_end   = coalesce(public.semester_billing.grace_period_end, excluded.grace_period_end),
    last_calculated_at = now()
  returning * into v_result;

  return v_result;
end $$;

-- 7. Batch RPC: Generate invoices for all active schools for current term
create or replace function public.generate_all_school_term_invoices()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller         uuid := auth.uid();
  v_school         record;
  v_generated      integer := 0;
  v_skipped        integer := 0;
  v_errors         text[] := array[]::text[];
begin
  if not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can generate invoices' using errcode = '42501';
  end if;

  for v_school in
    select s.id, s.name, sem.id as current_sem_id
    from public.schools s
    left join public.semesters sem on sem.school_id = s.id and sem.is_current = true
    where s.status = 'active'
    order by s.name
  loop
    if v_school.current_sem_id is null then
      v_skipped := v_skipped + 1;
    else
      begin
        perform public.generate_school_invoice(v_school.id, current_date, v_school.current_sem_id);
        v_generated := v_generated + 1;
      exception when others then
        v_errors := array_append(v_errors, v_school.name || ': ' || sqlerrm);
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'generated', v_generated,
    'skipped', v_skipped,
    'errors', v_errors
  );
end $$;

-- 8. RPC to update pricing configuration for a school
create or replace function public.upsert_school_billing_config(
  p_school_id          uuid,
  p_price_per_student  numeric,
  p_billing_frequency  text default 'term',
  p_billing_start_date date default current_date,
  p_next_billing_date  date default null,
  p_due_days           integer default 14,
  p_grace_period_days  integer default 7,
  p_discount_type      text default 'none',
  p_discount_value     numeric default 0.00,
  p_pass_fee_markup    boolean default true,
  p_fee_markup_percent numeric default 3.00,
  p_auto_charge_card   boolean default false,
  p_status             text default 'active',
  p_notes              text default null
)
returns public.school_billing_configs
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_result public.school_billing_configs;
begin
  if not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can configure school billing' using errcode = '42501';
  end if;

  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception 'School not found' using errcode = 'P0002';
  end if;

  if p_price_per_student < 0 then
    raise exception 'Price per student cannot be negative' using errcode = '22003';
  end if;

  insert into public.school_billing_configs (
    school_id,
    price_per_student,
    billing_frequency,
    billing_start_date,
    next_billing_date,
    due_days,
    grace_period_days,
    discount_type,
    discount_value,
    pass_fee_markup,
    fee_markup_percent,
    auto_charge_card,
    status,
    notes,
    updated_at
  ) values (
    p_school_id,
    p_price_per_student,
    'term',
    coalesce(p_billing_start_date, current_date),
    p_next_billing_date,
    coalesce(p_due_days, 14),
    coalesce(p_grace_period_days, 7),
    coalesce(p_discount_type, 'none'),
    coalesce(p_discount_value, 0.00),
    coalesce(p_pass_fee_markup, true),
    coalesce(p_fee_markup_percent, 3.00),
    coalesce(p_auto_charge_card, false),
    coalesce(p_status, 'active'),
    p_notes,
    now()
  )
  on conflict (school_id) do update set
    price_per_student   = excluded.price_per_student,
    billing_frequency   = 'term',
    billing_start_date  = excluded.billing_start_date,
    next_billing_date   = excluded.next_billing_date,
    due_days            = excluded.due_days,
    grace_period_days   = excluded.grace_period_days,
    discount_type       = excluded.discount_type,
    discount_value      = excluded.discount_value,
    pass_fee_markup     = excluded.pass_fee_markup,
    fee_markup_percent  = excluded.fee_markup_percent,
    auto_charge_card    = excluded.auto_charge_card,
    status              = excluded.status,
    notes               = excluded.notes,
    updated_at          = now()
  returning * into v_result;

  return v_result;
end $$;

-- 9. Recreate public.billing_overview View with snapshot_date & term support
drop view if exists public.billing_overview cascade;
create view public.billing_overview with (security_invoker = true) as
select b.id,
       b.school_id,
       sc.name as school_name,
       sc.code as school_code,
       sc.status as school_status,
       cfg.status as config_status,
       b.billing_frequency,
       b.billing_month,
       coalesce(
         b.period_label,
         case
           when b.semester_id is not null then se.name || ' · ' || ay.name
           when b.billing_month is not null then to_char(b.billing_month, 'FMMonth YYYY')
           else 'Term Invoice'
         end
       ) as period_label,
       b.semester_id,
       se.name as semester_name,
       ay.name as academic_year_name,
       coalesce(se.is_current, false) as is_current,
       b.student_count,
       b.price_per_student,
       b.currency,
       b.amount_due,
       b.discount_amount,
       b.fee_markup_amount,
       coalesce(b.total_payable, (b.amount_due - b.discount_amount + b.fee_markup_amount)) as total_payable,
       b.amount_paid,
       greatest(0, coalesce(b.total_payable, (b.amount_due - b.discount_amount + b.fee_markup_amount)) - b.amount_paid) as balance,
       b.due_date,
       b.grace_period_end,
       b.invoice_number,
       b.snapshot_date,
       b.notes,
       b.last_calculated_at,
       b.created_at,
       (select max(p.paid_on) from public.payments p where p.billing_id = b.id and p.status = 'valid') as last_paid_on,
       case
         when b.amount_due = 0 then 'no_charge'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'paid'
         when b.amount_paid > 0 then 'partial'
         else 'unpaid'
       end as payment_status,
       case
         when b.amount_due = 0 then 'not_applicable'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'renewed'
         when b.due_date < current_date and b.amount_paid < coalesce(b.total_payable, b.amount_due) then 'overdue'
         else 'pending'
       end as renewal_status
from public.semester_billing b
join public.schools sc on sc.id = b.school_id
left join public.semesters se on se.id = b.semester_id
left join public.academic_years ay on ay.id = se.academic_year_id
left join public.school_billing_configs cfg on cfg.school_id = b.school_id;

-- Grant execution
grant execute on function public.school_active_student_snapshot to authenticated, service_role;
grant execute on function public.generate_all_school_term_invoices to authenticated, service_role;
grant execute on function public.generate_school_invoice to authenticated, service_role;
grant execute on function public.upsert_school_billing_config to authenticated, service_role;

