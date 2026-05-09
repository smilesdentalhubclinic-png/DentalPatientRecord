-- Queue active patients for consultation workflow.
-- Receptionists can add patients to the queue and view it.
-- Associate dentists and admins can accept queued patients.

create table if not exists public.patient_queue_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  queue_status text not null default 'pending' check (queue_status in ('pending', 'accepted', 'cancelled')),
  queued_by uuid not null default auth.uid() references auth.users(id),
  queued_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_patient_queue_entries_updated_at on public.patient_queue_entries;
create trigger trg_patient_queue_entries_updated_at
before update on public.patient_queue_entries
for each row execute function public.set_updated_at();

create or replace function public.guard_patient_queue_fifo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.queue_status = 'pending'
    and new.queue_status = 'accepted' then
    if exists (
      select 1
      from public.patient_queue_entries pq
      where pq.queue_status = 'pending'
        and pq.id <> old.id
        and (
          pq.queued_at < old.queued_at
          or (pq.queued_at = old.queued_at and pq.id::text < old.id::text)
        )
    ) then
      raise exception 'Only the first queued patient can be accepted.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_patient_queue_entries_fifo_guard on public.patient_queue_entries;
create trigger trg_patient_queue_entries_fifo_guard
before update on public.patient_queue_entries
for each row execute function public.guard_patient_queue_fifo();

create index if not exists idx_patient_queue_entries_status_queued_at
  on public.patient_queue_entries (queue_status, queued_at asc);

create index if not exists idx_patient_queue_entries_patient_id
  on public.patient_queue_entries (patient_id, queued_at desc);

create unique index if not exists idx_patient_queue_entries_single_pending_patient
  on public.patient_queue_entries (patient_id)
  where queue_status = 'pending';

alter table public.patient_queue_entries enable row level security;

drop policy if exists patient_queue_entries_select_staff on public.patient_queue_entries;
create policy patient_queue_entries_select_staff
on public.patient_queue_entries
for select
to authenticated
using (public.is_active_staff());

drop policy if exists patient_queue_entries_insert_staff on public.patient_queue_entries;
create policy patient_queue_entries_insert_staff
on public.patient_queue_entries
for insert
to authenticated
with check (
  public.is_active_staff()
  and queued_by = auth.uid()
  and queue_status = 'pending'
  and accepted_by is null
  and accepted_at is null
);

drop policy if exists patient_queue_entries_update_staff on public.patient_queue_entries;
create policy patient_queue_entries_update_staff
on public.patient_queue_entries
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

grant select, insert, update on public.patient_queue_entries to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'patient_queue_entries'
  ) then
    alter publication supabase_realtime add table public.patient_queue_entries;
  end if;
end
$$;
