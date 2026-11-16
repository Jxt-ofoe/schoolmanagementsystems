-- =============================================================================
-- DEPLOY TERM BILLING RPCs TO SUPABASE
-- Run this script in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- =============================================================================

-- 1. Snapshot helper: count active students in a school for a given semester
create or replace function public.school_active_student_snapshot(
  p_school_id   uuid,
  p_semester_id uuid,
  p_as_of_date  date default current_date
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
begin
  select count(distinct s.id) into v_count
  from public.students s
  where s.school_id = p_school_id
    and s.enrollment_status = 'active'
    and (s.admission_date is null or s.admission_date <= p_as_of_date)
    and exists (
      select 1 from public.student_enrollments se
      where se.student_id = s.id
        and se.semester_id = p_semester_id
        and se.school_id = p_school_id
        and se.status = 'registered'
    );
  
  -- Fallback if enrollments aren't used: count active students belonging to the school
  if v_count = 0 then
    select count(*) into v_count
    from public.students s
    where s.school_id = p_school_id
      and s.enrollment_status = 'active'
      and (s.admission_date is null or s.admission_date <= p_as_of_date);
  end if;

  return coalesce(v_count, 0);
end $$;

-- 2. Single School Term Invoice Generator
create or replace function public.generate_school_invoice(
  p_school_id   uuid,
  p_period_date date default current_date,
  p_semester_id uuid default null
)
returns public.semester_billing
language plpgsql security definer set search_path = '' as $$
declare
  v_caller        uuid := auth.uid();
  v_cfg           record;
  v_student_count integer;
  v_price         numeric(10,2);
  v_due_date      date;
  v_grace_end     date;
  v_inv_number    text;
  v_period_label  text;
  v_subtotal      numeric(12,2);
  v_discount      numeric(12,2) := 0.00;
  v_markup        numeric(12,2) := 0.00;
  v_total         numeric(12,2);
  v_result        public.semester_billing;
  v_sem_start     date;
  v_snapshot_date date;
begin
  -- Authorization check: Super Admin or Service Role
  if v_caller is not null and not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can generate invoices' using errcode = '42501';
  end if;

  -- Resolve current semester if not supplied
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
    raise exception 'No active semester found for this school' using errcode = 'P0002';
  end if;

  -- Fetch billing configuration
  select * into v_cfg
  from public.school_billing_configs
  where school_id = p_school_id;

  v_price := coalesce(v_cfg.price_per_student, 3.00);
  v_snapshot_date := coalesce(p_period_date, current_date);

  -- Snapshot student count
  v_student_count := public.school_active_student_snapshot(p_school_id, p_semester_id, v_snapshot_date);

  select se.name || ' · ' || coalesce(ay.name, '2026/2027') into v_period_label
  from public.semesters se
  left join public.academic_years ay on ay.id = se.academic_year_id
  where se.id = p_semester_id;

  v_due_date := coalesce(p_period_date, current_date) + 30;
  v_grace_end := v_due_date + 30;
  v_inv_number := 'INV-' || to_char(coalesce(p_period_date, current_date), 'YYMM') || '-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  v_subtotal := v_student_count * v_price;
  v_total := v_subtotal;

  insert into public.semester_billing (
    school_id,
    semester_id,
    billing_frequency,
    period_label,
    student_count,
    price_per_student,
    currency,
    amount_paid,
    due_date,
    grace_period_end,
    invoice_number,
    subscription_status,
    discount_amount,
    fee_markup_amount,
    total_payable,
    notes,
    last_calculated_at
  ) values (
    p_school_id,
    p_semester_id,
    'semester',
    v_period_label,
    v_student_count,
    v_price,
    'GHS',
    0.00,
    v_due_date,
    v_grace_end,
    v_inv_number,
    'awaiting_payment',
    0.00,
    0.00,
    v_total,
    'Term 1 billing snapshot (' || v_student_count || ' active students @ GHS ' || v_price || ')',
    now()
  )
  returning * into v_result;

  return v_result;
end $$;

-- 3. Batch RPC: Generate invoices for all active schools with active terms
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
  if v_caller is not null and not exists (select 1 from public.platform_admins where user_id = v_caller) then
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
      -- Check if invoice already exists
      if exists (select 1 from public.semester_billing where school_id = v_school.id and semester_id = v_school.current_sem_id) then
        v_skipped := v_skipped + 1;
      else
        begin
          perform public.generate_school_invoice(v_school.id, current_date, v_school.current_sem_id);
          v_generated := v_generated + 1;
        exception when others then
          v_errors := array_append(v_errors, v_school.name || ': ' || sqlerrm);
        end;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'generated', v_generated,
    'skipped', v_skipped,
    'errors', v_errors
  );
end $$;

-- 4. Admin Mark Invoice Paid RPC (Cash & Bank Transfers)
create or replace function public.admin_mark_invoice_paid(
  p_billing_id       uuid,
  p_payment_method   text default 'bank_transfer',
  p_payment_ref      text default null,
  p_receipt_notes    text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_caller  uuid := auth.uid();
  v_bill    public.semester_billing;
  v_amount  numeric(12,2);
  v_pay_id  uuid;
begin
  if v_caller is not null and not exists (select 1 from public.platform_admins where user_id = v_caller) then
    raise exception 'Unauthorized: Only platform super administrators can record offline payments' using errcode = '42501';
  end if;

  select * into v_bill
  from public.semester_billing
  where id = p_billing_id;

  if v_bill.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  v_amount := coalesce(v_bill.total_payable, v_bill.balance, v_bill.amount_due, 0.00);

  -- Insert payment record
  insert into public.payments (
    school_id,
    billing_id,
    amount,
    method,
    reference,
    notes,
    verification,
    status,
    paid_on
  ) values (
    v_bill.school_id,
    v_bill.id,
    v_amount,
    coalesce(p_payment_method, 'bank_transfer'),
    coalesce(p_payment_ref, 'OFFLINE-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8))),
    coalesce(p_receipt_notes, 'Direct admin offline payment verification'),
    'manual',
    'valid',
    current_date
  ) returning id into v_pay_id;

  -- Update invoice balance & status
  update public.semester_billing
  set amount_paid = v_amount,
      subscription_status = 'active',
      updated_at = now()
  where id = v_bill.id;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_pay_id,
    'amount', v_amount,
    'invoice_number', v_bill.invoice_number
  );
end $$;

-- 5. Grant Permissions
grant execute on function public.school_active_student_snapshot to authenticated, service_role;
grant execute on function public.generate_school_invoice to authenticated, service_role;
grant execute on function public.generate_all_school_term_invoices to authenticated, service_role;
grant execute on function public.admin_mark_invoice_paid to authenticated, service_role;

