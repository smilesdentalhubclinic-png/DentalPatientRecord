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
