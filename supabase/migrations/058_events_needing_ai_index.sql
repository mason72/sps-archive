-- Which events are still waiting on AI indexing, oldest first.
--
-- Replaces a client-side approximation in the nightly backstop that had two
-- faults, the second worse than the first:
--
--   1. It capped at 25 events a night. A Pixieset bulk import is 1,371
--      collections; at 25/night the backstop is 55 days behind the import.
--
--   2. It selected those 25 from `.limit(5000)` rows of `images` with NO
--      ORDER BY, then took the distinct event_ids. During a bulk import those
--      5,000 rows can all belong to two or three large collections, so the
--      same events get nudged every night and everything else STARVES —
--      indefinitely, and silently, because the job reports success either way.
--      Raising the cap alone would not have fixed that.
--
-- Ordering by the oldest pending image makes it FIFO: the gallery that has
-- been waiting longest goes first, which is both fair and what someone
-- watching an import expects to see.
--
-- Grouping in the database rather than shipping 5,000 rows to Node is the same
-- rule as the dashboard count (see CLAUDE.md): an aggregate over a hot table
-- belongs in one grouped pass. `idx_images_unindexed` — (event_id) WHERE
-- ai_indexed_at IS NULL AND thumbnail_generated — already covers the predicate,
-- so this scans the unindexed set and never the whole table.

create or replace function events_needing_ai_index(max_events int default 200)
returns table (event_id uuid, pending bigint, oldest timestamptz)
language sql
stable
set search_path = public
as $$
  select i.event_id, count(*) as pending, min(i.created_at) as oldest
  from images i
  where i.ai_indexed_at is null
    and i.thumbnail_generated = true
    and i.media_type = 'image'
  group by i.event_id
  order by min(i.created_at) asc
  limit greatest(1, least(max_events, 2000));
$$;

comment on function events_needing_ai_index(int) is
  'Events holding unindexed displayable images, oldest pending image first. Used by the nightly AI-index backstop. Ordering is FIFO so a bulk import cannot starve the events behind it.';

revoke all on function events_needing_ai_index(int) from public, anon, authenticated;
grant execute on function events_needing_ai_index(int) to service_role;
