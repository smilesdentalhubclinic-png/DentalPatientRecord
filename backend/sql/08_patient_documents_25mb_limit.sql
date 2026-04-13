-- Set the patient-documents storage bucket limit to 25 MB per file.
-- Safe to run on an existing database. This does not drop tables or delete data.

insert into storage.buckets (id, name, public, file_size_limit)
values ('patient-documents', 'patient-documents', true, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;
