-- Migration: 20261120000017_lockdown_school_logos_bucket.sql
-- Description: Lock down school-logos storage bucket (Finding H-2)
-- 1. Disallow SVG in allowed_mime_types
-- 2. Restrict INSERT/UPDATE/DELETE policies to headmasters of the school or super admins

-- Remove SVG from allowed mime types on school-logos bucket
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'school-logos';

-- Drop existing upload/update/delete policies
drop policy if exists "Authorized users can upload school logos" on storage.objects;
drop policy if exists "Authorized users can update school logos" on storage.objects;
drop policy if exists "Authorized users can delete school logos" on storage.objects;
drop policy if exists "headmaster or super admin upload own school logo" on storage.objects;
drop policy if exists "headmaster or super admin update own school logo" on storage.objects;
drop policy if exists "headmaster or super admin delete own school logo" on storage.objects;

-- Recreate policies scoped strictly to headmaster of the school or super admin
create policy "headmaster or super admin upload own school logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'school-logos'
    and ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$')
    and (
      private.is_headmaster(((storage.foldername(name))[1])::uuid)
      or (select private.is_super_admin())
    )
  );

create policy "headmaster or super admin update own school logo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'school-logos'
    and ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$')
    and (
      private.is_headmaster(((storage.foldername(name))[1])::uuid)
      or (select private.is_super_admin())
    )
  )
  with check (
    bucket_id = 'school-logos'
    and ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$')
    and (
      private.is_headmaster(((storage.foldername(name))[1])::uuid)
      or (select private.is_super_admin())
    )
  );

create policy "headmaster or super admin delete own school logo" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'school-logos'
    and ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$')
    and (
      private.is_headmaster(((storage.foldername(name))[1])::uuid)
      or (select private.is_super_admin())
    )
  );
