-- Hotfix:
-- Backfill imported service_records.performed_by using the same-day dental record dentist
-- when the service row came from the migration import workflow.
--
-- Safe to re-run.

with imported_service_days as (
  select distinct
    pl.patient_id,
    ((pl.created_at at time zone 'Asia/Manila')::date) as service_day
  from public.patient_logs pl
  where pl.action = 'service_update'::public.patient_log_action
    and coalesce(pl.details, '') = 'Imported service record migration.'
),
latest_dentists as (
  select distinct on (
    dr.patient_id,
    ((dr.recorded_at at time zone 'Asia/Manila')::date)
  )
    dr.patient_id,
    ((dr.recorded_at at time zone 'Asia/Manila')::date) as service_day,
    case
      when coalesce(dr.chart_data->>'dentist_user_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (dr.chart_data->>'dentist_user_id')::uuid
      else null
    end as dentist_user_id
  from public.dental_records dr
  where dr.archived_at is null
  order by
    dr.patient_id,
    ((dr.recorded_at at time zone 'Asia/Manila')::date),
    dr.recorded_at desc,
    dr.created_at desc
)
update public.service_records sr
set
  performed_by = ld.dentist_user_id,
  updated_at = now()
from imported_service_days isd
join latest_dentists ld
  on ld.patient_id = isd.patient_id
 and ld.service_day = isd.service_day
where sr.patient_id = isd.patient_id
  and ((sr.visit_at at time zone 'Asia/Manila')::date) = isd.service_day
  and sr.archived_at is null
  and ld.dentist_user_id is not null
  and sr.performed_by is distinct from ld.dentist_user_id;
