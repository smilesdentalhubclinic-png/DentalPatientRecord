-- Queue patient submissions without email for admin review.
-- Email-backed submissions should continue through OTP verification.

create table if not exists public.pending_patient_registrations (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  middle_name text,
  suffix text,
  sex text not null check (sex in ('Male', 'Female', 'Other')),
  birth_date date not null,
  email citext,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  request_source text not null default 'add_patient_form',
  requested_by uuid not null default auth.uid() references auth.users(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_notes text,
  resolved_patient_id uuid references public.patients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pending_patient_registrations_updated_at on public.pending_patient_registrations;
create trigger trg_pending_patient_registrations_updated_at
before update on public.pending_patient_registrations
for each row execute function public.set_updated_at();

create index if not exists idx_pending_patient_registrations_status_created_at
  on public.pending_patient_registrations (status, created_at desc);

create index if not exists idx_pending_patient_registrations_requested_by
  on public.pending_patient_registrations (requested_by, created_at desc);

create unique index if not exists idx_pending_patient_registrations_pending_identity_unique
  on public.pending_patient_registrations (
    lower(first_name),
    lower(last_name),
    sex,
    birth_date
  )
  where status = 'pending';

alter table public.pending_patient_registrations enable row level security;

drop policy if exists pending_patient_registrations_select_own_or_admin on public.pending_patient_registrations;
create policy pending_patient_registrations_select_own_or_admin
on public.pending_patient_registrations
for select
to authenticated
using (
  requested_by = auth.uid()
  or public.has_staff_role('admin'::public.staff_role)
);

drop policy if exists pending_patient_registrations_insert_staff on public.pending_patient_registrations;
create policy pending_patient_registrations_insert_staff
on public.pending_patient_registrations
for insert
to authenticated
with check (
  public.is_active_staff()
  and requested_by = auth.uid()
  and status = 'pending'
  and decided_by is null
  and decided_at is null
);

drop policy if exists pending_patient_registrations_update_admin on public.pending_patient_registrations;
create policy pending_patient_registrations_update_admin
on public.pending_patient_registrations
for update
to authenticated
using (public.has_staff_role('admin'::public.staff_role))
with check (public.has_staff_role('admin'::public.staff_role));

grant select, insert, update on public.pending_patient_registrations to authenticated;
