-- Central system audit trail for staff-authenticated actions.

create table if not exists public.system_audit_logs (
  id bigint generated always as identity primary key,
  action text not null,
  source text not null default 'ui',
  entity_type text not null,
  entity_id text,
  entity_label text,
  details text,
  metadata jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id),
  actor_identifier text,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_audit_logs_created_at
  on public.system_audit_logs(created_at desc);

create index if not exists idx_system_audit_logs_entity
  on public.system_audit_logs(entity_type, entity_id, created_at desc);

create or replace function public.apply_system_audit_actor_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.actor_user_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_system_audit_logs_actor_defaults on public.system_audit_logs;
create trigger trg_system_audit_logs_actor_defaults
before insert on public.system_audit_logs
for each row execute function public.apply_system_audit_actor_defaults();

alter table public.system_audit_logs enable row level security;

drop policy if exists system_audit_logs_select_staff on public.system_audit_logs;
create policy system_audit_logs_select_staff
on public.system_audit_logs
for select
to authenticated
using (true);

drop policy if exists system_audit_logs_insert_staff on public.system_audit_logs;
create policy system_audit_logs_insert_staff
on public.system_audit_logs
for insert
to authenticated
with check (true);

grant select, insert on public.system_audit_logs to authenticated;
