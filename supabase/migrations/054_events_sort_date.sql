-- events.sort_date — the day an event should sort by, always populated.
--
-- The archive list orders by `event_date`, which is NULL on a third of the live
-- events (9 of 28 on 2026-08-13: sample galleries, an undated eBay headshot day,
-- both pinned TDP workspaces). Ordering by it alone puts every undated event
-- BELOW the oldest dated one — so an untitled gallery created yesterday sorts
-- beneath a 2014 archive import, which is the opposite of useful.
--
-- Mason's rule (2026-08-13): "generally if we don't know the event date, just
-- fall back to creation date." That is what this column is. Some events are
-- genuinely undated by nature ("Two Dudes Sample Images") and will never have an
-- event_date; they should still sit where they were made.
--
-- Why a GENERATED column rather than ordering by an expression: PostgREST can
-- only order by real columns, so `coalesce(...)` cannot be expressed through the
-- API at all. Generated + STORED also means it is indexable, which matters once
-- the Pixieset import takes this table past 1,400 rows.
--
-- `at time zone 'UTC'` is required for the cast to be immutable enough for a
-- stored generated column — a bare `created_at::date` reads the session TimeZone
-- and Postgres rejects it. The cost is that an event created late evening
-- Pacific sorts under the following UTC day. Irrelevant for ordering, and
-- preferable to the column not existing.
--
-- Purely additive: no existing column is read differently, and `event_date`
-- remains the source of truth wherever it is set.

alter table events
  add column if not exists sort_date date
  generated always as (
    coalesce(event_date, (created_at at time zone 'UTC')::date)
  ) stored;

comment on column events.sort_date is
  'Ordering key: event_date when known, else the UTC date the row was created. Generated; never write to it.';

-- Matches the list query's ORDER BY exactly (pinned first, then newest day).
create index if not exists events_user_pinned_sort_date_idx
  on events (user_id, pinned_at desc nulls last, sort_date desc, created_at desc);
