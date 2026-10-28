-- =============================================================================
-- Migration 7: School Logos & Custom Branding
-- -----------------------------------------------------------------------------
-- 1. Adds logo_url column to public.schools
-- 2. Ensures public storage bucket school-logos exists
-- 3. Sets up storage policies for school logos
-- =============================================================================

-- 1. Add logo_url column to schools
alter table public.schools add column if not exists logo_url text check (logo_url is null or char_length(logo_url) <= 1000);

-- 2. Create school-logos storage bucket if it doesn't already exist
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'school-logos',
  'school-logos',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif'];

-- 3. Storage access policies for school-logos
-- Anyone can view school logos (public bucket)
create policy "Public Access to School Logos"
on storage.objects for select
to public
using ( bucket_id = 'school-logos' );

-- Authenticated headmasters and platform admins can upload/manage logos
create policy "Authorized users can upload school logos"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'school-logos' );

create policy "Authorized users can update school logos"
on storage.objects for update
to authenticated
using ( bucket_id = 'school-logos' );

create policy "Authorized users can delete school logos"
on storage.objects for delete
to authenticated
using ( bucket_id = 'school-logos' );
