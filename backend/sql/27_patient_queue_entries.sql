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

create or replace function public.patient_queue_entry_day(p_timestamp timestamptz)
returns date
language sql
immutable
set search_path = public
as $$
  select (p_timestamp at time zone 'Asia/Manila')::date
$$;

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
        and public.patient_queue_entry_day(pq.queued_at) = public.patient_queue_entry_day(old.queued_at)
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

create or replace function public.audit_patient_queue_entry_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.patient_queue_entries%rowtype;
  patient_label text;
  audit_action text;
  audit_details text;
  audit_metadata jsonb;
begin
  target_row := case when tg_op = 'DELETE' then old else new end;

  select trim(concat_ws(', ', nullif(p.last_name, ''), nullif(p.first_name, '')))
  into patient_label
  from public.patients p
  where p.id = target_row.patient_id;

  if tg_op = 'INSERT' then
    audit_action := 'patient_added_to_queue';
    audit_details := 'Added patient to queue.';
  elsif tg_op = 'UPDATE' and old.queue_status is distinct from new.queue_status then
    if new.queue_status = 'accepted' then
      audit_action := 'patient_queue_accepted';
      audit_details := 'Accepted patient from queue.';
    elsif new.queue_status = 'cancelled' then
      audit_action := 'patient_queue_cancelled';
      audit_details := 'Cancelled patient from queue.';
    else
      audit_action := 'patient_queue_status_updated';
      audit_details := format('Updated patient queue status to %s.', new.queue_status);
    end if;
  end if;

  if audit_action is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  audit_metadata := jsonb_build_object(
    'patientId', target_row.patient_id,
    'queueStatus', target_row.queue_status,
    'queueDate', public.patient_queue_entry_day(target_row.queued_at),
    'queuedAt', target_row.queued_at
  );

  if target_row.accepted_by is not null then
    audit_metadata := audit_metadata || jsonb_build_object('acceptedBy', target_row.accepted_by);
  end if;

  if target_row.accepted_at is not null then
    audit_metadata := audit_metadata || jsonb_build_object('acceptedAt', target_row.accepted_at);
  end if;

  insert into public.system_audit_logs (
    action,
    source,
    entity_type,
    entity_id,
    entity_label,
    details,
    metadata
  )
  values (
    audit_action,
    'database',
    'patient_queue_entry',
    target_row.id::text,
    nullif(patient_label, ''),
    audit_details,
    audit_metadata
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_patient_queue_entries_audit on public.patient_queue_entries;
create trigger trg_patient_queue_entries_audit
after insert or update on public.patient_queue_entries
for each row execute function public.audit_patient_queue_entry_changes();

create index if not exists idx_patient_queue_entries_status_queued_at
  on public.patient_queue_entries (queue_status, queued_at asc);

create index if not exists idx_patient_queue_entries_patient_id
  on public.patient_queue_entries (patient_id, queued_at desc);

drop index if exists idx_patient_queue_entries_single_pending_patient;

create unique index if not exists idx_patient_queue_entries_single_pending_patient_day
  on public.patient_queue_entries (patient_id, public.patient_queue_entry_day(queued_at))
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
