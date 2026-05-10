-- Presence heartbeat support for near-real-time staff online indicators.
-- Safe to re-run.

alter table public.staff_profiles
  add column if not exists last_seen_at timestamptz;
