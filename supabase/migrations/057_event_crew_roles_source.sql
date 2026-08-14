-- Where a crew member's roles came from.
--
-- Roles are being pre-filled by inference (title order, gig type, crew count)
-- so that Mason edits rather than types 42 links from scratch. That is only
-- safe if a guess is DISTINGUISHABLE from a fact — otherwise the pivot reports
-- "Joey led 13 gigs" with the same confidence whether a human said so or a
-- regex did, and the whole rehire dimension becomes untrustworthy.
--
-- Same principle as `event_intel.confirmed_at`, one level down: that records
-- whether the EVENT's intel was confirmed; this records whether THIS PERSON's
-- roles on it were. They move independently — you can confirm a venue without
-- having any idea who was the digital tech.
--
--   inferred   a machine guessed from the calendar. Shown as provisional.
--   manual     a human set it. Never overwritten by a re-run.
--
-- The default is 'manual' on purpose: anything written by a future hand-editing
-- path is a fact unless it explicitly says otherwise. Only the backfill marks
-- its own work as a guess.

alter table event_crew
  add column if not exists roles_source text not null default 'manual';

alter table event_crew
  drop constraint if exists event_crew_roles_source_check;
alter table event_crew
  add constraint event_crew_roles_source_check
  check (roles_source in ('inferred', 'manual'));

-- The backfill re-runs; finding what it may safely overwrite must not be a
-- full scan that grows with the archive.
create index if not exists event_crew_inferred_idx
  on event_crew (user_id) where roles_source = 'inferred';

comment on column event_crew.roles_source is
  'inferred = a machine guessed from the calendar, shown as provisional and safe to overwrite. manual = a human set it, never overwritten by a re-run.';
