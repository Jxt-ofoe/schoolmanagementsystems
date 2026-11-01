-- =============================================================================
-- Migration 8: Security Remediation Phase 1 & Defense-in-Depth Hardening
-- -----------------------------------------------------------------------------
-- Addresses Priority Security Findings:
--  1. [F-01] Terminal Reports: Restrict publishing, remarks, and published edits
--  2. [F-02] Result Submissions: Restrict review/approval transitions to Headmaster
--  3. [F-03] Storage: Restrict school logo upload/update/delete to authorized headmaster
--  4. [F-04] Fee Payments: Revoke hard delete; lock payment attribution and immutability
--  5. [F-05] Multi-Tenancy: Add prevent_school_change triggers to Migration 6 tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. [F-01] Terminal Reports: Integrity Trigger & Lifecycle Enforcement
-- -----------------------------------------------------------------------------
create or replace function private.validate_terminal_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_hm boolean;
begin
  v_is_hm := private.is_headmaster(new.school_id) or (select private.is_super_admin());

  if tg_op = 'INSERT' then
    -- Non-headmaster cannot set status = 'published' on insert
    if new.status = 'published' and not v_is_hm then
      raise exception 'Only the headmaster can approve and publish a terminal report' using errcode = '42501';
    end if;

    -- Non-headmaster cannot forge headmaster remarks or promotion recommendation
    if not v_is_hm then
      new.headmaster_remarks := null;
      new.promotion_recommendation := null;
    end if;

    if new.status = 'published' then
      new.published_at := coalesce(new.published_at, now());
      new.published_by := coalesce((select auth.uid()), new.published_by);
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Once a report is published, non-headmasters cannot alter it at all
    if old.status = 'published' and not v_is_hm then
      raise exception 'Only the headmaster can modify or unpublish a published report card' using errcode = '42501';
    end if;

    -- Non-headmaster cannot transition report to 'published' or 'approved'
    if new.status in ('published','approved') and old.status not in ('published','approved') and not v_is_hm then
      raise exception 'Only the headmaster can approve and publish a terminal report' using errcode = '42501';
    end if;

    -- Non-headmaster cannot alter headmaster remarks or promotion recommendation
    if not v_is_hm then
      new.headmaster_remarks := old.headmaster_remarks;
      new.promotion_recommendation := old.promotion_recommendation;
    end if;

    -- Attribution locking on publishing
    if new.status = 'published' and (old.status is distinct from 'published' or old.published_by is null) then
      new.published_at := coalesce(new.published_at, now());
      new.published_by := coalesce((select auth.uid()), new.published_by);
    elsif new.status <> 'published' then
      new.published_at := null;
      new.published_by := null;
    else
      new.published_by := old.published_by;
      new.published_at := old.published_at;
    end if;

    new.updated_at := now();
    return new;
  end if;

  return new;
end $$;

drop trigger if exists validate_terminal_report on public.terminal_reports;
create trigger validate_terminal_report
  before insert or update on public.terminal_reports
  for each row execute function private.validate_terminal_report();

-- -----------------------------------------------------------------------------
-- 2. [F-02] Result Submissions: Restrict Review and Approval to Headmaster
-- -----------------------------------------------------------------------------
create or replace function private.validate_subject_result_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_hm boolean;
begin
  v_is_hm := private.is_headmaster(new.school_id) or (select private.is_super_admin());

  if tg_op = 'INSERT' then
    if new.status in ('reviewed','approved') and not v_is_hm then
      raise exception 'Only the headmaster can review or approve subject submissions' using errcode = '42501';
    end if;

    new.submitted_by := coalesce((select auth.uid()), new.submitted_by);
    if new.status = 'submitted' and new.submitted_at is null then
      new.submitted_at := now();
    end if;

    if v_is_hm and new.status in ('reviewed','approved') then
      new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
      new.reviewed_at := coalesce(new.reviewed_at, now());
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Non-headmaster cannot transition status to 'reviewed', 'approved', or 'returned'
    if new.status in ('reviewed','approved','returned') and old.status not in ('reviewed','approved','returned') and not v_is_hm then
      raise exception 'Only the headmaster can review, approve, or return subject submissions' using errcode = '42501';
    end if;

    -- If already approved, teacher cannot revert or alter without headmaster
    if old.status = 'approved' and not v_is_hm then
      raise exception 'Only the headmaster can alter or reopen an approved subject submission' using errcode = '42501';
    end if;

    -- Attribution locks on submission
    if new.status = 'submitted' and old.status <> 'submitted' then
      new.submitted_by := coalesce((select auth.uid()), new.submitted_by);
      new.submitted_at := now();
    else
      new.submitted_by := old.submitted_by;
      new.submitted_at := old.submitted_at;
    end if;

    -- Attribution locks on review
    if v_is_hm and new.status in ('reviewed','approved','returned') then
      new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
      new.reviewed_at := now();
    else
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
      new.feedback := old.feedback;
    end if;

    new.updated_at := now();
    return new;
  end if;

  return new;
end $$;

drop trigger if exists validate_subject_result_submission on public.subject_result_submissions;
create trigger validate_subject_result_submission
  before insert or update on public.subject_result_submissions
  for each row execute function private.validate_subject_result_submission();

-- -----------------------------------------------------------------------------
-- 3. [F-03] Storage: Multi-Tenant Authorization for `school-logos` Bucket
-- -----------------------------------------------------------------------------
create or replace function private.can_manage_school_logo(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[];
  v_school_id uuid;
begin
  if (select private.is_super_admin()) then
    return true;
  end if;

  v_parts := string_to_array(p_path, '/');
  if array_length(v_parts, 1) < 2 then
    return false;
  end if;

  -- Verify first segment of path is a valid UUID representing the school_id
  if v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  v_school_id := v_parts[1]::uuid;
  return private.is_headmaster(v_school_id);
end $$;
grant execute on function private.can_manage_school_logo(text) to authenticated, service_role;

-- Update Storage RLS policies to enforce school ownership on upload, update, delete
drop policy if exists "Authorized users can upload school logos" on storage.objects;
create policy "Authorized users can upload school logos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'school-logos'
  and private.can_manage_school_logo(name)
);

drop policy if exists "Authorized users can update school logos" on storage.objects;
create policy "Authorized users can update school logos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'school-logos'
  and private.can_manage_school_logo(name)
);

drop policy if exists "Authorized users can delete school logos" on storage.objects;
create policy "Authorized users can delete school logos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'school-logos'
  and private.can_manage_school_logo(name)
);

-- -----------------------------------------------------------------------------
-- 4. [F-04] Fee Management: Revoke Hard DELETE and Lock Payment Immutability
-- -----------------------------------------------------------------------------
-- Prevent hard deletion of payment records by any authenticated user
revoke delete on public.student_fee_payments from authenticated;

create or replace function private.validate_student_fee_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce((select auth.uid()), new.recorded_by);
    new.status := 'valid';
    new.reversal_reason := null;
    new.reversed_at := null;
    new.reversed_by := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Financial transaction fields must be strictly immutable once recorded
    if new.school_id <> old.school_id or
       new.student_id <> old.student_id or
       new.semester_id <> old.semester_id or
       new.receipt_number <> old.receipt_number or
       new.amount <> old.amount or
       new.method <> old.method or
       new.paid_on <> old.paid_on or
       new.recorded_by <> old.recorded_by then
      raise exception 'Payment amount, receipt number, student, and date are immutable once recorded' using errcode = '42501';
    end if;

    -- Manage reversal workflow
    if old.status = 'valid' and new.status = 'reversed' then
      if coalesce(btrim(new.reversal_reason), '') = '' then
        raise exception 'A reason is required to reverse a fee payment' using errcode = '23514';
      end if;
      new.reversed_at := now();
      new.reversed_by := coalesce((select auth.uid()), new.reversed_by);
    elsif old.status = 'reversed' and new.status = 'valid' then
      raise exception 'A reversed fee payment cannot be un-reversed' using errcode = '42501';
    end if;

    new.updated_at := now();
    return new;
  end if;

  return new;
end $$;

drop trigger if exists validate_student_fee_payment on public.student_fee_payments;
create trigger validate_student_fee_payment
  before insert or update on public.student_fee_payments
  for each row execute function private.validate_student_fee_payment();

-- Fee charges attribution lock
create or replace function private.validate_student_fee_charge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    return new;
  end if;
  return new;
end $$;

drop trigger if exists validate_student_fee_charge on public.student_fee_charges;
create trigger validate_student_fee_charge
  before insert or update on public.student_fee_charges
  for each row execute function private.validate_student_fee_charge();

-- -----------------------------------------------------------------------------
-- 5. [F-05] Multi-Tenancy: Attach prevent_school_change to Migration 6 Tables
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'examinations','examination_classes','examination_subjects',
    'subject_result_submissions','school_grading_configs','terminal_reports',
    'fee_categories','fee_structures','student_fee_charges','student_fee_payments','student_promotions'
  ] loop
    execute format('drop trigger if exists prevent_school_change on public.%I', t);
    execute format('create trigger prevent_school_change before update of school_id on public.%I
                    for each row execute function private.prevent_school_change()', t);
  end loop;
end $$;
