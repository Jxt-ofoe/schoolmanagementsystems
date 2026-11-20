-- Migration: 20261120000018_whatsapp_report_shares_expiry.sql
-- Description: Add expiry timestamp to whatsapp_report_shares (Finding H-1)

alter table public.whatsapp_report_shares
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days');

-- Backfill existing rows to created_at + 30 days
update public.whatsapp_report_shares
set expires_at = created_at + interval '30 days';
