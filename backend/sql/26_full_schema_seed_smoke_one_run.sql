-- Dent22 full one-run schema + dev seed + smoke test for fresh databases.
-- Run this once in Supabase SQL Editor on an empty/new project.
-- Includes schema, dev auth users, baseline app data, and smoke-check queries.
-- Dev/test only: this script creates known test users and sample records.

-- Dent22 full one-run schema for fresh databases.
-- Run this once in Supabase SQL Editor on an empty/new project.
-- This script combines the base schema with later auth, audit, and pending-request additions.

-- Dent22 Supabase backend
-- Scope:
-- 1) Staff accounts are restricted to admin, receptionist, and associate_dentist roles.
-- 2) Patient-facing account role is intentionally not supported.
-- 3) Role-based permissions are applied with RLS.
-- 4) Navigation permissions exclude /admin for receptionist and associate_dentist.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'staff_role'
      and n.nspname = 'public'
  ) then
    create type public.staff_role as enum ('admin', 'receptionist', 'associate_dentist');
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'staff_role'
      and n.nspname = 'public'
  )
  and not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'staff_role'
      and n.nspname = 'public'
      and e.enumlabel = 'admin'
  ) then
    raise exception
      'staff_role enum is missing "admin". Run backend/sql/00a_add_admin_role_enum.sql in a separate query, then rerun this script.';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'patient_log_action'
      and n.nspname = 'public'
  ) then
    create type public.patient_log_action as enum (
      'create_patient',
      'update_patient',
      'check_in',
      'check_out',
      'service_update',
      'dental_update',
      'archive',
      'retrieve'
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'archive_action'
      and n.nspname = 'public'
  ) then
    create type public.archive_action as enum ('archive', 'retrieve');
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  username citext,
  full_name text not null,
  role public.staff_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_profiles
  add column if not exists username citext;

with normalized as (
  select
    sp.user_id,
    lower(
      coalesce(
        nullif(regexp_replace(coalesce(sp.username::text, ''), '[^a-zA-Z0-9_.-]', '', 'g'), ''),
        nullif(regexp_replace(split_part(sp.email::text, '@', 1), '[^a-zA-Z0-9_.-]', '', 'g'), ''),
        'user_' || replace(sp.user_id::text, '-', '')
      )
    ) as base_username
  from public.staff_profiles sp
),
deduped as (
  select
    n.user_id,
    case
      when row_number() over (partition by n.base_username order by n.user_id) = 1 then n.base_username
      else n.base_username || '_' || (row_number() over (partition by n.base_username order by n.user_id) - 1)
    end as final_username
  from normalized n
)
update public.staff_profiles sp
set username = d.final_username::citext
from deduped d
where sp.user_id = d.user_id
  and (sp.username is null or sp.username <> d.final_username::citext);

alter table public.staff_profiles
  alter column username set not null;

create unique index if not exists idx_staff_profiles_username on public.staff_profiles(username);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_code text not null unique default public.next_patient_code(),
  first_name text not null,
  last_name text not null,
  middle_name text,
  suffix text,
  sex text not null check (sex in ('Male', 'Female', 'Other')),
  birth_date date,
  phone text,
  email citext,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  is_active boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.patient_logs (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.patients(id) on delete cascade,
  action public.patient_log_action not null,
  details text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  service_name text not null unique,
  price numeric not null default 0,
  description text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tooth_conditions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  condition_name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  service_id uuid not null references public.services(id),
  quantity integer not null default 1,
  unit_price numeric,
  discount_amount numeric not null default 0,
  performed_by uuid references auth.users(id),
  notes text,
  amount numeric(10, 2) check (amount is null or amount >= 0),
  visit_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.services
  add column if not exists price numeric not null default 0;

alter table public.services
  drop constraint if exists services_price_non_negative;

alter table public.services
  add constraint services_price_non_negative
  check (price >= 0);

alter table public.service_records
  add column if not exists quantity integer not null default 1;

alter table public.service_records
  add column if not exists unit_price numeric;

alter table public.service_records
  add column if not exists discount_amount numeric not null default 0;

alter table public.service_records
  alter column amount type numeric using amount::numeric;

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

create table if not exists public.dental_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  tooth_number text not null,
  condition_id uuid references public.tooth_conditions(id),
  findings text,
  treatment text,
  chart_data jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.archive_events (
  id bigint generated always as identity primary key,
  table_name text not null check (table_name in ('patients', 'service_records', 'dental_records')),
  record_id uuid not null,
  action public.archive_action not null,
  reason text,
  performed_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.navigation_items (
  item_key text primary key,
  label text not null,
  path text not null unique,
  sort_order integer not null
);

create table if not exists public.role_navigation_permissions (
  role public.staff_role not null,
  item_key text not null references public.navigation_items(item_key) on delete cascade,
  primary key (role, item_key)
);

drop trigger if exists trg_staff_profiles_updated_at on public.staff_profiles;
create trigger trg_staff_profiles_updated_at
before update on public.staff_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_patients_updated_at on public.patients;
create trigger trg_patients_updated_at
before update on public.patients
for each row execute function public.set_updated_at();

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
before update on public.services
for each row execute function public.set_updated_at();

drop trigger if exists trg_tooth_conditions_updated_at on public.tooth_conditions;
create trigger trg_tooth_conditions_updated_at
before update on public.tooth_conditions
for each row execute function public.set_updated_at();

drop trigger if exists trg_service_records_updated_at on public.service_records;
create trigger trg_service_records_updated_at
before update on public.service_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_dental_records_updated_at on public.dental_records;
create trigger trg_dental_records_updated_at
before update on public.dental_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_patient_documents_updated_at on public.patient_documents;
create trigger trg_patient_documents_updated_at
before update on public.patient_documents
for each row execute function public.set_updated_at();

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = auth.uid()
    and sp.is_active = true
  limit 1;
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.is_active = true
  );
$$;

create or replace function public.has_staff_role(required_role public.staff_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.is_active = true
      and sp.role = required_role
  );
$$;

create or replace function public.guard_service_record_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.staff_role;
  line_amount numeric;
begin
  actor_role := public.current_staff_role();

  if actor_role is null then
    raise exception 'Forbidden: active staff account required.';
  end if;

  line_amount := round(
    greatest(coalesce(new.quantity, 1), 1)::numeric
    * greatest(coalesce(new.unit_price, 0), 0::numeric),
    2
  );
  new.discount_amount := greatest(coalesce(new.discount_amount, 0), 0::numeric);

  if new.discount_amount > line_amount then
    raise exception 'Discount cannot be greater than amount.';
  end if;

  new.amount := greatest(0::numeric, round(line_amount - new.discount_amount, 2));

  if tg_op = 'INSERT' then
    if actor_role not in ('associate_dentist'::public.staff_role, 'admin'::public.staff_role) then
      raise exception 'Forbidden: receptionist cannot create service records.';
    end if;

    return new;
  end if;

  if actor_role = 'receptionist'::public.staff_role then
    if new.patient_id is distinct from old.patient_id
      or new.service_id is distinct from old.service_id
      or new.quantity is distinct from old.quantity
      or new.unit_price is distinct from old.unit_price
      or new.performed_by is distinct from old.performed_by
      or new.visit_at is distinct from old.visit_at
      or new.archived_at is distinct from old.archived_at
      or new.archived_by is distinct from old.archived_by
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Forbidden: receptionist can only update service discounts.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.save_dental_record_with_service(
  p_patient_id uuid,
  p_findings text,
  p_treatment text,
  p_chart_data jsonb,
  p_recorded_at timestamptz,
  p_visit_date date,
  p_service_lines jsonb,
  p_discount_type text default 'peso'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_role public.staff_role;
  dental_record_id uuid;
  existing_dental_record_id uuid;
  replace_existing_service boolean;
  visit_at_ts timestamptz;
  line_item jsonb;
  line_service_id uuid;
  line_quantity integer;
  line_unit_price numeric;
  line_discount numeric;
  line_total numeric;
  existing_row_id uuid;
  existing_quantity integer;
  existing_discount numeric;
  next_quantity integer;
  next_discount numeric;
  next_amount numeric;
begin
  actor_id := auth.uid();
  actor_role := public.current_staff_role();

  if actor_id is null or actor_role is null then
    raise exception 'Forbidden: active staff account required.';
  end if;

  if actor_role not in ('associate_dentist'::public.staff_role, 'admin'::public.staff_role) then
    raise exception 'Forbidden: only associate dentists and admins can save dental records with service records.';
  end if;

  if p_visit_date is null then
    raise exception 'Service date is required.';
  end if;

  if jsonb_typeof(coalesce(p_service_lines, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_service_lines, '[]'::jsonb)) = 0 then
    raise exception 'At least one service line is required.';
  end if;

  existing_dental_record_id := nullif(coalesce(p_chart_data ->> '_recordId', ''), '')::uuid;
  replace_existing_service := coalesce((p_chart_data ->> '_replaceExistingService')::boolean, false);
  visit_at_ts := ((p_visit_date::text || 'T12:00:00Z')::timestamptz);

  if existing_dental_record_id is not null then
    update public.dental_records
    set
      findings = p_findings,
      treatment = p_treatment,
      chart_data = (coalesce(p_chart_data, '{}'::jsonb) - '_recordId' - '_replaceExistingService'),
      recorded_at = coalesce(p_recorded_at, recorded_at),
      updated_by = actor_id
    where id = existing_dental_record_id
      and patient_id = p_patient_id
    returning id into dental_record_id;

    if dental_record_id is null then
      raise exception 'Existing dental record was not found for the patient.';
    end if;
  else
    insert into public.dental_records (
      patient_id,
      tooth_number,
      findings,
      treatment,
      chart_data,
      recorded_at,
      created_by,
      updated_by
    ) values (
      p_patient_id,
      'ALL',
      p_findings,
      p_treatment,
      (coalesce(p_chart_data, '{}'::jsonb) - '_recordId' - '_replaceExistingService'),
      coalesce(p_recorded_at, now()),
      actor_id,
      actor_id
    )
    returning id into dental_record_id;
  end if;

  if replace_existing_service then
    update public.service_records
    set
      archived_at = coalesce(archived_at, now()),
      archived_by = coalesce(archived_by, actor_id),
      updated_by = actor_id
    where patient_id = p_patient_id
      and archived_at is null
      and (visit_at at time zone 'UTC')::date = p_visit_date;
  end if;

  for line_item in
    select value
    from jsonb_array_elements(p_service_lines) as value
  loop
    line_service_id := nullif(line_item ->> 'serviceId', '')::uuid;
    line_quantity := greatest(coalesce((line_item ->> 'quantity')::integer, 1), 1);
    line_unit_price := round(greatest(coalesce((line_item ->> 'unitPrice')::numeric, 0), 0::numeric), 2);
    line_discount := round(greatest(coalesce((line_item ->> 'discountAmount')::numeric, 0), 0::numeric), 2);
    line_total := round(greatest(coalesce((line_item ->> 'totalAmount')::numeric, 0), 0::numeric), 2);

    if line_service_id is null then
      raise exception 'Service ID is required for every service line.';
    end if;

    if line_discount > round(line_quantity::numeric * line_unit_price, 2) then
      raise exception 'Discount cannot be greater than amount.';
    end if;

    if not replace_existing_service then
      select sr.id, greatest(coalesce(sr.quantity, 1), 1), greatest(coalesce(sr.discount_amount, 0), 0::numeric)
        into existing_row_id, existing_quantity, existing_discount
      from public.service_records sr
      where sr.patient_id = p_patient_id
        and sr.service_id = line_service_id
        and sr.archived_at is null
        and (sr.visit_at at time zone 'UTC')::date = p_visit_date
      order by coalesce(sr.created_at, sr.visit_at) asc, sr.id asc
      limit 1
      for update;
    else
      existing_row_id := null;
      existing_quantity := null;
      existing_discount := null;
    end if;

    if existing_row_id is not null and not replace_existing_service then
      next_quantity := existing_quantity + line_quantity;
      next_discount := round(existing_discount + line_discount, 2);
      next_amount := round((next_quantity::numeric * line_unit_price) - next_discount, 2);

      update public.service_records
      set
        quantity = next_quantity,
        unit_price = line_unit_price,
        discount_amount = greatest(0::numeric, next_discount),
        amount = greatest(0::numeric, next_amount),
        notes = jsonb_build_object('discountType', coalesce(nullif(trim(p_discount_type), ''), 'peso'))::text,
        visit_at = visit_at_ts,
        updated_by = actor_id
      where id = existing_row_id;
    else
      insert into public.service_records (
        patient_id,
        service_id,
        quantity,
        unit_price,
        discount_amount,
        amount,
        notes,
        visit_at,
        created_by,
        updated_by
      ) values (
        p_patient_id,
        line_service_id,
        line_quantity,
        line_unit_price,
        line_discount,
        greatest(0::numeric, line_total),
        jsonb_build_object('discountType', coalesce(nullif(trim(p_discount_type), ''), 'peso'))::text,
        visit_at_ts,
        actor_id,
        actor_id
      );
    end if;
  end loop;

  return dental_record_id;
end;
$$;

create or replace function public.allowed_navigation()
returns table (
  item_key text,
  label text,
  path text,
  sort_order integer
)
language sql
stable
security definer
set search_path = public
as $$
  select ni.item_key, ni.label, ni.path, ni.sort_order
  from public.navigation_items ni
  join public.role_navigation_permissions rnp
    on rnp.item_key = ni.item_key
  where rnp.role = public.current_staff_role()
  order by ni.sort_order;
$$;

drop trigger if exists trg_service_records_role_guard on public.service_records;
create trigger trg_service_records_role_guard
before insert or update on public.service_records
for each row execute function public.guard_service_record_write();

create or replace function public.resolve_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sp.email::text
  from public.staff_profiles sp
  where sp.is_active = true
    and sp.username = nullif(trim(p_username), '')::citext
  limit 1;
$$;

create or replace function public.list_patient_logs()
returns table (
  id bigint,
  patient_id uuid,
  patient_code text,
  patient_name text,
  logged_at timestamptz,
  actor_name text,
  action text,
  details text
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked_logs as (
    select
      pl.*,
      row_number() over (
        partition by pl.patient_id, ((pl.created_at at time zone 'Asia/Manila')::date)
        order by pl.created_at desc, pl.id desc
      ) as same_day_rank
    from public.patient_logs pl
    where pl.action = 'service_update'::public.patient_log_action
  )
  select
    pl.id,
    pl.patient_id,
    p.patient_code,
    concat_ws(', ', p.last_name, p.first_name) as patient_name,
    pl.created_at as logged_at,
    coalesce(
      dentist_sp.full_name,
      nullif(latest_dr.chart_data->>'dentist', ''),
      performer_sp.full_name,
      audit_sp.full_name,
      uploader_sp.full_name,
      'System'
    ) as actor_name,
    pl.action::text as action,
    pl.details
  from ranked_logs pl
  join public.patients p on p.id = pl.patient_id
  left join lateral (
    select
      sr.performed_by
    from public.service_records sr
    where sr.patient_id = pl.patient_id
      and sr.archived_at is null
      and ((sr.visit_at at time zone 'Asia/Manila')::date) = ((pl.created_at at time zone 'Asia/Manila')::date)
    order by sr.visit_at desc, sr.created_at desc
    limit 1
  ) latest_sr on true
  left join lateral (
    select
      dr.chart_data,
      dr.updated_by,
      dr.created_by
    from public.dental_records dr
    where dr.patient_id = pl.patient_id
      and dr.archived_at is null
      and ((dr.recorded_at at time zone 'Asia/Manila')::date) = ((pl.created_at at time zone 'Asia/Manila')::date)
    order by dr.recorded_at desc, dr.created_at desc
    limit 1
  ) latest_dr on true
  left join public.staff_profiles dentist_sp
    on dentist_sp.user_id = case
      when coalesce(latest_dr.chart_data->>'dentist_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (latest_dr.chart_data->>'dentist_user_id')::uuid
      else null
    end
  left join public.staff_profiles performer_sp
    on performer_sp.user_id = latest_sr.performed_by
  left join public.staff_profiles audit_sp
    on audit_sp.user_id = coalesce(latest_dr.updated_by, latest_dr.created_by)
  left join public.staff_profiles uploader_sp
    on uploader_sp.user_id = pl.created_by
  where public.is_active_staff()
    and pl.same_day_rank = 1
  order by pl.created_at desc;
$$;

create or replace function public.lookup_staff_names(p_user_ids uuid[])
returns table (
  user_id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.user_id,
    sp.full_name
  from public.staff_profiles sp
  where sp.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_username text,
  p_role public.staff_role
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_user_id uuid := gen_random_uuid();
  v_email citext;
  v_username citext;
begin
  if not public.has_staff_role('admin'::public.staff_role) then
    raise exception 'Forbidden: admin role required.';
  end if;

  v_email := nullif(trim(p_email), '')::citext;
  if v_email is null then
    raise exception 'Email is required.';
  end if;

  if nullif(trim(p_password), '') is null then
    raise exception 'Password is required.';
  end if;

  if length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  v_username := nullif(regexp_replace(lower(trim(coalesce(p_username, ''))), '[^a-zA-Z0-9_.-]', '', 'g'), '')::citext;
  if v_username is null then
    raise exception 'Username is required.';
  end if;

  if exists (select 1 from auth.users au where au.email = v_email::text) then
    raise exception 'Email already exists.';
  end if;

  if exists (select 1 from public.staff_profiles sp where sp.username = v_username) then
    raise exception 'Username already exists.';
  end if;

  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    v_instance_id,
    v_user_id,
    'authenticated',
    'authenticated',
    v_email::text,
    crypt(p_password, gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object(
      'role', p_role::text,
      'full_name', trim(coalesce(p_full_name, '')),
      'username', v_username::text
    ),
    now(),
    now()
  );

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    v_user_id,
    v_email::text,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email::text
    ),
    'email',
    now(),
    now(),
    now()
  );

  return v_user_id;
end;
$$;

create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_full_name text,
  p_username text,
  p_role public.staff_role,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username citext;
begin
  if not public.has_staff_role('admin'::public.staff_role) then
    raise exception 'Forbidden: admin role required.';
  end if;

  v_username := nullif(regexp_replace(lower(trim(coalesce(p_username, ''))), '[^a-zA-Z0-9_.-]', '', 'g'), '')::citext;
  if v_username is null then
    raise exception 'Username is required.';
  end if;

  if exists (
    select 1
    from public.staff_profiles sp
    where sp.username = v_username
      and sp.user_id <> p_user_id
  ) then
    raise exception 'Username already exists.';
  end if;

  update public.staff_profiles
  set
    full_name = trim(coalesce(p_full_name, full_name)),
    username = v_username,
    role = p_role,
    is_active = coalesce(p_is_active, is_active),
    updated_at = now()
  where user_id = p_user_id;

  if not found then
    raise exception 'User profile not found.';
  end if;
end;
$$;

create or replace function public.admin_reset_user_password(
  p_user_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.has_staff_role('admin'::public.staff_role) then
    raise exception 'Forbidden: admin role required.';
  end if;

  if nullif(trim(coalesce(p_new_password, '')), '') is null then
    raise exception 'Password is required.';
  end if;

  if length(p_new_password) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'Auth user not found.';
  end if;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  requested_role text;
  requested_name text;
  requested_username text;
begin
  requested_role := trim(coalesce(new.raw_user_meta_data ->> 'role', ''));
  requested_name := trim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = '' then
    requested_username := lower(trim(split_part(coalesce(new.email, ''), '@', 1)));
  end if;

  requested_username := nullif(regexp_replace(requested_username, '[^a-zA-Z0-9_.-]', '', 'g'), '');

  if requested_username is null then
    raise exception 'Signup blocked: missing username metadata.';
  end if;

  if requested_role = '' then
    raise exception 'Signup blocked: missing role metadata.';
  end if;

  if requested_role not in ('admin', 'receptionist', 'associate_dentist') then
    raise exception 'Signup blocked: role "%" is not allowed.', requested_role;
  end if;

  insert into public.staff_profiles (user_id, email, username, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    requested_username::citext,
    case
      when requested_name = '' then split_part(coalesce(new.email, ''), '@', 1)
      else requested_name
    end,
    requested_role::public.staff_role
  )
  on conflict (user_id) do update
    set email = excluded.email,
        username = excluded.username,
        full_name = excluded.full_name,
        role = excluded.role,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists trg_handle_new_auth_user on auth.users;
create trigger trg_handle_new_auth_user
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.navigation_items (item_key, label, path, sort_order)
values
  ('home', 'Home', '/home', 10),
  ('records', 'Patient Records', '/records', 20),
  ('add-patient', 'Add Patient', '/add-patient', 30),
  ('procedure', 'Procedure', '/procedure', 40),
  ('logs', 'Patient Logs', '/logs', 50),
  ('settings', 'Settings', '/settings', 80),
  ('admin', 'Admin', '/admin', 90)
on conflict (item_key) do update
set
  label = excluded.label,
  path = excluded.path,
  sort_order = excluded.sort_order;

delete from public.role_navigation_permissions
where role in ('receptionist'::public.staff_role, 'associate_dentist'::public.staff_role)
  and item_key = 'admin';

insert into public.role_navigation_permissions (role, item_key)
select v.role::public.staff_role, v.item_key
from (
  values
    ('receptionist', 'home'),
    ('receptionist', 'records'),
    ('receptionist', 'add-patient'),
    ('receptionist', 'procedure'),
    ('receptionist', 'logs'),
    ('receptionist', 'settings'),
    ('associate_dentist', 'home'),
    ('associate_dentist', 'records'),
    ('associate_dentist', 'add-patient'),
    ('associate_dentist', 'procedure'),
    ('associate_dentist', 'logs'),
    ('associate_dentist', 'settings'),
    ('admin', 'home'),
    ('admin', 'records'),
    ('admin', 'add-patient'),
    ('admin', 'procedure'),
    ('admin', 'logs'),
    ('admin', 'settings'),
    ('admin', 'admin')
) as v(role, item_key)
on conflict do nothing;

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

create index if not exists idx_patients_name on public.patients(last_name, first_name);
create unique index if not exists idx_patients_identity_active_unique
on public.patients (
  lower(regexp_replace(btrim(first_name), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(last_name), '\s+', ' ', 'g')),
  sex,
  birth_date
)
where archived_at is null
  and birth_date is not null;
create index if not exists idx_patients_is_active on public.patients(is_active);
create index if not exists idx_patient_logs_patient_id on public.patient_logs(patient_id, created_at desc);
create index if not exists idx_service_records_patient_id on public.service_records(patient_id, visit_at desc);
create index if not exists idx_dental_records_patient_id on public.dental_records(patient_id, recorded_at desc);
create index if not exists idx_patient_documents_patient_id on public.patient_documents(patient_id, created_at desc);
create index if not exists idx_archive_events_record on public.archive_events(table_name, record_id, created_at desc);

alter table public.staff_profiles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_logs enable row level security;
alter table public.services enable row level security;
alter table public.tooth_conditions enable row level security;
alter table public.service_records enable row level security;
alter table public.dental_records enable row level security;
alter table public.patient_documents enable row level security;
alter table public.archive_events enable row level security;
alter table public.navigation_items enable row level security;
alter table public.role_navigation_permissions enable row level security;

drop policy if exists staff_profiles_select_own on public.staff_profiles;
create policy staff_profiles_select_own
on public.staff_profiles
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists staff_profiles_select_admin_all on public.staff_profiles;
create policy staff_profiles_select_admin_all
on public.staff_profiles
for select
to authenticated
using (public.has_staff_role('admin'::public.staff_role));

drop policy if exists staff_profiles_update_admin_all on public.staff_profiles;
create policy staff_profiles_update_admin_all
on public.staff_profiles
for update
to authenticated
using (public.has_staff_role('admin'::public.staff_role))
with check (public.has_staff_role('admin'::public.staff_role));

drop policy if exists staff_profiles_update_own on public.staff_profiles;
create policy staff_profiles_update_own
on public.staff_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists patients_select_staff on public.patients;
create policy patients_select_staff
on public.patients
for select
to authenticated
using (public.is_active_staff());

drop policy if exists patients_insert_staff on public.patients;
create policy patients_insert_staff
on public.patients
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists patients_update_staff on public.patients;
create policy patients_update_staff
on public.patients
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists patient_logs_select_staff on public.patient_logs;
create policy patient_logs_select_staff
on public.patient_logs
for select
to authenticated
using (public.is_active_staff());

drop policy if exists patient_logs_insert_staff on public.patient_logs;
create policy patient_logs_insert_staff
on public.patient_logs
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists services_select_staff on public.services;
create policy services_select_staff
on public.services
for select
to authenticated
using (public.is_active_staff());

drop policy if exists services_insert_staff on public.services;
create policy services_insert_staff
on public.services
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists services_update_staff on public.services;
create policy services_update_staff
on public.services
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists tooth_conditions_select_staff on public.tooth_conditions;
create policy tooth_conditions_select_staff
on public.tooth_conditions
for select
to authenticated
using (public.is_active_staff());

drop policy if exists tooth_conditions_insert_staff on public.tooth_conditions;
create policy tooth_conditions_insert_staff
on public.tooth_conditions
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists tooth_conditions_update_staff on public.tooth_conditions;
create policy tooth_conditions_update_staff
on public.tooth_conditions
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists service_records_select_staff on public.service_records;
create policy service_records_select_staff
on public.service_records
for select
to authenticated
using (public.is_active_staff());

drop policy if exists service_records_insert_staff on public.service_records;
drop policy if exists service_records_insert_clinical_staff on public.service_records;
create policy service_records_insert_clinical_staff
on public.service_records
for insert
to authenticated
with check (
  public.has_staff_role('associate_dentist'::public.staff_role)
  or public.has_staff_role('admin'::public.staff_role)
);

drop policy if exists service_records_update_staff on public.service_records;
create policy service_records_update_staff
on public.service_records
for update
to authenticated
using (public.is_active_staff())
with check (public.is_active_staff());

drop policy if exists dental_records_select_staff on public.dental_records;
create policy dental_records_select_staff
on public.dental_records
for select
to authenticated
using (public.is_active_staff());

drop policy if exists dental_records_insert_associate on public.dental_records;
create policy dental_records_insert_associate
on public.dental_records
for insert
to authenticated
with check (
  public.has_staff_role('associate_dentist'::public.staff_role)
  or public.has_staff_role('admin'::public.staff_role)
);

drop policy if exists dental_records_update_associate on public.dental_records;
create policy dental_records_update_associate
on public.dental_records
for update
to authenticated
using (
  public.has_staff_role('associate_dentist'::public.staff_role)
  or public.has_staff_role('admin'::public.staff_role)
)
with check (
  public.has_staff_role('associate_dentist'::public.staff_role)
  or public.has_staff_role('admin'::public.staff_role)
);

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

drop policy if exists archive_events_select_staff on public.archive_events;
create policy archive_events_select_staff
on public.archive_events
for select
to authenticated
using (public.is_active_staff());

drop policy if exists archive_events_insert_staff on public.archive_events;
create policy archive_events_insert_staff
on public.archive_events
for insert
to authenticated
with check (public.is_active_staff());

drop policy if exists navigation_items_select_staff on public.navigation_items;
create policy navigation_items_select_staff
on public.navigation_items
for select
to authenticated
using (public.is_active_staff());

drop policy if exists role_navigation_permissions_select_own_role on public.role_navigation_permissions;
create policy role_navigation_permissions_select_own_role
on public.role_navigation_permissions
for select
to authenticated
using (role = public.current_staff_role());

grant usage on schema public to authenticated;
grant usage on schema public to anon;

grant select, update on public.staff_profiles to authenticated;
grant select, insert, update on public.patients to authenticated;
grant select, insert on public.patient_logs to authenticated;
grant select, insert, update on public.services to authenticated;
grant select, insert, update on public.tooth_conditions to authenticated;
grant select, insert, update on public.service_records to authenticated;
grant select, insert, update on public.dental_records to authenticated;
grant select, insert, update on public.patient_documents to authenticated;
grant select, insert on public.archive_events to authenticated;
grant select on public.navigation_items to authenticated;
grant select on public.role_navigation_permissions to authenticated;

grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.allowed_navigation() to authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_active_staff() to authenticated;
grant execute on function public.has_staff_role(public.staff_role) to authenticated;
grant execute on function public.save_dental_record_with_service(uuid, text, text, jsonb, timestamptz, date, jsonb, text) to authenticated;
grant execute on function public.lookup_staff_names(uuid[]) to authenticated;
grant execute on function public.resolve_login_email(text) to anon;
grant execute on function public.resolve_login_email(text) to authenticated;
grant execute on function public.list_patient_logs() to authenticated;
grant execute on function public.admin_create_user(text, text, text, text, public.staff_role) to authenticated;
grant execute on function public.admin_update_user_profile(uuid, text, text, public.staff_role, boolean) to authenticated;
grant execute on function public.admin_reset_user_password(uuid, text) to authenticated;


-- Included from 15_verification_codes_hotfix.sql
create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.verification_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null
    check (purpose in ('email_change', 'staff_onboarding', 'password_reset')),
  user_id uuid references auth.users(id) on delete cascade,
  email citext not null,
  code_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_codes_attempts_non_negative check (attempts >= 0)
);

create index if not exists idx_verification_codes_lookup
  on public.verification_codes (purpose, user_id, email, created_at desc);

create index if not exists idx_verification_codes_expires_at
  on public.verification_codes (expires_at);

drop trigger if exists trg_verification_codes_updated_at on public.verification_codes;
create trigger trg_verification_codes_updated_at
before update on public.verification_codes
for each row execute function public.set_updated_at();

alter table public.verification_codes enable row level security;

drop policy if exists verification_codes_no_direct_access on public.verification_codes;
create policy verification_codes_no_direct_access
on public.verification_codes
for all
to authenticated
using (false)
with check (false);

grant usage on schema public to authenticated;
grant usage on schema public to anon;

delete from public.verification_codes
where expires_at < now();


-- Included from 17_single_active_session_hotfix.sql
-- Hotfix:
-- Enforce one active authenticated session per staff account by storing
-- the currently allowed Supabase session_id on the staff profile.
--
-- Safe to re-run.

alter table public.staff_profiles
  add column if not exists active_session_id uuid,
  add column if not exists active_session_updated_at timestamptz;

create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = auth.uid()
    and sp.is_active = true
    and sp.active_session_id is not null
    and sp.active_session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  limit 1;
$$;

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.is_active = true
      and sp.active_session_id is not null
      and sp.active_session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  );
$$;

create or replace function public.has_staff_role(required_role public.staff_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.user_id = auth.uid()
      and sp.is_active = true
      and sp.role = required_role
      and sp.active_session_id is not null
      and sp.active_session_id::text = coalesce(auth.jwt() ->> 'session_id', '')
  );
$$;


-- Included from 20_patient_registration_verification_codes_hotfix.sql
-- Allow patient registration email verification codes in verification_codes.

alter table public.verification_codes
  drop constraint if exists verification_codes_purpose_check;

alter table public.verification_codes
  add constraint verification_codes_purpose_check
  check (
    purpose in (
      'email_change',
      'staff_onboarding',
      'password_reset',
      'patient_registration'
    )
  );


-- Included from 21_system_audit_logs.sql
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


-- Included from 23_harden_system_audit_log_policies.sql
-- Tighten access to public.system_audit_logs.
-- Run this after 22_backfill_system_audit_logs.sql.

alter table public.system_audit_logs enable row level security;

revoke update, delete on public.system_audit_logs from authenticated;

drop policy if exists system_audit_logs_select_staff on public.system_audit_logs;
create policy system_audit_logs_select_admin_only
on public.system_audit_logs
for select
to authenticated
using (public.has_staff_role('admin'::public.staff_role));

drop policy if exists system_audit_logs_insert_staff on public.system_audit_logs;
create policy system_audit_logs_insert_active_staff
on public.system_audit_logs
for insert
to authenticated
with check (
  public.is_active_staff()
  and (
    actor_user_id is null
    or actor_user_id = auth.uid()
  )
);

grant select, insert on public.system_audit_logs to authenticated;


-- Included from 24_pending_patient_registration_requests.sql
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

-- Included from 27_patient_queue_entries.sql
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



-- Included from 01_dev_seed_staff_accounts.sql
-- DEV ONLY: creates or normalizes three test auth users.
-- Do not use these credentials in production.
--
-- Generated users:
-- 1) admin@dent22.local        / Admin123!
-- 2) receptionist@dent22.local / Reception123!
-- 3) associate@dent22.local    / Dentist123!
--
-- Important:
-- - Run 00_schema_and_policies.sql first.
-- - Running this script reapplies known dev credentials and active profiles.

create extension if not exists pgcrypto;

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_admin_id uuid;
  v_receptionist_id uuid;
  v_associate_id uuid;
begin
  perform set_config('search_path', 'public, auth, extensions', true);

  select id into v_admin_id
  from auth.users
  where email = 'admin@dent22.local';

  if v_admin_id is null then
    v_admin_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      v_instance_id,
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin@dent22.local',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}',
      '{"role":"admin","full_name":"Admin User","username":"admin"}',
      now(),
      now()
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_admin_id,
      'admin@dent22.local',
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', 'admin@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  update auth.users
  set
    email = 'admin@dent22.local',
    encrypted_password = crypt('Admin123!', gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_app_meta_data = '{"provider":"email","providers":["email"]}',
    raw_user_meta_data = '{"role":"admin","full_name":"Admin User","username":"admin"}',
    updated_at = now()
  where id = v_admin_id;

  if not exists (
    select 1
    from auth.identities ai
    where ai.user_id = v_admin_id
      and ai.provider = 'email'
  ) then
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_admin_id,
      'admin@dent22.local',
      jsonb_build_object(
        'sub', v_admin_id::text,
        'email', 'admin@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  else
    update auth.identities
    set
      provider_id = 'admin@dent22.local',
      identity_data = jsonb_build_object(
        'sub', v_admin_id::text,
        'email', 'admin@dent22.local'
      ),
      updated_at = now()
    where user_id = v_admin_id
      and provider = 'email';
  end if;

  insert into public.staff_profiles (user_id, email, username, full_name, role, is_active)
  values (
    v_admin_id,
    'admin@dent22.local',
    'admin',
    'Admin User',
    'admin',
    true
  )
  on conflict (user_id) do update
    set email = excluded.email,
        username = excluded.username,
        full_name = excluded.full_name,
        role = excluded.role,
        is_active = true,
        updated_at = now();

  select id into v_receptionist_id
  from auth.users
  where email = 'receptionist@dent22.local';

  if v_receptionist_id is null then
    v_receptionist_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      v_instance_id,
      v_receptionist_id,
      'authenticated',
      'authenticated',
      'receptionist@dent22.local',
      crypt('Reception123!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}',
      '{"role":"receptionist","full_name":"Receptionist User","username":"receptionist"}',
      now(),
      now()
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_receptionist_id,
      'receptionist@dent22.local',
      jsonb_build_object(
        'sub', v_receptionist_id::text,
        'email', 'receptionist@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  update auth.users
  set
    email = 'receptionist@dent22.local',
    encrypted_password = crypt('Reception123!', gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_app_meta_data = '{"provider":"email","providers":["email"]}',
    raw_user_meta_data = '{"role":"receptionist","full_name":"Receptionist User","username":"receptionist"}',
    updated_at = now()
  where id = v_receptionist_id;

  if not exists (
    select 1
    from auth.identities ai
    where ai.user_id = v_receptionist_id
      and ai.provider = 'email'
  ) then
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_receptionist_id,
      'receptionist@dent22.local',
      jsonb_build_object(
        'sub', v_receptionist_id::text,
        'email', 'receptionist@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  else
    update auth.identities
    set
      provider_id = 'receptionist@dent22.local',
      identity_data = jsonb_build_object(
        'sub', v_receptionist_id::text,
        'email', 'receptionist@dent22.local'
      ),
      updated_at = now()
    where user_id = v_receptionist_id
      and provider = 'email';
  end if;

  insert into public.staff_profiles (user_id, email, username, full_name, role, is_active)
  values (
    v_receptionist_id,
    'receptionist@dent22.local',
    'receptionist',
    'Receptionist User',
    'receptionist',
    true
  )
  on conflict (user_id) do update
    set email = excluded.email,
        username = excluded.username,
        full_name = excluded.full_name,
        role = excluded.role,
        is_active = true,
        updated_at = now();

  select id into v_associate_id
  from auth.users
  where email = 'associate@dent22.local';

  if v_associate_id is null then
    v_associate_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      v_instance_id,
      v_associate_id,
      'authenticated',
      'authenticated',
      'associate@dent22.local',
      crypt('Dentist123!', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}',
      '{"role":"associate_dentist","full_name":"Associate Dentist User","username":"associate"}',
      now(),
      now()
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_associate_id,
      'associate@dent22.local',
      jsonb_build_object(
        'sub', v_associate_id::text,
        'email', 'associate@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  update auth.users
  set
    email = 'associate@dent22.local',
    encrypted_password = crypt('Dentist123!', gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_app_meta_data = '{"provider":"email","providers":["email"]}',
    raw_user_meta_data = '{"role":"associate_dentist","full_name":"Associate Dentist User","username":"associate"}',
    updated_at = now()
  where id = v_associate_id;

  if not exists (
    select 1
    from auth.identities ai
    where ai.user_id = v_associate_id
      and ai.provider = 'email'
  ) then
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_associate_id,
      'associate@dent22.local',
      jsonb_build_object(
        'sub', v_associate_id::text,
        'email', 'associate@dent22.local'
      ),
      'email',
      now(),
      now(),
      now()
    );
  else
    update auth.identities
    set
      provider_id = 'associate@dent22.local',
      identity_data = jsonb_build_object(
        'sub', v_associate_id::text,
        'email', 'associate@dent22.local'
      ),
      updated_at = now()
    where user_id = v_associate_id
      and provider = 'email';
  end if;

  insert into public.staff_profiles (user_id, email, username, full_name, role, is_active)
  values (
    v_associate_id,
    'associate@dent22.local',
    'associate',
    'Associate Dentist User',
    'associate_dentist',
    true
  )
  on conflict (user_id) do update
    set email = excluded.email,
        username = excluded.username,
        full_name = excluded.full_name,
        role = excluded.role,
        is_active = true,
        updated_at = now();
end
$$;


-- Included from 03_seed_app_data.sql
-- Seed baseline app data from prior frontend mock content.
-- Safe to re-run: uses upserts and idempotent inserts.
--
-- Run after:
-- 1) 00a_add_admin_role_enum.sql (if needed)
-- 2) 00_schema_and_policies.sql
-- 3) 01_dev_seed_staff_accounts.sql (recommended so admin actor exists)

do $$
declare
  v_actor uuid;
  v_health_default jsonb := jsonb_build_object(
    'Low Blood Pressure', false,
    'Severe Headaches', false,
    'High Blood Pressure', false,
    'Weight Loss', false,
    'Heart Disease', false,
    'Stroke', false,
    'Asthma', false,
    'Tuberculosis', false,
    'Diabetes', false,
    'Radiation Therapy', false,
    'Respiratory Problems', false,
    'Anemia/Blood Disease', false,
    'Hay Fever/Allergies', false,
    'Arthritis/Rheumatism', false,
    'Epilepsy/Convulsions', false,
    'Bleeding Problems', false,
    'Fainting/Seizures', false,
    'Heart Murmur', false,
    'Rheumatic Fever', false,
    'Kidney Disease', false,
    'Stomach Trouble/Ulcers', false,
    'Heart Surgery/Heart Attack', false,
    'Angina pectoris, chest pain', false,
    'Sexually Transmitted Disease', false,
    'Joint Replacement/Implant', false,
    'Hepatitis/Liver Disease', false,
    'Thyroid Problems', false,
    'Cancer/Tumors', false,
    'Head Injuries', false,
    'AIDS or HIV Infection', false
  );
  v_allergen_default jsonb := jsonb_build_object(
    'values', jsonb_build_object(
      'Local Anesthetic (ex. Lidocaine)', false,
      'Penicillin/Antibiotics', false,
      'Sulfa Drugs', false,
      'Latex/Rubber', false,
      'Aspirin', false
    ),
    'others', ''
  );
  v_medical_default jsonb := jsonb_build_object(
    'physician', 'Dr. Keith San Miguel',
    'specialty', 'General Practice',
    'address', 'Caloocan City',
    'answers', jsonb_build_object(
      '0', 'YES', '1', 'NO', '2', 'NO', '3', 'NO', '4', 'NO',
      '5', 'NO', '6', 'NO', '7', 'NO', '8', 'NO', '9', 'NO'
    ),
    'notes', jsonb_build_object()
  );
  v_dental_default jsonb := jsonb_build_object(
    'previous', 'Dr. Adrian San Nicolas',
    'lastExam', '2025-12-15',
    'reason', 'Routine check-up',
    'answers', jsonb_build_object(
      '0', 'NO', '1', 'NO', '2', 'NO', '3', 'NO', '4', 'NO',
      '5', 'NO', '6', 'NO', '7', 'NO', '8', 'NO', '9', 'NO',
      '10', 'NO', '11', 'NO', '12', 'NO', '13', 'NO', '14', 'YES',
      '15', 'NO', '16', 'NO', '17', 'YES'
    ),
    'notes', jsonb_build_object(
      '14', 'Patient wants cosmetic alignment check.'
    )
  );
begin
  select au.id into v_actor
  from auth.users au
  where au.email = 'admin@dent22.local'
  limit 1;

  if v_actor is null then
    select au.id into v_actor
    from auth.users au
    order by au.created_at asc
    limit 1;
  end if;

  if v_actor is null then
    raise exception 'No auth user found. Create at least one auth account before running seed.';
  end if;

  insert into public.services (service_name, price, description, is_active, created_by, updated_by)
  values
    ('Dental Check-Up & Consultation', 50::numeric, 'General consultation and oral exam', true, v_actor, v_actor),
    ('Teeth Cleaning', 100::numeric, 'Routine prophylaxis and scaling', true, v_actor, v_actor),
    ('Tooth Extraction', 500::numeric, 'Simple extraction service', true, v_actor, v_actor),
    ('Dental Fillings', 800::numeric, 'Restorative filling treatment', true, v_actor, v_actor),
    ('Root Canal Treatment', 3500::numeric, 'Endodontic treatment', true, v_actor, v_actor),
    ('Dental X-Ray Services', 1000::numeric, 'Diagnostic dental imaging', true, v_actor, v_actor),
    ('Teeth Whitening', 4500::numeric, 'Aesthetic whitening service', true, v_actor, v_actor),
    ('Fluoride Application', 700::numeric, 'Preventive fluoride treatment', true, v_actor, v_actor),
    ('Oral Prophylaxis', 1200::numeric, 'Professional oral cleaning', true, v_actor, v_actor),
    ('Night Guard Fitting', 5200::numeric, 'Custom guard for bruxism', true, v_actor, v_actor)
  on conflict (service_name) do update
  set
    price = excluded.price,
    description = excluded.description,
    is_active = true,
    updated_by = v_actor,
    updated_at = now();

  insert into public.tooth_conditions (code, condition_name, description, is_active, created_by, updated_by)
  values
    ('C', 'Caries', 'Tooth decay', true, v_actor, v_actor),
    ('ABR', 'Abrasion', 'Tooth surface wear', true, v_actor, v_actor),
    ('F', 'For Exo', 'For extraction', true, v_actor, v_actor),
    ('Ex', 'Braces', 'Orthodontic braces marker', true, v_actor, v_actor),
    ('X', 'Missing', 'Missing tooth', true, v_actor, v_actor),
    ('I', 'Impacted', 'Impacted tooth', true, v_actor, v_actor),
    ('RF', 'Restoration Failure', 'Failed restoration marker', true, v_actor, v_actor),
    ('?', 'Good Condition', 'Tooth in good condition', true, v_actor, v_actor)
  on conflict (code) do update
  set
    condition_name = excluded.condition_name,
    description = excluded.description,
    is_active = true,
    updated_by = v_actor,
    updated_at = now();

  insert into public.patients (
    patient_code,
    first_name,
    last_name,
    middle_name,
    suffix,
    sex,
    birth_date,
    phone,
    email,
    address,
    nickname,
    civil_status,
    occupation,
    office_address,
    emergency_contact_name,
    emergency_contact_phone,
    guardian_name,
    guardian_mobile_number,
    guardian_occupation,
    guardian_office_address,
    health_conditions,
    allergen_info,
    medical_history,
    dental_history,
    authorization_accepted,
    is_active,
    archived_at,
    archived_by,
    created_by,
    updated_by,
    created_at,
    updated_at
  )
  values
    (
      'PT-000001', 'John', 'Doe', 'M', null, 'Male', '2003-12-01',
      '09213232131', 'john.doe@example.com', 'Blk 27 Lot 23, Forbes Subdivision Caloocan City',
      'Johnny', 'Single', 'Government employee', 'Oracle, Pasay City',
      'Rosa Doe', '09170000001', null, null, null, null,
      v_health_default || jsonb_build_object('Severe Headaches', true),
      v_allergen_default || jsonb_build_object('values', (v_allergen_default -> 'values') || jsonb_build_object('Penicillin/Antibiotics', true)),
      v_medical_default || jsonb_build_object('notes', jsonb_build_object('4', 'Sleeping pills as needed')),
      v_dental_default || jsonb_build_object('reason', 'Toothache on lower right molar'),
      true,
      false,
      '2026-02-04 10:00:00+08'::timestamptz,
      v_actor,
      v_actor,
      v_actor,
      '2025-12-01 09:00:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000002', 'Paul', 'Evans', 'T', null, 'Female', '2001-12-09',
      '09213232132', 'paul.evans@example.com', 'Bagumbong, Caloocan City',
      'Pau', 'Single', 'Call Center Agent', 'MOA Complex, Pasay City',
      'Lina Evans', '09170000002', null, null, null, null,
      v_health_default || jsonb_build_object('Asthma', true),
      v_allergen_default,
      v_medical_default || jsonb_build_object('specialty', 'Pulmonology'),
      v_dental_default,
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-01-06 09:15:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000003', 'Mark', 'John', null, null, 'Male', '1993-02-23',
      '09213232133', 'mark.john@example.com', 'Monumento, Caloocan City',
      'MJ', 'Married', 'Driver', 'Valenzuela Terminal',
      'Ella John', '09170000003', null, null, null, null,
      v_health_default || jsonb_build_object('High Blood Pressure', true),
      v_allergen_default || jsonb_build_object('values', (v_allergen_default -> 'values') || jsonb_build_object('Aspirin', true)),
      v_medical_default || jsonb_build_object('answers', (v_medical_default -> 'answers') || jsonb_build_object('1', 'YES')),
      v_dental_default || jsonb_build_object('reason', 'Broken filling'),
      true,
      false,
      '2026-02-07 12:00:00+08'::timestamptz,
      v_actor,
      v_actor,
      v_actor,
      '2025-11-20 14:25:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000004', 'Steph', 'Curry', null, null, 'Female', '2000-06-27',
      '09213232134', 'steph.curry@example.com', 'Novaliches, Quezon City',
      'Steph', 'Single', 'Athlete', 'Training Center, QC',
      'Martha Curry', '09170000004', null, null, null, null,
      v_health_default,
      v_allergen_default,
      v_medical_default,
      v_dental_default || jsonb_build_object('reason', 'Teeth whitening consult'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-16 08:30:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000005', 'John', 'Mike', null, null, 'Female', '2004-08-17',
      '09213232135', 'john.mike@example.com', 'Malabon City',
      'JM', 'Single', 'Student', 'University of the East',
      'Anne Mike', '09170000005', null, null, null, null,
      v_health_default || jsonb_build_object('Hay Fever/Allergies', true),
      v_allergen_default || jsonb_build_object('others', 'Seafood'),
      v_medical_default,
      v_dental_default,
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-17 10:30:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000006', 'Andrea', 'Santos', 'P', null, 'Female', '1998-11-11',
      '09213232136', 'andrea.santos@example.com', 'North Caloocan',
      'Andi', 'Married', 'Teacher', 'Bagong Silang Elementary School',
      'Leo Santos', '09170000006', null, null, null, null,
      v_health_default || jsonb_build_object('Stomach Trouble/Ulcers', true),
      v_allergen_default,
      v_medical_default || jsonb_build_object('notes', jsonb_build_object('3', 'Hospitalized in 2022 for gastritis')),
      v_dental_default || jsonb_build_object('reason', 'Follow-up cleaning'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-18 11:45:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000007', 'Kevin', 'Tan', null, null, 'Male', '1989-07-04',
      '09213232137', 'kevin.tan@example.com', 'Makati City',
      'Kev', 'Married', 'Engineer', 'Ayala Avenue, Makati',
      'April Tan', '09170000007', null, null, null, null,
      v_health_default || jsonb_build_object('Diabetes', true),
      v_allergen_default,
      v_medical_default || jsonb_build_object('specialty', 'Endocrinology'),
      v_dental_default || jsonb_build_object('reason', 'Gum bleeding'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-19 09:05:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000008', 'Mia', 'Reyes', null, null, 'Female', '2012-03-30',
      '09213232138', 'mia.reyes@example.com', 'Fairview, QC',
      'Mimi', 'Single', 'Student', 'Fairview Heights School',
      'Grace Reyes', '09170000008', 'Grace Reyes', '09170000008', 'Nurse', 'Fairview Medical Center',
      v_health_default,
      v_allergen_default,
      v_medical_default || jsonb_build_object('physician', 'Dr. Liza Cruz', 'specialty', 'Pediatrics'),
      v_dental_default || jsonb_build_object('reason', 'Orthodontic assessment'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-20 08:10:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000009', 'Ralph', 'Dizon', null, null, 'Male', '1995-05-14',
      '09213232139', 'ralph.dizon@example.com', 'San Jose del Monte, Bulacan',
      'Ralfy', 'Single', 'IT Support', 'BGC, Taguig',
      'Cora Dizon', '09170000009', null, null, null, null,
      v_health_default || jsonb_build_object('Respiratory Problems', true),
      v_allergen_default || jsonb_build_object('values', (v_allergen_default -> 'values') || jsonb_build_object('Latex/Rubber', true)),
      v_medical_default,
      v_dental_default || jsonb_build_object('reason', 'Post-extraction check'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-21 13:05:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000010', 'Irene', 'Lopez', null, null, 'Female', '1987-10-25',
      '09213232140', 'irene.lopez@example.com', 'Marikina City',
      'Iri', 'Married', 'Accountant', 'Ortigas Center, Pasig',
      'Miguel Lopez', '09170000010', null, null, null, null,
      v_health_default || jsonb_build_object('Arthritis/Rheumatism', true),
      v_allergen_default,
      v_medical_default,
      v_dental_default || jsonb_build_object('reason', 'Sensitivity to cold drinks'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-22 09:20:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000011', 'Noel', 'Garcia', null, null, 'Male', '1979-01-18',
      '09213232141', 'noel.garcia@example.com', 'Mandaluyong City',
      'Noe', 'Married', 'Business Owner', 'Shaw Boulevard, Mandaluyong',
      'Liza Garcia', '09170000011', null, null, null, null,
      v_health_default || jsonb_build_object('Heart Disease', true, 'High Blood Pressure', true),
      v_allergen_default,
      v_medical_default || jsonb_build_object('answers', (v_medical_default -> 'answers') || jsonb_build_object('0', 'NO', '1', 'YES')),
      v_dental_default || jsonb_build_object('reason', 'Bridge replacement consult'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-02-10 15:00:00+08'::timestamptz,
      now()
    ),
    (
      'PT-000012', 'Lara', 'Mendoza', null, null, 'Female', '1992-09-03',
      '09213232142', 'lara.mendoza@example.com', 'Taguig City',
      'Lars', 'Single', 'Freelancer', 'Bonifacio Global City',
      'Jose Mendoza', '09170000012', null, null, null, null,
      v_health_default,
      v_allergen_default || jsonb_build_object('values', (v_allergen_default -> 'values') || jsonb_build_object('Sulfa Drugs', true)),
      v_medical_default || jsonb_build_object('notes', jsonb_build_object('4', 'Daily antihistamine')),
      v_dental_default || jsonb_build_object('reason', 'Regular six-month recall'),
      true,
      true,
      null,
      null,
      v_actor,
      v_actor,
      '2026-01-30 16:20:00+08'::timestamptz,
      now()
    )
  on conflict (patient_code) do update
  set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    middle_name = excluded.middle_name,
    suffix = excluded.suffix,
    sex = excluded.sex,
    birth_date = excluded.birth_date,
    phone = excluded.phone,
    email = excluded.email,
    address = excluded.address,
    nickname = excluded.nickname,
    civil_status = excluded.civil_status,
    occupation = excluded.occupation,
    office_address = excluded.office_address,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    guardian_name = excluded.guardian_name,
    guardian_mobile_number = excluded.guardian_mobile_number,
    guardian_occupation = excluded.guardian_occupation,
    guardian_office_address = excluded.guardian_office_address,
    health_conditions = excluded.health_conditions,
    allergen_info = excluded.allergen_info,
    medical_history = excluded.medical_history,
    dental_history = excluded.dental_history,
    authorization_accepted = excluded.authorization_accepted,
    is_active = excluded.is_active,
    archived_at = excluded.archived_at,
    archived_by = excluded.archived_by,
    updated_by = v_actor,
    updated_at = now();

  with seed_service_records (patient_code, service_name, quantity, unit_price, discount_amount, amount, notes, visit_at) as (
    values
      ('PT-000001', 'Dental Check-Up & Consultation', 1, 800::numeric, 0::numeric, 800::numeric, 'Initial consult', '2026-01-14 09:00:00+08'::timestamptz),
      ('PT-000001', 'Dental Fillings', 1, 2200::numeric, 0::numeric, 2200::numeric, 'Composite filling on #46', '2026-02-02 11:00:00+08'::timestamptz),
      ('PT-000002', 'Teeth Cleaning', 1, 1200::numeric, 0::numeric, 1200::numeric, 'Routine prophylaxis', '2026-01-18 10:00:00+08'::timestamptz),
      ('PT-000002', 'Dental X-Ray Services', 1, 950::numeric, 0::numeric, 950::numeric, 'Bitewing', '2026-02-19 14:00:00+08'::timestamptz),
      ('PT-000003', 'Tooth Extraction', 1, 3500::numeric, 0::numeric, 3500::numeric, 'Extraction of impacted molar', '2026-02-03 13:00:00+08'::timestamptz),
      ('PT-000004', 'Teeth Whitening', 1, 4800::numeric, 0::numeric, 4800::numeric, 'In-office whitening', '2026-02-16 09:00:00+08'::timestamptz),
      ('PT-000005', 'Oral Prophylaxis', 1, 1400::numeric, 0::numeric, 1400::numeric, 'Scaling and polishing', '2026-02-17 09:30:00+08'::timestamptz),
      ('PT-000006', 'Teeth Cleaning', 1, 1200::numeric, 0::numeric, 1200::numeric, 'Preventive cleaning', '2026-02-18 11:00:00+08'::timestamptz),
      ('PT-000006', 'Fluoride Application', 1, 700::numeric, 0::numeric, 700::numeric, 'Topical fluoride', '2026-02-18 11:00:00+08'::timestamptz),
      ('PT-000007', 'Root Canal Treatment', 1, 8500::numeric, 0::numeric, 8500::numeric, 'RCT session 1', '2026-02-19 10:00:00+08'::timestamptz),
      ('PT-000007', 'Root Canal Treatment', 1, 8300::numeric, 0::numeric, 8300::numeric, 'RCT session 2', '2026-02-21 10:00:00+08'::timestamptz),
      ('PT-000008', 'Dental Check-Up & Consultation', 1, 800::numeric, 0::numeric, 800::numeric, 'Ortho consult', '2026-02-20 08:30:00+08'::timestamptz),
      ('PT-000009', 'Tooth Extraction', 1, 2900::numeric, 0::numeric, 2900::numeric, 'Extraction follow-up', '2026-02-21 15:00:00+08'::timestamptz),
      ('PT-000010', 'Dental Fillings', 1, 2600::numeric, 0::numeric, 2600::numeric, 'Class II restoration', '2026-02-22 10:15:00+08'::timestamptz),
      ('PT-000011', 'Dental X-Ray Services', 1, 1200::numeric, 0::numeric, 1200::numeric, 'Panoramic x-ray', '2026-02-10 15:30:00+08'::timestamptz),
      ('PT-000011', 'Night Guard Fitting', 1, 5200::numeric, 0::numeric, 5200::numeric, 'Night guard impression', '2026-02-12 16:00:00+08'::timestamptz),
      ('PT-000012', 'Teeth Cleaning', 1, 1250::numeric, 0::numeric, 1250::numeric, '6-month recall cleaning', '2026-01-30 16:45:00+08'::timestamptz)
  )
  insert into public.service_records (
    patient_id,
    service_id,
    quantity,
    unit_price,
    discount_amount,
    performed_by,
    notes,
    amount,
    visit_at,
    created_by,
    updated_by
  )
  select
    p.id,
    s.id,
    ssr.quantity,
    ssr.unit_price,
    ssr.discount_amount,
    v_actor,
    ssr.notes,
    ssr.amount,
    ssr.visit_at,
    v_actor,
    v_actor
  from seed_service_records ssr
  join public.patients p on p.patient_code = ssr.patient_code
  join public.services s on s.service_name = ssr.service_name
  where not exists (
    select 1
    from public.service_records sr
    where sr.patient_id = p.id
      and sr.service_id = s.id
      and sr.visit_at = ssr.visit_at
  );

  with seed_dental_records (patient_code, findings, treatment, recorded_at, chart_data) as (
    values
      (
        'PT-000001',
        'Caries noted on lower molar',
        'Restoration and hygiene advice',
        '2026-02-02 11:10:00+08'::timestamptz,
        jsonb_build_object(
          'toothMap', jsonb_build_object('top-14', 'C', 'bottom-30', 'C'),
          'periodontal', jsonb_build_object('Gingivitis', true, 'Moderate Periodontitis', false, 'Early Periodontitis', false, 'Advanced Periodontitis', false),
          'occlusion', jsonb_build_object('Class I molar', true, 'Overbite', false, 'Overjet', false, 'Midline Deviation', false),
          'prescriptions', 'Ibuprofen 400mg as needed',
          'notes', 'Observe oral hygiene and review in 2 weeks.',
          'dentist', 'Dr. Adrian San Nicolas'
        )
      ),
      (
        'PT-000004',
        'No active caries, cosmetic concern only',
        'Whitening protocol started',
        '2026-02-16 09:20:00+08'::timestamptz,
        jsonb_build_object(
          'toothMap', jsonb_build_object(),
          'periodontal', jsonb_build_object('Gingivitis', false, 'Moderate Periodontitis', false, 'Early Periodontitis', false, 'Advanced Periodontitis', false),
          'occlusion', jsonb_build_object('Class I molar', true, 'Overbite', false, 'Overjet', false, 'Midline Deviation', false),
          'prescriptions', 'Avoid pigmented food for 48 hours.',
          'notes', 'Patient tolerated whitening procedure.',
          'dentist', 'Dr. Jowela Elaine Roxas'
        )
      ),
      (
        'PT-000007',
        'Pulpal involvement on #36',
        'Root canal treatment in progress',
        '2026-02-19 10:30:00+08'::timestamptz,
        jsonb_build_object(
          'toothMap', jsonb_build_object('bottom-20', 'C'),
          'periodontal', jsonb_build_object('Gingivitis', true, 'Moderate Periodontitis', true, 'Early Periodontitis', false, 'Advanced Periodontitis', false),
          'occlusion', jsonb_build_object('Class I molar', true, 'Overbite', false, 'Overjet', false, 'Midline Deviation', false),
          'prescriptions', 'Amoxicillin 500mg every 8 hours for 7 days',
          'notes', 'Return for obturation next visit.',
          'dentist', 'Dr. Keith San Miguel'
        )
      ),
      (
        'PT-000010',
        'Small carious lesion restored',
        'Composite filling completed',
        '2026-02-22 10:40:00+08'::timestamptz,
        jsonb_build_object(
          'toothMap', jsonb_build_object('top-5', 'F'),
          'periodontal', jsonb_build_object('Gingivitis', false, 'Moderate Periodontitis', false, 'Early Periodontitis', false, 'Advanced Periodontitis', false),
          'occlusion', jsonb_build_object('Class I molar', true, 'Overbite', false, 'Overjet', false, 'Midline Deviation', false),
          'prescriptions', 'Mild analgesic if needed',
          'notes', 'Final polish done.',
          'dentist', 'Dr. Adrian San Nicolas'
        )
      )
  )
  insert into public.dental_records (
    patient_id,
    tooth_number,
    findings,
    treatment,
    chart_data,
    recorded_at,
    created_by,
    updated_by
  )
  select
    p.id,
    'ALL',
    sdr.findings,
    sdr.treatment,
    sdr.chart_data,
    sdr.recorded_at,
    v_actor,
    v_actor
  from seed_dental_records sdr
  join public.patients p on p.patient_code = sdr.patient_code
  where not exists (
    select 1
    from public.dental_records dr
    where dr.patient_id = p.id
      and dr.recorded_at = sdr.recorded_at
  );

  insert into public.patient_logs (patient_id, action, details, created_by, created_at)
  select
    p.id,
    'create_patient'::public.patient_log_action,
    'Initial seeded patient record',
    v_actor,
    p.created_at
  from public.patients p
  where not exists (
    select 1
    from public.patient_logs pl
    where pl.patient_id = p.id
      and pl.action = 'create_patient'::public.patient_log_action
      and pl.details = 'Initial seeded patient record'
  );

  insert into public.patient_logs (patient_id, action, details, created_by, created_at)
  select
    sr.patient_id,
    'service_update'::public.patient_log_action,
    'Seeded service records',
    v_actor,
    min(sr.visit_at)
  from public.service_records sr
  where not exists (
    select 1
    from public.patient_logs pl
    where pl.patient_id = sr.patient_id
      and pl.action = 'service_update'::public.patient_log_action
      and pl.details = 'Seeded service records'
  )
  group by sr.patient_id;

  insert into public.patient_logs (patient_id, action, details, created_by, created_at)
  select
    dr.patient_id,
    'dental_update'::public.patient_log_action,
    'Seeded dental records',
    v_actor,
    min(dr.recorded_at)
  from public.dental_records dr
  where not exists (
    select 1
    from public.patient_logs pl
    where pl.patient_id = dr.patient_id
      and pl.action = 'dental_update'::public.patient_log_action
      and pl.details = 'Seeded dental records'
  )
  group by dr.patient_id;

  insert into public.patient_logs (patient_id, action, details, created_by, created_at)
  select
    p.id,
    'archive'::public.patient_log_action,
    'Seeded inactive status',
    v_actor,
    coalesce(p.archived_at, now())
  from public.patients p
  where p.is_active = false
    and not exists (
      select 1
      from public.patient_logs pl
      where pl.patient_id = p.id
        and pl.action = 'archive'::public.patient_log_action
        and pl.details = 'Seeded inactive status'
    );
end
$$;


-- Combined smoke test adapted from 02_smoke_test_flow.sql
-- Combined smoke checks adapted for single-active-session enforcement.
-- This section is read-only except for assigning deterministic dev session ids.

do $$
declare
  v_admin_id uuid;
  v_receptionist_id uuid;
  v_associate_id uuid;
  v_admin_session uuid := '11111111-1111-1111-1111-111111111111';
  v_receptionist_session uuid := '22222222-2222-2222-2222-222222222222';
  v_associate_session uuid := '33333333-3333-3333-3333-333333333333';
begin
  select id into v_admin_id from auth.users where email = 'admin@dent22.local' limit 1;
  select id into v_receptionist_id from auth.users where email = 'receptionist@dent22.local' limit 1;
  select id into v_associate_id from auth.users where email = 'associate@dent22.local' limit 1;

  if v_admin_id is not null then
    update public.staff_profiles
    set active_session_id = v_admin_session,
        active_session_updated_at = now(),
        updated_at = now()
    where user_id = v_admin_id;
  end if;

  if v_receptionist_id is not null then
    update public.staff_profiles
    set active_session_id = v_receptionist_session,
        active_session_updated_at = now(),
        updated_at = now()
    where user_id = v_receptionist_id;
  end if;

  if v_associate_id is not null then
    update public.staff_profiles
    set active_session_id = v_associate_session,
        active_session_updated_at = now(),
        updated_at = now()
    where user_id = v_associate_id;
  end if;
end
$$;

-- 1) Ensure roles exist in enum
select e.enumlabel as role_name
from pg_enum e
join pg_type t on t.oid = e.enumtypid
join pg_namespace n on n.oid = t.typnamespace
where t.typname = 'staff_role'
  and n.nspname = 'public'
order by e.enumsortorder;

-- 2) Ensure admin has /admin and other staff do not
select role::text as role_name, item_key
from public.role_navigation_permissions
where item_key = 'admin'
order by role::text;

-- 3) Ensure seeded users are in staff_profiles with expected roles and usernames
select sp.username::text as username, sp.email::text as email, sp.role::text as role_name, sp.is_active, sp.active_session_id
from public.staff_profiles sp
where sp.email in ('admin@dent22.local', 'receptionist@dent22.local', 'associate@dent22.local')
order by sp.email;

-- 3b) Ensure username resolver works
select public.resolve_login_email('admin') as admin_login_email;
select public.resolve_login_email('receptionist') as receptionist_login_email;
select public.resolve_login_email('associate') as associate_login_email;

-- 4) Simulate receptionist auth context and read allowed_navigation()
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'receptionist@dent22.local'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'receptionist@dent22.local'), 'session_id', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated', 'email', 'receptionist@dent22.local')::text, true);
select * from public.allowed_navigation();

-- 5) Simulate associate dentist auth context and read allowed_navigation()
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'associate@dent22.local'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'associate@dent22.local'), 'session_id', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated', 'email', 'associate@dent22.local')::text, true);
select * from public.allowed_navigation();

-- 6) Simulate admin auth context and read allowed_navigation()
select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'admin@dent22.local'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'admin@dent22.local'), 'session_id', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated', 'email', 'admin@dent22.local')::text, true);
select * from public.allowed_navigation();

-- 7) Clear simulated auth context
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
