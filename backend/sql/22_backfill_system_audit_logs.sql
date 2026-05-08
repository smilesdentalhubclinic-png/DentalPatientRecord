-- One-time backfill of legacy audit sources into public.system_audit_logs.
-- Run this after 21_system_audit_logs.sql.

insert into public.system_audit_logs (
  action,
  source,
  entity_type,
  entity_id,
  entity_label,
  details,
  metadata,
  actor_user_id,
  actor_identifier,
  created_at
)
select
  pl.action::text as action,
  'patient_log' as source,
  'patient_record' as entity_type,
  pl.patient_id::text as entity_id,
  trim(
    both ' '
    from concat(
      coalesce(p.last_name, ''),
      case when p.last_name is not null and p.first_name is not null then ', ' else '' end,
      coalesce(p.first_name, '')
    )
  ) || case
    when p.id is not null then ' (' || coalesce(p.patient_code, p.id::text) || ')'
    else ''
  end as entity_label,
  pl.details,
  jsonb_build_object(
    'legacy_source', 'patient_logs',
    'legacy_id', pl.id
  ) as metadata,
  pl.created_by as actor_user_id,
  null::text as actor_identifier,
  pl.created_at
from public.patient_logs pl
left join public.patients p
  on p.id = pl.patient_id
where not exists (
  select 1
  from public.system_audit_logs sal
  where sal.source = 'patient_log'
    and sal.entity_type = 'patient_record'
    and sal.entity_id = pl.patient_id::text
    and sal.action = pl.action::text
    and sal.created_at = pl.created_at
    and coalesce(sal.details, '') = coalesce(pl.details, '')
);

insert into public.system_audit_logs (
  action,
  source,
  entity_type,
  entity_id,
  entity_label,
  details,
  metadata,
  actor_user_id,
  actor_identifier,
  created_at
)
select
  ae.action::text as action,
  'archive_event' as source,
  ae.table_name as entity_type,
  ae.record_id::text as entity_id,
  case
    when ae.table_name = 'patients' and p.id is not null then
      trim(
        both ' '
        from concat(
          coalesce(p.last_name, ''),
          case when p.last_name is not null and p.first_name is not null then ', ' else '' end,
          coalesce(p.first_name, '')
        )
      ) || ' (' || coalesce(p.patient_code, p.id::text) || ')'
    else initcap(replace(ae.table_name, '_', ' '))
  end as entity_label,
  ae.reason as details,
  jsonb_build_object(
    'legacy_source', 'archive_events',
    'legacy_id', ae.id
  ) as metadata,
  ae.performed_by as actor_user_id,
  null::text as actor_identifier,
  ae.created_at
from public.archive_events ae
left join public.patients p
  on p.id = ae.record_id
  and ae.table_name = 'patients'
where not exists (
  select 1
  from public.system_audit_logs sal
  where sal.source = 'archive_event'
    and sal.entity_type = ae.table_name
    and sal.entity_id = ae.record_id::text
    and sal.action = ae.action::text
    and sal.created_at = ae.created_at
    and coalesce(sal.details, '') = coalesce(ae.reason, '')
);
