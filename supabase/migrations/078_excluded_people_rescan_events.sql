-- The events an exclusion deleted suggestions from, so its undo can ask the
-- naming engine to look at them again.
--
-- Found verifying 077 on production (2026-09-11): excluding "Weka SKO27"
-- deleted 53 pending suggestions across five events, but the undo re-scanned
-- only the one event whose cluster LABELS it restored. The five events that
-- had held the cards were never asked again, so "its suggestions return at
-- the next scan" was true only for an event that happened to be re-clustered
-- later — for a finished shoot, never.
--
-- One writer (excludeNonPerson), one reader (restoreNonPerson). NULL means
-- none recorded, which is every exclusion made before this column.

alter table excluded_people add column if not exists rescan_event_ids uuid[];

comment on column excluded_people.rescan_event_ids is
  'Events this exclusion cleared suggestions from (and un-named clusters in); the undo re-scans them so the engine can offer the name again. NULL = none recorded.';
