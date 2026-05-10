-- Clinic-wide settings stored in DB so all devices/users stay in sync.
-- Single-row table (id = 1 always). Only admin can write, all staff can read.

create table if not exists public.clinic_settings (
  id            int primary key default 1,
  queue_enabled boolean not null default true,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id)
);

-- Enforce singleton row
create unique index if not exists clinic_settings_singleton
  on public.clinic_settings (id);

-- Seed the default row if it doesn't exist yet
insert into public.clinic_settings (id, queue_enabled)
values (1, true)
on conflict (id) do nothing;

alter table public.clinic_settings enable row level security;

drop policy if exists clinic_settings_select on public.clinic_settings;
create policy clinic_settings_select
  on public.clinic_settings
  for select
  to authenticated
  using (public.is_active_staff());

drop policy if exists clinic_settings_update on public.clinic_settings;
create policy clinic_settings_update
  on public.clinic_settings
  for update
  to authenticated
  using (public.has_staff_role('admin'))
  with check (public.has_staff_role('admin'));

grant select on public.clinic_settings to authenticated;
grant update on public.clinic_settings to authenticated;

-- Add to realtime so all clients get pushed updates immediately
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'clinic_settings'
  ) then
    alter publication supabase_realtime add table public.clinic_settings;
  end if;
end
$$;
