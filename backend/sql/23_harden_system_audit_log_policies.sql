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
