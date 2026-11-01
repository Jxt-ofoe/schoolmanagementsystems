-- =============================================================================
-- Migration 9: Communication Centre (Bulk SMS & Manual WhatsApp Sharing)
-- -----------------------------------------------------------------------------
-- Addresses:
--  1. Communication settings & SMS gateway credentials (school-isolated)
--  2. Message templates for examinations, report cards, fees, attendance, announcements
--  3. Communication batches for bulk dispatches
--  4. SMS delivery logs, costs, and provider response tracking
--  5. WhatsApp manual report card share tracking & audit history
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Communication Settings
-- -----------------------------------------------------------------------------
create table if not exists public.communication_settings (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  sms_provider        text not null default 'arkesel' check (sms_provider in ('arkesel', 'hubtel', 'custom')),
  sender_id           text not null default 'SchoolMS' check (char_length(btrim(sender_id)) between 1 and 11),
  api_key             text check (api_key is null or char_length(api_key) <= 300),
  api_secret          text check (api_secret is null or char_length(api_secret) <= 300),
  school_signature    text check (school_signature is null or char_length(school_signature) <= 120),
  sms_rate_per_unit   numeric(6,4) not null default 0.0500 check (sms_rate_per_unit >= 0),
  is_sms_enabled      boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (school_id)
);
create index if not exists comm_settings_school_idx on public.communication_settings (school_id);

-- -----------------------------------------------------------------------------
-- 2. Message Templates
-- -----------------------------------------------------------------------------
create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 100),
  category    text not null check (category in ('exam', 'report_card', 'fee', 'attendance', 'general')),
  content     text not null check (char_length(btrim(content)) between 1 and 1000),
  is_default  boolean not null default false,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists message_templates_school_cat_idx on public.message_templates (school_id, category);

-- -----------------------------------------------------------------------------
-- 3. Communication Batches
-- -----------------------------------------------------------------------------
create table if not exists public.communication_batches (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete cascade,
  channel           text not null check (channel in ('sms', 'whatsapp')),
  title             text not null check (char_length(btrim(title)) between 1 and 150),
  filter_type       text not null default 'all' check (filter_type in ('all', 'class', 'selected')),
  target_class_id   uuid references public.classes(id) on delete set null,
  total_recipients  integer not null default 0 check (total_recipients >= 0),
  successful_count  integer not null default 0 check (successful_count >= 0),
  failed_count      integer not null default 0 check (failed_count >= 0),
  estimated_cost    numeric(10,2) not null default 0.00 check (estimated_cost >= 0),
  status            text not null default 'completed' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (target_class_id, school_id) references public.classes(id, school_id) on delete set null
);
create index if not exists comm_batches_school_idx on public.communication_batches (school_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. SMS Delivery Logs
-- -----------------------------------------------------------------------------
create table if not exists public.sms_logs (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  batch_id            uuid references public.communication_batches(id) on delete set null,
  student_id          uuid references public.students(id) on delete set null,
  recipient_name      text not null check (char_length(btrim(recipient_name)) between 1 and 150),
  recipient_phone     text not null check (char_length(btrim(recipient_phone)) between 7 and 25),
  message             text not null check (char_length(message) <= 1500),
  units               integer not null default 1 check (units >= 1),
  estimated_cost      numeric(6,4) not null default 0.0500 check (estimated_cost >= 0),
  status              text not null default 'sent' check (status in ('pending', 'sent', 'delivered', 'failed')),
  provider            text not null default 'arkesel',
  provider_message_id text,
  error_message       text,
  sent_by             uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete set null
);
create index if not exists sms_logs_school_idx on public.sms_logs (school_id, created_at desc);
create index if not exists sms_logs_student_idx on public.sms_logs (student_id);

-- -----------------------------------------------------------------------------
-- 5. WhatsApp Manual Report Card Share Logs
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_report_shares (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  student_id          uuid not null,
  terminal_report_id  uuid references public.terminal_reports(id) on delete set null,
  semester_id         uuid not null,
  class_id            uuid not null,
  parent_name         text not null check (char_length(btrim(parent_name)) between 1 and 150),
  parent_phone        text not null check (char_length(btrim(parent_phone)) between 7 and 25),
  message             text check (message is null or char_length(message) <= 1500),
  status              text not null default 'pdf_generated' check (status in ('pdf_generated', 'whatsapp_opened', 'marked_as_sent')),
  notes               text check (notes is null or char_length(notes) <= 500),
  shared_by           uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students(id, school_id) on delete cascade,
  foreign key (semester_id, school_id) references public.semesters(id, school_id) on delete restrict,
  foreign key (class_id, school_id) references public.classes(id, school_id) on delete restrict,
  unique (student_id, semester_id, class_id)
);
create index if not exists whatsapp_shares_lookup_idx on public.whatsapp_report_shares (class_id, semester_id, status);

-- -----------------------------------------------------------------------------
-- 6. Row Level Security Policies
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'communication_settings','message_templates','communication_batches','sms_logs','whatsapp_report_shares'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;

-- Hard delete revoked on audit log tables
revoke delete on public.sms_logs from authenticated;
revoke delete on public.whatsapp_report_shares from authenticated;

-- Communication settings: Headmasters and Super Admins manage
create policy "comm_settings: headmaster or super admin read" on public.communication_settings
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));

create policy "comm_settings: headmaster write" on public.communication_settings
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- Message templates: Members can read, Headmaster can manage
create policy "templates: members read" on public.message_templates
  for select to authenticated using (private.is_member(school_id));

create policy "templates: headmaster write" on public.message_templates
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- Communication batches: Members can read, Headmaster can manage
create policy "comm_batches: members read" on public.communication_batches
  for select to authenticated using (private.is_member(school_id));

create policy "comm_batches: headmaster write" on public.communication_batches
  for all to authenticated using (private.is_headmaster(school_id)) with check (private.is_headmaster(school_id));

-- SMS logs: Headmasters and Super Admins read; Headmaster inserts
create policy "sms_logs: headmaster or super admin read" on public.sms_logs
  for select to authenticated using (private.is_headmaster(school_id) or (select private.is_super_admin()));

create policy "sms_logs: headmaster insert" on public.sms_logs
  for insert to authenticated with check (private.is_headmaster(school_id));

-- WhatsApp report shares: Headmasters and assigned class teachers read and manage
create policy "whatsapp_shares: headmaster or class teacher read" on public.whatsapp_report_shares
  for select to authenticated using (private.is_headmaster(school_id) or private.teaches_class(class_id));

create policy "whatsapp_shares: headmaster or class teacher insert" on public.whatsapp_report_shares
  for insert to authenticated with check (private.is_headmaster(school_id) or private.teaches_class(class_id));

create policy "whatsapp_shares: headmaster or class teacher update" on public.whatsapp_report_shares
  for update to authenticated using (
    private.is_headmaster(school_id) or private.teaches_class(class_id)
  ) with check (
    private.is_headmaster(school_id) or private.teaches_class(class_id)
  );

-- -----------------------------------------------------------------------------
-- 7. Triggers for updated_at and prevent_school_change
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['communication_settings','message_templates','whatsapp_report_shares'] loop
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'communication_settings','message_templates','communication_batches','sms_logs','whatsapp_report_shares'
  ] loop
    execute format('create trigger prevent_school_change before update of school_id on public.%I
                    for each row execute function private.prevent_school_change()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Seed Default Message Templates for Every School
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_communication_templates(p_school_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_headmaster(p_school_id) or (select private.is_super_admin())) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  insert into public.message_templates (school_id, title, category, content, is_default)
  values
    (p_school_id, 'Terminal Report Card Ready', 'report_card',
     'Dear {parent_name}, the examination report card for {student_name} ({class_name}) is ready for review. Please contact {school_name} for details. Thank you.', true),
    (p_school_id, 'Upcoming Examinations', 'exam',
     'Dear {parent_name}, please be informed that {exam_name} for {student_name} starts soon. Kindly ensure adequate revision at home. Regards, {school_name}.', true),
    (p_school_id, 'School Fee Reminder', 'fee',
     'Dear {parent_name}, this is a gentle reminder regarding school fees for {student_name}. Kindly settle outstanding balance at your earliest convenience. - {school_name}', true),
    (p_school_id, 'Attendance Notice', 'attendance',
     'Dear {parent_name}, please be notified that {student_name} was marked absent from {class_name} today. Please contact {school_name} if you have queries.', true),
    (p_school_id, 'General School Announcement', 'general',
     'Dear Parent/Guardian, please take note of important school announcements from {school_name}. Vacation begins on {date}. Best regards.', true)
  on conflict do nothing;

  -- Ensure settings exist with sensible defaults
  insert into public.communication_settings (school_id, sms_provider, sender_id, school_signature, is_sms_enabled)
  values (p_school_id, 'arkesel', 'SchoolMS', (select name from public.schools where id = p_school_id), false)
  on conflict (school_id) do nothing;
end $$;
grant execute on function public.seed_default_communication_templates(uuid) to authenticated, service_role;
