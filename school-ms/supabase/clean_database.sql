-- =============================================================================
-- SCHOOL MANAGEMENT SYSTEM - CLEAN SLATE DATABASE RESET SCRIPT
-- Truncates all operational school data while preserving core schema & Super Admin
-- =============================================================================

BEGIN;

-- 1. Truncate all child and operational tables with CASCADE
TRUNCATE TABLE
  public.student_fee_payments,
  public.student_fee_charges,
  public.scores,
  public.assessments,
  public.attendance_records,
  public.attendance_sessions,
  public.subject_result_submissions,
  public.terminal_reports,
  public.exam_timetables,
  public.examinations,
  public.student_promotions,
  public.student_enrollments,
  public.students,
  public.fee_structures,
  public.fee_categories,
  public.grading_scale_bands,
  public.grading_scales,
  public.teacher_assignments,
  public.classes,
  public.subjects,
  public.semesters,
  public.academic_years,
  public.communication_logs,
  public.communication_batches,
  public.communication_templates,
  public.communication_settings,
  public.payment_authorizations,
  public.billing_reminders,
  public.paystack_transactions,
  public.payments,
  public.semester_billing,
  public.school_billing_configs,
  public.school_settings,
  public.school_memberships,
  public.schools
CASCADE;

-- 2. Clear all audit logs
TRUNCATE TABLE public.audit_logs CASCADE;

-- 3. Delete non-admin profiles (keep platform admins)
DELETE FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.platform_admins);

-- 4. Reset platform settings to per-term defaults (GHS 3.00)
INSERT INTO public.platform_settings (
  id,
  price_per_student,
  currency,
  billing_due_days,
  void_grace_days,
  updated_at
)
VALUES (
  true,
  3.00,
  'GHS',
  7,
  14,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  price_per_student = EXCLUDED.price_per_student,
  currency = EXCLUDED.currency,
  billing_due_days = EXCLUDED.billing_due_days,
  void_grace_days = EXCLUDED.void_grace_days,
  updated_at = EXCLUDED.updated_at;

COMMIT;

