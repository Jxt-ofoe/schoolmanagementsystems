-- =============================================================================
-- Migration 19: Update Billing Price to GH₵ 10.00 per student per semester/term
-- =============================================================================

-- 1. Update platform default settings to GHS 10.00
update public.platform_settings
set price_per_student = 10.00,
    updated_at = now()
where id = true;

-- Ensure schema default in platform_settings is 10.00
alter table public.platform_settings
  alter column price_per_student set default 10.00;

-- 2. Update default price in school_billing_configs table
alter table public.school_billing_configs
  alter column price_per_student set default 10.00;

-- Update existing configs that were on default rates (3.00 or 5.00)
update public.school_billing_configs
set price_per_student = 10.00,
    updated_at = now()
where price_per_student in (3.00, 5.00);

-- 3. Update future school billing provisioning trigger
create or replace function private.provision_school_billing_config()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_default_price numeric(10,2) := 10.00;
  v_due_days integer := 14;
begin
  select coalesce(price_per_student, 10.00)
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
    status
  ) values (
    new.id,
    v_default_price,
    'term',
    current_date,
    current_date,
    v_due_days,
    30,
    'active'
  ) on conflict (school_id) do nothing;

  return new;
end;
$$;

-- 4. Update check_and_enforce_school_billing_status with 10.00 fallback
create or replace function public.check_and_enforce_school_billing_status(p_school_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_current_sem     record;
  v_cfg             record;
  v_main_invoice    record;
  v_price           numeric(10,2) := 10.00;
  v_student_count   integer := 0;
  v_subtotal        numeric(12,2);
  v_discount        numeric(12,2) := 0.00;
  v_markup          numeric(12,2) := 0.00;
  v_total           numeric(12,2);
  v_issue_date      date;
  v_due_date        date;
  v_grace_end       date;
  v_period_label    text;
  v_inv_number      text;
  v_days_into_term  integer := 0;
  v_is_overdue      boolean := false;
  v_has_unpaid      boolean := false;
  v_school_status   text;
  v_topup_pending   integer := 0;
begin
  -- Caller authorization check: only super admin, headmaster of the school, or service_role/system
  if not (coalesce((select auth.role()), '') = 'service_role'
          or (select auth.uid()) is null
          or private.is_super_admin()
          or private.is_member_any_school_status(p_school_id, array['headmaster'])) then
    raise exception 'Unauthorized: cannot enforce billing for this school' using errcode = '42501';
  end if;

  select status into v_school_status from public.schools where id = p_school_id;
  if not found then
    return jsonb_build_object('error', 'School not found');
  end if;

  -- Load billing config
  select * into v_cfg from public.school_billing_configs where school_id = p_school_id;
  if found then
    v_price := coalesce(v_cfg.price_per_student, 10.00);
  else
    insert into public.school_billing_configs (school_id, price_per_student, billing_frequency, status)
    values (p_school_id, 10.00, 'term', 'active')
    returning * into v_cfg;
    v_price := 10.00;
  end if;

  -- Find current semester
  select s.id, s.starts_on, s.name, ay.name as academic_year_name
  into v_current_sem
  from public.semesters s
  left join public.academic_years ay on ay.id = s.academic_year_id
  where s.school_id = p_school_id and s.is_current = true
  limit 1;

  if v_current_sem.id is not null and v_current_sem.starts_on is not null then
    v_days_into_term := current_date - v_current_sem.starts_on;
    v_grace_end := v_current_sem.starts_on + interval '30 days';

    -- Update billing config with grace period end
    update public.school_billing_configs
    set grace_period_end = v_grace_end,
        term_started_at = v_current_sem.starts_on,
        updated_at = now()
    where school_id = p_school_id
      and (grace_period_end is distinct from v_grace_end or term_started_at is distinct from v_current_sem.starts_on);

    -- Check if main term invoice exists
    select * into v_main_invoice
    from public.semester_billing
    where school_id = p_school_id
      and semester_id = v_current_sem.id
      and (is_topup is false or is_topup is null)
    limit 1;

    -- Day 30 Invoice Generation:
    if v_days_into_term >= 30 and v_main_invoice.id is null then
      v_issue_date := v_grace_end;
      v_due_date := v_issue_date + interval '7 days';

      -- Snapshot active students as of Day 30
      v_student_count := public.school_active_student_snapshot(p_school_id, v_current_sem.id, v_issue_date);
      if v_student_count = 0 then
        select count(*) into v_student_count
        from public.students
        where school_id = p_school_id and enrollment_status = 'active';
      end if;

      v_period_label := v_current_sem.name || coalesce(' · ' || v_current_sem.academic_year_name, '');
      v_inv_number := 'INV-' || to_char(v_issue_date, 'YYMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
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
        issue_date,
        is_topup,
        subscription_status,
        last_calculated_at
      ) values (
        p_school_id,
        v_current_sem.id,
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
        v_issue_date,
        v_issue_date,
        false,
        'awaiting_payment',
        now()
      )
      returning * into v_main_invoice;
    end if;
  end if;

  -- Calculate pending top-up students count
  select coalesce(sum(student_count), 0)
  into v_topup_pending
  from public.semester_billing
  where school_id = p_school_id
    and is_topup = true
    and amount_paid < coalesce(total_payable, amount_due);

  update public.school_billing_configs
  set pending_topup_count = v_topup_pending
  where school_id = p_school_id
    and pending_topup_count is distinct from v_topup_pending;

  -- Check if ANY invoice (main or top-up) is overdue and unpaid
  select exists (
    select 1
    from public.semester_billing
    where school_id = p_school_id
      and due_date < current_date
      and amount_paid < coalesce(total_payable, amount_due)
  ) into v_is_overdue;

  -- Check if has any unpaid invoices currently issued
  select exists (
    select 1
    from public.semester_billing
    where school_id = p_school_id
      and amount_paid < coalesce(total_payable, amount_due)
  ) into v_has_unpaid;

  -- Access Rule Enforcement
  if v_is_overdue then
    if v_school_status <> 'suspended' then
      update public.schools
      set status = 'suspended', updated_at = now()
      where id = p_school_id;
    end if;

    update public.school_billing_configs
    set status = 'payment_overdue', updated_at = now()
    where school_id = p_school_id and status <> 'payment_overdue';
  else
    if v_school_status = 'suspended' then
      update public.schools
      set status = 'active', updated_at = now()
      where id = p_school_id;
    end if;

    if v_days_into_term < 30 and v_main_invoice.id is null then
      update public.school_billing_configs
      set status = 'active', updated_at = now()
      where school_id = p_school_id and status <> 'active';
    elsif v_has_unpaid then
      update public.school_billing_configs
      set status = 'awaiting_payment', updated_at = now()
      where school_id = p_school_id and status <> 'awaiting_payment';
    else
      update public.school_billing_configs
      set status = 'active', updated_at = now()
      where school_id = p_school_id and status <> 'active';
    end if;
  end if;

  return jsonb_build_object(
    'school_id', p_school_id,
    'school_status', case when v_is_overdue then 'suspended' else 'active' end,
    'in_grace_period', (v_days_into_term < 30),
    'grace_period_end', v_grace_end,
    'days_into_term', v_days_into_term,
    'days_remaining_in_grace', greatest(0, 30 - v_days_into_term),
    'is_overdue', v_is_overdue,
    'has_unpaid', v_has_unpaid,
    'pending_topup_count', v_topup_pending
  );
end $$;

grant execute on function public.check_and_enforce_school_billing_status to authenticated, service_role;

-- 5. Update top-up billing trigger fallback price
create or replace function private.on_student_created_topup_billing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current_sem    record;
  v_main_invoice   record;
  v_cfg            record;
  v_price          numeric(10,2) := 10.00;
  v_inv_num        text;
  v_due_date       date;
  v_period_label   text;
begin
  if new.enrollment_status <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.enrollment_status = 'active' then
    return new;
  end if;

  select s.id, s.name, ay.name as academic_year_name, s.starts_on
  into v_current_sem
  from public.semesters s
  left join public.academic_years ay on ay.id = s.academic_year_id
  where s.school_id = new.school_id and s.is_current = true
  limit 1;

  if v_current_sem.id is null then
    return new;
  end if;

  select * into v_main_invoice
  from public.semester_billing
  where school_id = new.school_id
    and semester_id = v_current_sem.id
    and (is_topup is false or is_topup is null)
  limit 1;

  if v_main_invoice.id is null then
    return new;
  end if;

  if new.admission_date is not null and v_main_invoice.snapshot_date is not null and new.admission_date <= v_main_invoice.snapshot_date then
    return new;
  end if;

  select * into v_cfg from public.school_billing_configs where school_id = new.school_id;
  v_price := coalesce(v_main_invoice.price_per_student, v_cfg.price_per_student, 10.00);

  v_due_date := current_date + interval '7 days';
  v_inv_num := 'TOP-' || to_char(current_date, 'YYMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));
  v_period_label := 'Top-up Invoice (+1 Student) · ' || v_current_sem.name || coalesce(' · ' || v_current_sem.academic_year_name, '');

  insert into public.semester_billing (
    school_id,
    semester_id,
    parent_billing_id,
    billing_frequency,
    period_label,
    student_count,
    price_per_student,
    currency,
    discount_amount,
    fee_markup_amount,
    total_payable,
    due_date,
    invoice_number,
    is_topup,
    subscription_status,
    last_calculated_at
  ) values (
    new.school_id,
    v_current_sem.id,
    v_main_invoice.id,
    'term',
    v_period_label,
    1,
    v_price,
    'GHS',
    0.00,
    0.00,
    v_price,
    v_due_date,
    v_inv_num,
    true,
    'awaiting_payment',
    now()
  );

  update public.school_billing_configs
  set pending_topup_count = coalesce(pending_topup_count, 0) + 1,
      updated_at = now()
  where school_id = new.school_id;

  return new;
end;
$$;

