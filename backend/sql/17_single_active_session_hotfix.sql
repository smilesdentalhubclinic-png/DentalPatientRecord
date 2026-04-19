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
