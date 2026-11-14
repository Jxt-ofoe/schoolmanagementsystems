-- =============================================================================
-- Migration 14: Comprehensive Per-Term Billing, Grace Period, Top-ups & Access Control
-- -----------------------------------------------------------------------------
-- Flow & Rules:
-- 1. Term Start: 30-day grace period with full access to register students. No invoice yet.
-- 2. Day 30: Snapshot active students & generate term invoice (count × price_per_student).
--    Due date is 7 days after issue. Invoices retain original price once issued.
-- 3. Access Rules:
--    - Grace period or invoice paid: full access.
--    - Invoice unpaid after due date: school is suspended. Headmaster & teachers only see billing page.
--    - Warning banner shown from issue date until paid.
--    - Access enforced on server in RLS and API.
-- 4. Top-ups:
--    - After snapshot, adding a student creates a top-up invoice (new students × price).
--    - Top-up invoices due in 7 days; school suspended if unpaid after due date.
-- 5. Payment:
--    - Paystack (card & mobile money): only webhook marks invoice paid, never redirect.
--    - Admin-only "Mark as paid" RPC with reference field for cash and bank transfers.
-- 6. Migration:
--    - Monthly-billed schools move to per-term flow from next term; historical data preserved.
-- =============================================================================

-- 1. Schema Enhancements on public.semester_billing
alter table public.semester_billing
  add column if not exists is_topup boolean not null default false,
  add column if not exists parent_billing_id uuid references public.semester_billing(id) on delete set null,
  add column if not exists issue_date date default current_date;

-- Drop old index that restricted to 1 invoice per semester across all types
drop index if exists public.semester_billing_school_sem_uq;

-- Recreate index to allow multiple top-up invoices while ensuring exactly 1 main term invoice per semester
create unique index if not exists semester_billing_school_sem_main_uq
  on public.semester_billing (school_id, semester_id)
  where semester_id is not null and (is_topup is false or is_topup is null);

-- 2. Schema Enhancements on public.school_billing_configs
alter table public.school_billing_configs
  add column if not exists pending_topup_count integer not null default 0 check (pending_topup_count >= 0),
  add column if not exists grace_period_end date,
  add column if not exists term_started_at date;

-- Ensure default pricing is GHS 3.00
alter table public.school_billing_configs
  alter column price_per_student set default 3.00;

-- 3. RLS policy on public.semester_billing and public.payments
-- Allow headmaster AND teachers to select billing records even when school is suspended
drop policy if exists "billing: super admin or own headmaster" on public.semester_billing;
create policy "billing: super admin or school staff" on public.semester_billing
  for select to authenticated using (
    (select private.is_super_admin()) or
    private.is_member_any_school_status(school_id, array['headmaster', 'teacher'])
  );

drop policy if exists "payments: super admin or own headmaster" on public.payments;
create policy "payments: super admin or school staff" on public.payments
  for select to authenticated using (
    (select private.is_super_admin()) or
    private.is_member_any_school_status(school_id, array['headmaster', 'teacher'])
  );

-- 4. Server-Side Enforcement Function: public.check_and_enforce_school_billing_status
create or replace function public.check_and_enforce_school_billing_status(p_school_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_current_sem     record;
  v_cfg             record;
  v_main_invoice    record;
  v_price           numeric(10,2) := 3.00;
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
  select status into v_school_status from public.schools where id = p_school_id;
  if not found then
    return jsonb_build_object('error', 'School not found');
  end if;

  -- Load billing config
  select * into v_cfg from public.school_billing_configs where school_id = p_school_id;
  if found then
    v_price := coalesce(v_cfg.price_per_student, 3.00);
  else
    insert into public.school_billing_configs (school_id, price_per_student, billing_frequency, status)
    values (p_school_id, 3.00, 'term', 'active')
    returning * into v_cfg;
    v_price := 3.00;
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
    -- If 30 or more days into the term and no main invoice exists yet, snapshot and issue Day 30 invoice!
    if v_days_into_term >= 30 and v_main_invoice.id is null then
      v_issue_date := v_grace_end;
      v_due_date := v_issue_date + interval '7 days';

      -- Snapshot active students as of Day 30
      v_student_count := public.school_active_student_snapshot(p_school_id, v_current_sem.id, v_issue_date);
      if v_student_count = 0 then
        -- Count current active students if snapshot is 0
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
  -- Due date has passed and balance > 0
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

  -- Access Rule Enforcement:
  -- If overdue: suspend school immediately
  -- If paid or in grace period without overdue invoices: keep/restore school active
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
    -- Not overdue. If school was suspended due to billing, restore it to active!
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

-- 5. Batch Enforcement across all active schools
create or replace function public.check_and_enforce_all_schools_billing_status()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_school record;
  v_count integer := 0;
begin
  if not private.is_super_admin() then
    raise exception 'Unauthorized: Only platform super administrators can batch enforce school billing' using errcode = '42501';
  end if;

  for v_school in select id from public.schools order by name loop
    perform public.check_and_enforce_school_billing_status(v_school.id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('checked_schools', v_count);
end $$;

-- 6. Trigger: Top-up Invoices on Student Addition
-- After snapshot, whenever a student is added, create a top-up invoice (due 7 days after created)
create or replace function private.handle_student_billing_topup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current_sem    record;
  v_main_invoice   record;
  v_cfg            record;
  v_price          numeric(10,2) := 3.00;
  v_inv_num        text;
  v_due_date       date;
  v_period_label   text;
begin
  -- Only trigger for active enrollments
  if new.enrollment_status <> 'active' then
    return new;
  end if;

  -- For updates, only trigger if transitioning from inactive/pending to active
  if tg_op = 'UPDATE' and old.enrollment_status = 'active' then
    return new;
  end if;

  -- Find current semester
  select s.id, s.name, ay.name as academic_year_name, s.starts_on
  into v_current_sem
  from public.semesters s
  left join public.academic_years ay on ay.id = s.academic_year_id
  where s.school_id = new.school_id and s.is_current = true
  limit 1;

  if v_current_sem.id is null then
    return new;
  end if;

  -- Check if main term invoice exists
  select * into v_main_invoice
  from public.semester_billing
  where school_id = new.school_id
    and semester_id = v_current_sem.id
    and (is_topup is false or is_topup is null)
  limit 1;

  -- If NO main invoice exists yet, we are still within the 30-day grace period!
  -- No top-up needed, student will be captured on Day 30 snapshot.
  if v_main_invoice.id is null then
    return new;
  end if;

  -- If student was admitted on or before snapshot date, do not duplicate charge
  if new.admission_date is not null and v_main_invoice.snapshot_date is not null and new.admission_date <= v_main_invoice.snapshot_date then
    return new;
  end if;

  -- Get agreed pricing
  select * into v_cfg from public.school_billing_configs where school_id = new.school_id;
  v_price := coalesce(v_main_invoice.price_per_student, v_cfg.price_per_student, 3.00);

  -- Top-up invoice due 7 days after creation
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
    issue_date,
    invoice_number,
    is_topup,
    subscription_status,
    notes,
    last_calculated_at
  ) values (
    new.school_id,
    v_current_sem.id,
    v_main_invoice.id,
    'term',
    1,
    v_price,
    'GHS',
    0.00,
    0.00,
    v_price,
    v_due_date,
    current_date,
    v_inv_num,
    true,
    'awaiting_payment',
    'Post-snapshot student addition: ' || coalesce(new.first_name || ' ' || new.last_name, 'New Student'),
    now()
  );

  -- Update pending top-up count
  update public.school_billing_configs
  set pending_topup_count = pending_topup_count + 1,
      updated_at = now()
  where school_id = new.school_id;

  return new;
end $$;

drop trigger if exists trigger_student_billing_topup on public.students;
create trigger trigger_student_billing_topup
  after insert or update of enrollment_status on public.students
  for each row execute function private.handle_student_billing_topup();

-- 7. Admin-Only "Mark as Paid" RPC for Cash & Bank Transfers
create or replace function public.admin_mark_invoice_paid(
  p_billing_id uuid,
  p_amount     numeric default null,
  p_method     text default 'bank_transfer',
  p_reference  text default null,
  p_paid_on    date default current_date,
  p_notes      text default null
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_caller     uuid := auth.uid();
  v_billing    record;
  v_amount     numeric(12,2);
  v_payment_id uuid;
begin
  if not private.is_super_admin() then
    raise exception 'Unauthorized: Only platform super administrators can record offline payments' using errcode = '42501';
  end if;

  select * into v_billing from public.semester_billing where id = p_billing_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'A valid reference number is required for cash and bank transfer payments' using errcode = '23514';
  end if;

  -- Default amount to remaining balance if not explicitly specified
  if p_amount is null or p_amount <= 0 then
    v_amount := greatest(0.01, coalesce(v_billing.total_payable, v_billing.amount_due) - v_billing.amount_paid);
  else
    v_amount := round(p_amount, 2);
  end if;

  if v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '23514';
  end if;

  insert into public.payments (
    school_id,
    billing_id,
    amount,
    method,
    reference,
    paid_on,
    notes,
    verification,
    provider,
    status,
    recorded_by
  ) values (
    v_billing.school_id,
    p_billing_id,
    v_amount,
    p_method,
    btrim(p_reference),
    coalesce(p_paid_on, current_date),
    coalesce(nullif(btrim(p_notes), ''), 'Offline payment recorded by Super Admin (' || p_method || ')'),
    'recorded_by_admin',
    'offline',
    'valid',
    v_caller
  )
  returning id into v_payment_id;

  -- Enforce status update immediately
  perform public.check_and_enforce_school_billing_status(v_billing.school_id);

  return v_payment_id;
end $$;

-- 8. Enhanced Payment Sync Trigger
-- Ensures subscription_status on invoice is updated and checks school status
create or replace function private.sync_amount_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_billing_id uuid := coalesce(new.billing_id, old.billing_id);
  v_school_id  uuid := coalesce(new.school_id, old.school_id);
  v_total_paid numeric(12,2) := 0.00;
  v_payable    numeric(12,2) := 0.00;
begin
  if v_billing_id is not null then
    select coalesce(sum(amount), 0) into v_total_paid
    from public.payments
    where billing_id = v_billing_id and status = 'valid';

    select coalesce(total_payable, amount_due, 0) into v_payable
    from public.semester_billing
    where id = v_billing_id;

    update public.semester_billing
    set amount_paid = v_total_paid,
        subscription_status = case
          when v_total_paid >= v_payable and v_payable > 0 then 'paid'
          when v_total_paid > 0 then 'partial'
          else subscription_status
        end,
        updated_at = now()
    where id = v_billing_id;

    if v_school_id is null then
      select school_id into v_school_id from public.semester_billing where id = v_billing_id;
    end if;

    if v_school_id is not null then
      perform public.check_and_enforce_school_billing_status(v_school_id);
    end if;
  end if;

  return null;
end $$;

-- 9. Real-time Lazy Enforcement via public.my_context()
-- Every time a user's context is loaded on login or page load, runs lazy check!
create or replace function public.my_context()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_school_id uuid;
begin
  -- Lazy enforcement for caller's schools
  if v_uid is not null then
    for v_school_id in
      select m.school_id
      from public.school_memberships m
      where m.user_id = v_uid and m.status = 'active'
    loop
      perform public.check_and_enforce_school_billing_status(v_school_id);
    end loop;
  end if;

  return jsonb_build_object(
    'user_id', v_uid,
    'is_super_admin', private.is_super_admin(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', m.id, 'school_id', m.school_id, 'role', m.role, 'status', m.status,
        'school_name', s.name, 'school_code', s.code, 'school_status', s.status) order by s.name)
      from public.school_memberships m join public.schools s on s.id = m.school_id
      where m.user_id = v_uid and m.status = 'active'
    ), '[]'::jsonb)
  );
end $$;

-- 10. Recreate View public.billing_overview with Top-up & Grace Period columns
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
           when b.is_topup then 'Top-up Invoice (' || b.student_count || ' Students)'
           when b.semester_id is not null then se.name || coalesce(' · ' || ay.name, '')
           when b.billing_month is not null then to_char(b.billing_month, 'FMMonth YYYY')
           else 'Term Invoice'
         end
       ) as period_label,
       b.semester_id,
       se.name as semester_name,
       ay.name as academic_year_name,
       coalesce(se.is_current, false) as is_current,
       se.starts_on as term_starts_on,
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
       b.issue_date,
       b.is_topup,
       b.parent_billing_id,
       b.notes,
       b.last_calculated_at,
       b.created_at,
       (select max(p.paid_on) from public.payments p where p.billing_id = b.id and p.status = 'valid') as last_paid_on,
       case
         when b.amount_due = 0 and b.total_payable = 0 then 'no_charge'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'paid'
         when b.amount_paid > 0 then 'partial'
         else 'unpaid'
       end as payment_status,
       case
         when b.amount_due = 0 and b.total_payable = 0 then 'not_applicable'
         when b.amount_paid >= coalesce(b.total_payable, b.amount_due) then 'renewed'
         when b.due_date < current_date and b.amount_paid < coalesce(b.total_payable, b.amount_due) then 'overdue'
         else 'pending'
       end as renewal_status,
       case
         when se.starts_on is not null and current_date < (se.starts_on + interval '30 days') then true
         else false
       end as in_grace_period,
       case
         when se.starts_on is not null then greatest(0, 30 - (current_date - se.starts_on))
         else 0
       end as days_remaining_in_grace
from public.semester_billing b
join public.schools sc on sc.id = b.school_id
left join public.semesters se on se.id = b.semester_id
left join public.academic_years ay on ay.id = se.academic_year_id
left join public.school_billing_configs cfg on cfg.school_id = b.school_id;

-- Grants
grant execute on function public.check_and_enforce_school_billing_status to authenticated, service_role;
grant execute on function public.check_and_enforce_all_schools_billing_status to authenticated, service_role;
grant execute on function public.admin_mark_invoice_paid to authenticated, service_role;
grant execute on function public.my_context to authenticated, service_role;
grant select on public.billing_overview to authenticated;

