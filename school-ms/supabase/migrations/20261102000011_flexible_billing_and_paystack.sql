-- =============================================================================
-- Migration 11: Flexible School Billing and Paystack Payment Integration
-- -----------------------------------------------------------------------------
-- Enables:
-- 1. Per-school custom pricing, billing frequency (monthly or semester),
--    start dates, deadlines, grace periods, discounts, and fee markups.
-- 2. Automatic bill generation for monthly and semester frequencies.
-- 3. Paystack transaction tracking, reusable card authorizations, and
--    duplicate-safe billing reminder logs.
-- 4. Subscription status enforcement with complete data preservation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. School Billing Configurations
-- -----------------------------------------------------------------------------
create table if not exists public.school_billing_configs (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null unique references public.schools(id) on delete cascade,
  pricing_model       text not null default 'per_student' check (pricing_model in ('per_student', 'flat_rate')),
  price_per_student   numeric(10,2) not null default 5.00 check (price_per_student >= 0),
  flat_rate_amount    numeric(12,2) not null default 0.00 check (flat_rate_amount >= 0),
  billing_frequency   text not null default 'semester' check (billing_frequency in ('monthly', 'semester')),
  billing_start_date  date not null default current_date,
  next_billing_date   date,
  due_days            integer not null default 14 check (due_days >= 0),
  grace_period_days   integer not null default 7 check (grace_period_days >= 0),
  discount_type       text not null default 'none' check (discount_type in ('none', 'fixed', 'percentage')),
  discount_value      numeric(10,2) not null default 0.00 check (discount_value >= 0),
  pass_fee_markup     boolean not null default true,
  fee_markup_percent  numeric(5,2) not null default 3.00 check (fee_markup_percent >= 0),
  auto_charge_card    boolean not null default false,
  status              text not null default 'active' check (status in ('active', 'payment_pending', 'payment_overdue', 'grace_period', 'suspended', 'cancelled')),
  grace_period_end    date,
  notes               text check (notes is null or char_length(notes) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists school_billing_configs_status_idx on public.school_billing_configs (status);
create index if not exists school_billing_configs_frequency_idx on public.school_billing_configs (billing_frequency);

-- Initial backfill for existing schools
insert into public.school_billing_configs (school_id, price_per_student, billing_frequency, billing_start_date, next_billing_date, due_days, grace_period_days)
select s.id,
       coalesce(ps.price_per_student, 5.00),
       'semester',
       current_date,
       current_date + interval '30 days',
       14,
       7
from public.schools s
cross join public.platform_settings ps
on conflict (school_id) do nothing;

-- Auto-provision billing config for newly registered schools
create or replace function private.provision_school_billing_config()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_default_price numeric(10,2) := 5.00;
  v_due_days integer := 14;
  v_grace_days integer := 7;
begin
  select price_per_student, billing_due_days, void_grace_days
    into v_default_price, v_due_days, v_grace_days
    from public.platform_settings
    limit 1;

  insert into public.school_billing_configs (
    school_id,
    price_per_student,
    billing_frequency,
    billing_start_date,
    next_billing_date,
    due_days,
    grace_period_days
  ) values (
    new.id,
    coalesce(v_default_price, 5.00),
    'semester',
    current_date,
    current_date + interval '30 days',
    coalesce(v_due_days, 14),
    coalesce(v_grace_days, 7)
  )
  on conflict (school_id) do nothing;

  return new;
end $$;

drop trigger if exists trg_provision_school_billing_config on public.schools;
create trigger trg_provision_school_billing_config
  after insert on public.schools
  for each row execute function private.provision_school_billing_config();

-- -----------------------------------------------------------------------------
-- 2. Extend Invoices (public.semester_billing)
-- -----------------------------------------------------------------------------
-- Make semester_id nullable to support monthly invoices without requiring a semester record
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'semester_billing' and column_name = 'semester_id' and is_nullable = 'NO'
  ) then
    alter table public.semester_billing alter column semester_id drop not null;
  end if;
end $$;

-- Drop old strict unique constraint on semester_id if present
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'semester_billing_semester_id_key' and conrelid = 'public.semester_billing'::regclass
  ) then
    alter table public.semester_billing drop constraint semester_billing_semester_id_key;
  end if;
end $$;

-- Add new columns for monthly billing, period labels, discounts, markups, and grace periods
alter table public.semester_billing
  add column if not exists billing_frequency text not null default 'semester' check (billing_frequency in ('monthly', 'semester')),
  add column if not exists billing_month date,
  add column if not exists period_label text,
  add column if not exists discount_amount numeric(12,2) not null default 0.00 check (discount_amount >= 0),
  add column if not exists fee_markup_amount numeric(12,2) not null default 0.00 check (fee_markup_amount >= 0),
  add column if not exists total_payable numeric(12,2),
  add column if not exists grace_period_end date;

-- Backfill total_payable for existing records
update public.semester_billing
set total_payable = amount_due
where total_payable is null;

-- Partial unique indexes to prevent duplicate invoices for the same school and billing period
create unique index if not exists semester_billing_school_sem_uq
  on public.semester_billing (school_id, semester_id)
  where semester_id is not null;

create unique index if not exists semester_billing_school_month_uq
  on public.semester_billing (school_id, billing_month)
  where billing_month is not null;

-- -----------------------------------------------------------------------------
-- 3. Paystack Recurring Card Authorizations
-- -----------------------------------------------------------------------------
create table if not exists public.payment_authorizations (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  authorization_code text not null,
  card_type          text,
  last4              text,
  exp_month          text,
  exp_year           text,
  bin                text,
  bank               text,
  channel            text not null default 'card',
  signature          text,
  reusable           boolean not null default true,
  country_code       text default 'GH',
  account_name       text,
  customer_email     text,
  is_default         boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (school_id, authorization_code)
);

create index if not exists payment_authorizations_school_idx on public.payment_authorizations (school_id);

-- -----------------------------------------------------------------------------
-- 4. Paystack Transactions Log
-- -----------------------------------------------------------------------------
create table if not exists public.paystack_transactions (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid references public.schools(id) on delete set null,
  billing_id         uuid references public.semester_billing(id) on delete set null,
  reference          text not null unique,
  event_type         text not null default 'checkout_init',
  amount             numeric(12,2) not null,
  currency           text not null default 'GHS',
  channel            text,
  status             text not null default 'pending', -- 'pending', 'success', 'failed'
  gateway_response   text,
  paid_at            timestamptz,
  customer_email     text,
  customer_code      text,
  authorization_code text,
  metadata           jsonb not null default '{}'::jsonb,
  raw_payload        jsonb,
  webhook_received_at timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists paystack_transactions_reference_idx on public.paystack_transactions (reference);
create index if not exists paystack_transactions_school_idx on public.paystack_transactions (school_id);
create index if not exists paystack_transactions_billing_idx on public.paystack_transactions (billing_id);

-- -----------------------------------------------------------------------------
-- 5. Billing Reminders (Guaranteed duplicate prevention)
-- -----------------------------------------------------------------------------
create table if not exists public.billing_reminders (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id) on delete cascade,
  billing_id         uuid references public.semester_billing(id) on delete set null,
  reminder_type      text not null check (reminder_type in ('due_soon', 'due_today', 'failed', 'grace_warning', 'auto_renewal_notice')),
  recipient_phone    text,
  recipient_email    text,
  channel            text not null check (channel in ('sms', 'email', 'in_app')),
  message            text not null check (char_length(message) <= 1000),
  status             text not null default 'sent' check (status in ('sent', 'failed')),
  sent_at            timestamptz not null default now(),
  unique (school_id, billing_id, reminder_type, channel)
);

create index if not exists billing_reminders_school_idx on public.billing_reminders (school_id);

-- -----------------------------------------------------------------------------
-- 6. Recreate public.billing_overview View
-- -----------------------------------------------------------------------------
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
           else 'Invoice'
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
       coalesce(
         b.total_payable - b.amount_paid,
         b.balance
       ) as balance,
       b.due_date,
       b.grace_period_end,
       b.invoice_number,
       b.notes,
       b.last_calculated_at,
       b.created_at,
       case
         when coalesce(b.total_payable, b.amount_due) = 0 then 'no_charge'
         when b.amount_paid <= 0 then 'unpaid'
         when b.amount_paid < coalesce(b.total_payable, b.amount_due) then 'partial'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'paid'
         else 'overpaid'
       end as payment_status,
       case
         when coalesce(b.total_payable, b.amount_due) = 0 then 'not_applicable'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'renewed'
         when b.grace_period_end is not null and b.grace_period_end < current_date and b.amount_paid < coalesce(b.total_payable, b.amount_due) then 'suspended'
         when b.due_date is not null and b.due_date < current_date and b.amount_paid < coalesce(b.total_payable, b.amount_due) then 'overdue'
         else 'pending'
       end as renewal_status
from public.semester_billing b
join public.schools sc on sc.id = b.school_id
left join public.school_billing_configs cfg on cfg.school_id = b.school_id
left join public.semesters se on se.id = b.semester_id
left join public.academic_years ay on ay.id = se.academic_year_id;

grant select on public.billing_overview to authenticated;
revoke all on public.billing_overview from anon;

-- -----------------------------------------------------------------------------
-- 7. RPC: Configure School Billing Arrangement (Super Admin only)
-- -----------------------------------------------------------------------------
create or replace function public.upsert_school_billing_config(
  p_school_id          uuid,
  p_price_per_student  numeric,
  p_billing_frequency  text,
  p_billing_start_date date,
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

  if p_billing_frequency not in ('monthly', 'semester') then
    raise exception 'Invalid billing frequency: must be monthly or semester' using errcode = '22023';
  end if;

  if p_discount_type not in ('none', 'fixed', 'percentage') then
    raise exception 'Invalid discount type' using errcode = '22023';
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
    p_billing_frequency,
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
    billing_frequency   = excluded.billing_frequency,
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

  -- Audit configuration change
  insert into public.audit_logs (
    school_id, actor_id, actor_role, action, entity_type, entity_id, metadata
  ) values (
    p_school_id, v_caller, 'super_admin', 'configure_billing', 'school_billing_configs', v_result.id::text,
    jsonb_build_object(
      'price_per_student', p_price_per_student,
      'billing_frequency', p_billing_frequency,
      'discount_type', p_discount_type,
      'discount_value', p_discount_value,
      'pass_fee_markup', p_pass_fee_markup
    )
  );

  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 8. RPC: Generate School Invoice (Monthly or Semester)
-- -----------------------------------------------------------------------------
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
  v_billing_month  date;
  v_inv_number     text;
  v_result         public.semester_billing;
begin
  if not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can generate invoices' using errcode = '42501';
  end if;

  select * into v_cfg from public.school_billing_configs where school_id = p_school_id;
  if not found then
    -- Provision default if missing
    insert into public.school_billing_configs (school_id)
    values (p_school_id)
    returning * into v_cfg;
  end if;

  v_price := v_cfg.price_per_student;
  v_due_date := coalesce(p_period_date, current_date) + (v_cfg.due_days || ' days')::interval;
  v_grace_end := v_due_date + (v_cfg.grace_period_days || ' days')::interval;
  v_inv_number := 'INV-' || to_char(coalesce(p_period_date, current_date), 'YYMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  if v_cfg.billing_frequency = 'monthly' then
    v_billing_month := date_trunc('month', coalesce(p_period_date, current_date))::date;
    v_period_label := to_char(v_billing_month, 'FMMonth YYYY');

    -- Count active students currently enrolled in the school
    select count(distinct id) into v_student_count
    from public.students
    where school_id = p_school_id and enrollment_status = 'active';

    v_subtotal := v_student_count * v_price;

    -- Calculate discount
    if v_cfg.discount_type = 'percentage' and v_cfg.discount_value > 0 then
      v_discount := round(v_subtotal * (v_cfg.discount_value / 100.0), 2);
    elsif v_cfg.discount_type = 'fixed' and v_cfg.discount_value > 0 then
      v_discount := least(v_subtotal, v_cfg.discount_value);
    end if;

    -- Calculate 3% fee markup if enabled
    if v_cfg.pass_fee_markup and v_cfg.fee_markup_percent > 0 then
      v_markup := round((v_subtotal - v_discount) * (v_cfg.fee_markup_percent / 100.0), 2);
    end if;

    v_total := v_subtotal - v_discount + v_markup;

    insert into public.semester_billing (
      school_id,
      semester_id,
      billing_frequency,
      billing_month,
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
      subscription_status,
      last_calculated_at
    ) values (
      p_school_id,
      null,
      'monthly',
      v_billing_month,
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
      'awaiting_payment',
      now()
    )
    on conflict (school_id, billing_month) where billing_month is not null
    do update set
      student_count      = excluded.student_count,
      price_per_student  = excluded.price_per_student,
      discount_amount    = excluded.discount_amount,
      fee_markup_amount  = excluded.fee_markup_amount,
      total_payable      = excluded.total_payable,
      due_date           = coalesce(public.semester_billing.due_date, excluded.due_date),
      grace_period_end   = coalesce(public.semester_billing.grace_period_end, excluded.grace_period_end),
      last_calculated_at = now()
    returning * into v_result;

  else
    -- Semester billing
    if p_semester_id is null then
      select id into p_semester_id
      from public.semesters
      where school_id = p_school_id and is_current = true
      limit 1;
    end if;

    if p_semester_id is null then
      raise exception 'No current semester found for school %', p_school_id using errcode = 'P0002';
    end if;

    -- Count registered students in this semester (excluding voided)
    select count(distinct student_id) into v_student_count
    from public.student_enrollments
    where semester_id = p_semester_id and status <> 'voided';

    select se.name || ' · ' || ay.name into v_period_label
    from public.semesters se
    join public.academic_years ay on ay.id = se.academic_year_id
    where se.id = p_semester_id;

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
      subscription_status,
      last_calculated_at
    ) values (
      p_school_id,
      p_semester_id,
      'semester',
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
      'awaiting_payment',
      now()
    )
    on conflict (school_id, semester_id) where semester_id is not null
    do update set
      student_count      = excluded.student_count,
      price_per_student  = excluded.price_per_student,
      discount_amount    = excluded.discount_amount,
      fee_markup_amount  = excluded.fee_markup_amount,
      total_payable      = excluded.total_payable,
      period_label       = coalesce(public.semester_billing.period_label, excluded.period_label),
      due_date           = coalesce(public.semester_billing.due_date, excluded.due_date),
      grace_period_end   = coalesce(public.semester_billing.grace_period_end, excluded.grace_period_end),
      last_calculated_at = now()
    returning * into v_result;

  end if;

  return v_result;
end $$;

-- -----------------------------------------------------------------------------
-- 9. RPC: Platform Billing Metrics
-- -----------------------------------------------------------------------------
create or replace function public.platform_billing_metrics()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := auth.uid();
  v_total_schools integer := 0;
  v_active_schools integer := 0;
  v_monthly_schools integer := 0;
  v_semester_schools integer := 0;
  v_total_paid numeric(14,2) := 0;
  v_total_due numeric(14,2) := 0;
  v_outstanding numeric(14,2) := 0;
  v_overdue_schools integer := 0;
  v_grace_schools integer := 0;
  v_suspended_schools integer := 0;
begin
  if not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select count(*) into v_total_schools from public.schools;
  select count(*) into v_active_schools from public.schools where status = 'active';

  select count(*) filter (where billing_frequency = 'monthly'),
         count(*) filter (where billing_frequency = 'semester'),
         count(*) filter (where status = 'grace_period'),
         count(*) filter (where status = 'suspended')
    into v_monthly_schools, v_semester_schools, v_grace_schools, v_suspended_schools
    from public.school_billing_configs;

  select coalesce(sum(amount), 0) into v_total_paid
  from public.payments
  where status = 'valid';

  select coalesce(sum(coalesce(total_payable, amount_due)), 0),
         coalesce(sum(greatest(0, coalesce(total_payable, amount_due) - amount_paid)), 0)
    into v_total_due, v_outstanding
    from public.semester_billing;

  select count(distinct school_id) into v_overdue_schools
  from public.semester_billing
  where due_date < current_date and amount_paid < coalesce(total_payable, amount_due);

  return jsonb_build_object(
    'total_schools', v_total_schools,
    'active_schools', v_active_schools,
    'monthly_schools', v_monthly_schools,
    'semester_schools', v_semester_schools,
    'total_paid', v_total_paid,
    'total_due', v_total_due,
    'outstanding', v_outstanding,
    'overdue_schools', v_overdue_schools,
    'grace_period_schools', v_grace_schools,
    'suspended_schools', v_suspended_schools
  );
end $$;

-- -----------------------------------------------------------------------------
-- 10. Row Level Security Policies
-- -----------------------------------------------------------------------------
alter table public.school_billing_configs enable row level security;
alter table public.payment_authorizations enable row level security;
alter table public.paystack_transactions enable row level security;
alter table public.billing_reminders enable row level security;

-- school_billing_configs: Super Admin full access, School Headmaster view own
drop policy if exists "billing_configs: super admin all" on public.school_billing_configs;
create policy "billing_configs: super admin all" on public.school_billing_configs
  for all to authenticated
  using (exists (select 1 from public.platform_admins where user_id = auth.uid()));

drop policy if exists "billing_configs: school view own" on public.school_billing_configs;
create policy "billing_configs: school view own" on public.school_billing_configs
  for select to authenticated
  using (exists (
    select 1 from public.school_memberships
    where school_id = public.school_billing_configs.school_id
      and user_id = auth.uid()
      and role = 'headmaster'
      and status = 'active'
  ));

-- payment_authorizations: Super Admin view all, Headmaster view own
drop policy if exists "authorizations: super admin all" on public.payment_authorizations;
create policy "authorizations: super admin all" on public.payment_authorizations
  for all to authenticated
  using (exists (select 1 from public.platform_admins where user_id = auth.uid()));

drop policy if exists "authorizations: school view own" on public.payment_authorizations;
create policy "authorizations: school view own" on public.payment_authorizations
  for select to authenticated
  using (exists (
    select 1 from public.school_memberships
    where school_id = public.payment_authorizations.school_id
      and user_id = auth.uid()
      and role = 'headmaster'
      and status = 'active'
  ));

-- paystack_transactions: Super Admin view all, Headmaster view own
drop policy if exists "paystack_tx: super admin all" on public.paystack_transactions;
create policy "paystack_tx: super admin all" on public.paystack_transactions
  for all to authenticated
  using (exists (select 1 from public.platform_admins where user_id = auth.uid()));

drop policy if exists "paystack_tx: school view own" on public.paystack_transactions;
create policy "paystack_tx: school view own" on public.paystack_transactions
  for select to authenticated
  using (exists (
    select 1 from public.school_memberships
    where school_id = public.paystack_transactions.school_id
      and user_id = auth.uid()
      and role = 'headmaster'
      and status = 'active'
  ));

-- billing_reminders: Super Admin view all, Headmaster view own
drop policy if exists "reminders: super admin all" on public.billing_reminders;
create policy "reminders: super admin all" on public.billing_reminders
  for all to authenticated
  using (exists (select 1 from public.platform_admins where user_id = auth.uid()));

drop policy if exists "reminders: school view own" on public.billing_reminders;
create policy "reminders: school view own" on public.billing_reminders
  for select to authenticated
  using (exists (
    select 1 from public.school_memberships
    where school_id = public.billing_reminders.school_id
      and user_id = auth.uid()
      and role = 'headmaster'
      and status = 'active'
  ));

-- Grant permissions to authenticated and service_role
grant select on public.school_billing_configs to authenticated;
grant select on public.payment_authorizations to authenticated;
grant select on public.paystack_transactions to authenticated;
grant select on public.billing_reminders to authenticated;

grant all on public.school_billing_configs to service_role;
grant all on public.payment_authorizations to service_role;
grant all on public.paystack_transactions to service_role;
grant all on public.billing_reminders to service_role;

grant execute on function public.upsert_school_billing_config to authenticated, service_role;
grant execute on function public.generate_school_invoice to authenticated, service_role;
grant execute on function public.platform_billing_metrics to authenticated, service_role;

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
