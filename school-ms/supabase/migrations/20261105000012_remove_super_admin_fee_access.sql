-- Migration: Revoke Super Admin access to school fees and payments
-- School fees management remains exclusively for authorized school administrators (headmasters)

-- 1. Redefine Fee Categories read policy (Headmaster only)
drop policy if exists "fees: headmaster read categories" on public.fee_categories;
create policy "fees: headmaster read categories" on public.fee_categories
  for select to authenticated using (private.is_headmaster(school_id));

-- 2. Redefine Fee Structures read policy (Headmaster only)
drop policy if exists "fees: headmaster read structures" on public.fee_structures;
create policy "fees: headmaster read structures" on public.fee_structures
  for select to authenticated using (private.is_headmaster(school_id));

-- 3. Redefine Student Fee Charges read policy (Headmaster only)
drop policy if exists "fees: headmaster read charges" on public.student_fee_charges;
create policy "fees: headmaster read charges" on public.student_fee_charges
  for select to authenticated using (private.is_headmaster(school_id));

-- 4. Redefine Student Fee Payments read policy (Headmaster only)
drop policy if exists "fees: headmaster read payments" on public.student_fee_payments;
create policy "fees: headmaster read payments" on public.student_fee_payments
  for select to authenticated using (private.is_headmaster(school_id));

-- 5. Update student_fee_statement RPC to disallow super admin
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
  if v_school is null or not private.is_headmaster(v_school) then
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

