-- Hotfix migration for already-provisioned projects.
-- Run this once if your project was created before the latest schema updates.
--
-- Includes:
-- 1) Service amount overflow fix (unbounded numeric)
-- 2) Deterministic patient code format (PT-000001)
-- 3) Expanded patient profile + medical/dental data fields
-- 4) Civil status normalization/check + patient documents storage metadata
-- 5) Service pricing + service-record quantity/discount fields

create extension if not exists pgcrypto;

create sequence if not exists public.patient_code_seq
as bigint
increment by 1
minvalue 1
start with 1;

create or replace function public.next_patient_code()
returns text
language sql
volatile
as $$
  select 'PT-' || lpad(nextval('public.patient_code_seq')::text, 6, '0');
$$;

alter table public.patients
  add column if not exists nickname text,
  add column if not exists civil_status text,
  add column if not exists occupation text,
  add column if not exists office_address text,
  add column if not exists guardian_name text,
  add column if not exists guardian_mobile_number text,
  add column if not exists guardian_occupation text,
  add column if not exists guardian_office_address text,
  add column if not exists health_conditions jsonb not null default '{}'::jsonb,
  add column if not exists allergen_info jsonb not null default '{}'::jsonb,
  add column if not exists medical_history jsonb not null default '{}'::jsonb,
  add column if not exists dental_history jsonb not null default '{}'::jsonb,
  add column if not exists authorization_accepted boolean not null default false;

do $$
declare
  v_max_code bigint;
begin
  select coalesce(max((regexp_match(patient_code, '^PT-([0-9]{6})$'))[1]::bigint), 0)
  into v_max_code
  from public.patients;

  if v_max_code < 1 then
    perform setval('public.patient_code_seq', 1, false);
  else
    perform setval('public.patient_code_seq', v_max_code, true);
  end if;

  update public.patients
  set patient_code = public.next_patient_code()
  where patient_code is null
    or patient_code !~ '^PT-[0-9]{6}$';
end
$$;

alter table public.patients
  alter column patient_code set default public.next_patient_code();

alter table public.patients
  drop constraint if exists patients_patient_code_format_check;

alter table public.patients
  add constraint patients_patient_code_format_check
  check (patient_code ~ '^PT-[0-9]{6}$');

update public.patients
set civil_status = case lower(trim(coalesce(civil_status, '')))
  when 'single' then 'Single'
  when 'married' then 'Married'
  when 'widowed' then 'Widowed'
  when 'divorced' then 'Divorced'
  when 'separated' then 'Separated'
  else null
end
where civil_status is not null;

alter table public.patients
  drop constraint if exists patients_civil_status_check;

alter table public.patients
  add constraint patients_civil_status_check
  check (
    civil_status is null
    or civil_status in ('Single', 'Married', 'Widowed', 'Divorced', 'Separated')
  );

alter table public.service_records
  alter column amount type numeric using amount::numeric;

alter table public.services
  add column if not exists price numeric not null default 0;

alter table public.services
  drop constraint if exists services_price_non_negative;

alter table public.services
  add constraint services_price_non_negative
  check (price >= 0);

update public.services
set price = case service_name
  when 'Dental Check-Up & Consultation' then 50
  when 'Teeth Cleaning' then 100
  when 'Tooth Extraction' then 500
  when 'Dental Fillings' then 800
  when 'Root Canal Treatment' then 3500
  when 'Dental X-Ray Services' then 1000
  when 'Teeth Whitening' then 4500
  when 'Fluoride Application' then 700
  when 'Oral Prophylaxis' then 1200
  when 'Night Guard Fitting' then 5200
  else coalesce(price, 0)
end
where coalesce(price, 0) = 0;

alter table public.service_records
  add column if not exists quantity integer not null default 1;

alter table public.service_records
  add column if not exists unit_price numeric;

alter table public.service_records
  add column if not exists discount_amount numeric not null default 0;

update public.service_records
set quantity = 1
where quantity is null or quantity < 1;

update public.service_records
set unit_price = coalesce(unit_price, amount, 0)
where unit_price is null;

update public.service_records
set discount_amount = coalesce(discount_amount, 0)
where discount_amount is null;

alter table public.service_records
  drop constraint if exists service_records_amount_check;

alter table public.service_records
  drop constraint if exists service_records_amount_non_negative;

alter table public.service_records
  add constraint service_records_amount_non_negative
  check (amount is null or amount >= 0);

alter table public.service_records
  drop constraint if exists service_records_quantity_positive;

alter table public.service_records
  add constraint service_records_quantity_positive
  check (quantity >= 1);

alter table public.service_records
  drop constraint if exists service_records_unit_price_non_negative;

alter table public.service_records
  add constraint service_records_unit_price_non_negative
  check (unit_price is null or unit_price >= 0);

alter table public.service_records
  drop constraint if exists service_records_discount_non_negative;

alter table public.service_records
  add constraint service_records_discount_non_negative
  check (discount_amount >= 0);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  file_name text not null,
  file_url text,
  storage_path text,
  mime_type text,
  file_size bigint,
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_patient_documents_patient_id on public.patient_documents(patient_id, created_at desc);

drop trigger if exists trg_patient_documents_updated_at on public.patient_documents;
create trigger trg_patient_documents_updated_at
before update on public.patient_documents
for each row execute function public.set_updated_at();

alter table public.patient_documents enable row level security;

drop policy if exists patient_documents_select_staff on public.patient_documents;
create policy patient_documents_select_staff
on public.patient_documents
for select
to authenticated
using (public.is_active_staff());

drop policy if exists patient_documents_insert_staff on public.patient_documents;
create policy patient_documents_insert_staff
on public.patient_documents
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists patient_documents_update_staff on public.patient_documents;
create policy patient_documents_update_staff
on public.patient_documents
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

grant select, insert, update on public.patient_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('patient-documents', 'patient-documents', true, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists patient_documents_objects_select_staff on storage.objects;
create policy patient_documents_objects_select_staff
on storage.objects
for select
to authenticated
using (
  bucket_id = 'patient-documents'
  and public.is_active_staff()
);

drop policy if exists patient_documents_objects_insert_staff on storage.objects;
create policy patient_documents_objects_insert_staff
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'patient-documents'
  and public.is_active_staff()
);

drop policy if exists patient_documents_objects_delete_staff on storage.objects;
create policy patient_documents_objects_delete_staff
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'patient-documents'
  and public.is_active_staff()
);
