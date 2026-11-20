-- =============================================================================
-- COMPLETE DATABASE CLEAN SLATE RESET SCRIPT
-- =============================================================================
-- Run this in your Supabase Dashboard -> SQL Editor (Runs in < 1 second).
-- It instantly truncates all application tables via CASCADE and removes
-- all test users while preserving your platform configuration.
-- =============================================================================

BEGIN;

-- 1. Instantly truncate all application tables (CASCADE handles foreign keys)
TRUNCATE TABLE
  public.audit_logs,
  public.billing_reminders,
  public.paystack_transactions,
  public.payments,
  public.semester_billing,
  public.school_billing_configs,
  public.student_fee_payments,
  public.student_fee_charges,
  public.fee_structures,
  public.fee_categories,
  public.terminal_reports,
  public.subject_result_submissions,
  public.scores,
  public.assessments,
  public.attendance_records,
  public.attendance_sessions,
  public.exam_timetables,
  public.examinations,
  public.student_promotions,
  public.student_enrollments,
  public.students,
  public.teacher_assignments,
  public.classes,
  public.subjects,
  public.grading_scale_bands,
  public.grading_scales,
  public.semesters,
  public.academic_years,
  public.communication_logs,
  public.communication_batches,
  public.communication_templates,
  public.communication_settings,
  public.payment_authorizations,
  public.school_settings,
  public.school_memberships,
  public.schools
RESTART IDENTITY CASCADE;

-- 2. Clean up non-admin profiles (preserves platform admins)
DELETE FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.platform_admins);

-- 3. Clean up non-admin auth users from Supabase Auth
DELETE FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.platform_admins);

-- 4. Reset default platform settings
INSERT INTO public.platform_settings (id, price_per_student, currency, billing_due_days, void_grace_days, updated_at)
VALUES (true, 10.00, 'GHS', 7, 14, now())
ON CONFLICT (id) DO UPDATE
SET price_per_student = 10.00,
    currency = 'GHS',
    billing_due_days = 7,
    void_grace_days = 14,
    updated_at = now();

COMMIT;

-- 5. Verification: Check that all data tables are at 0 rows
SELECT 'schools' AS table_name, count(*) AS row_count FROM public.schools
UNION ALL SELECT 'students', count(*) FROM public.students
UNION ALL SELECT 'classes', count(*) FROM public.classes
UNION ALL SELECT 'academic_years', count(*) FROM public.academic_years
UNION ALL SELECT 'semester_billing', count(*) FROM public.semester_billing
UNION ALL SELECT 'payments', count(*) FROM public.payments
UNION ALL SELECT 'platform_admins', count(*) FROM public.platform_admins
UNION ALL SELECT 'auth_users', count(*) FROM auth.users;

