-- =============================================================================
-- Migration 10: Terms & Conditions and Privacy Policy Tracking
-- -----------------------------------------------------------------------------
-- Tracks when headmasters and schools agreed to Terms & Conditions and Privacy Policy
-- =============================================================================

alter table public.schools
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists terms_version text default 'v1.0';

alter table public.school_memberships
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists terms_version text default 'v1.0';

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';
