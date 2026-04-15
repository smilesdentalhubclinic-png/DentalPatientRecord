create unique index if not exists idx_patients_identity_active_unique
on public.patients (
  lower(regexp_replace(btrim(first_name), '\s+', ' ', 'g')),
  lower(regexp_replace(btrim(last_name), '\s+', ' ', 'g')),
  sex,
  birth_date
)
where archived_at is null
  and birth_date is not null;
