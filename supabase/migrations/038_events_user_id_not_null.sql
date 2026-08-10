-- Migration 038: events.user_id NOT NULL
--
-- user_id was added in migration 002 as a bare FK (`ADD COLUMN IF NOT EXISTS
-- user_id UUID REFERENCES auth.users(id)`) with no NOT NULL, so an ownerless
-- event has been representable since then. Nothing creates one — all five
-- insert paths set user_id (events POST, duplicate, sps-integration import,
-- site gallery, the password verify script) — but the type system had to model
-- the null, and a null owner is invisible to every ownership filter in the app:
-- reachable by share link, absent from its owner's dashboard, and refused by
-- guest search (lessons #50-51).
--
-- Verified 0 rows with user_id IS NULL across 18 events immediately before
-- applying. `set not null` scans the table and will abort loudly if that ever
-- stops being true, which is the behaviour we want — it is also a no-op if the
-- constraint is already present, so this is safe to re-run.

alter table public.events
  alter column user_id set not null;
