-- Per-image AI-index failure marker (lesson 151).
--
-- When Modal returns an image in `errors`, that image never gets
-- `ai_indexed_at`. Before this migration nothing else recorded the failure, so:
--
--   1. `events_needing_ai_index` listed its event on EVERY 30-minute sweep, and
--      `indexEventBatch` re-sent the same first 100 unindexed ids (ordered by
--      id) to paid Modal each time: ~107 GPU-seconds, ~1.8¢ a pass, ~48 passes
--      a day, forever.
--   2. If all 100 in a batch failed, the images after them were never reached.
--   3. The sweep is FIFO by oldest pending image, so >= 200 permanently failing
--      events would have starved every newer gallery.
--
-- Measured 2026-09-14 before building: 6 of 2,027 batches in 30 days had
-- errors (34 of 192,942 images, 2 events), and ALL 34 indexed on a later
-- retry. So failures here are mostly TRANSIENT (thumbnail fetch blips), and
-- "give up after one failure" would have permanently skipped 34 good photos.
-- The rule is therefore retry-with-cool-down, then give up:
--
--   eligible = never failed
--           OR (attempts < max_attempts AND last failure older than retry_after)
--
-- The constants live in src/lib/ai-index/failures.ts and are PASSED IN; the
-- defaults below only exist so an older caller keeps working.
--
-- AI-owned columns only (docs/AI.md): the upload and display paths never read
-- these. `ai_indexed_at` stays the one "done" marker, written last on success.
--
-- Lock cost: ADD COLUMN with a constant default is a catalog-only change on
-- Postgres 11+, no table rewrite. db-sql.ts sets lock_timeout = 5s, so a busy
-- table fails the migration instead of queueing reads behind it.

alter table images
  add column if not exists ai_index_attempts smallint not null default 0,
  add column if not exists ai_index_failed_at timestamptz,
  add column if not exists ai_index_error text;

comment on column images.ai_index_attempts is
  'AI-owned. Consecutive Modal per-image failures since the last success. Reset to 0 when the image indexes.';
comment on column images.ai_index_failed_at is
  'AI-owned. When the most recent per-image AI-index failure was recorded. Gates the retry cool-down.';
comment on column images.ai_index_error is
  'AI-owned. Modal''s message for the most recent per-image failure (truncated).';

-- Atomic increment. PostgREST cannot express `attempts = attempts + 1`, and a
-- read-modify-write from Node would lose counts under concurrent runs.
-- Guarded on ai_indexed_at IS NULL so a failure can never be recorded against
-- an image another run has already finished.
create or replace function record_ai_index_failures(p_ids uuid[], p_errors text[])
returns table (image_id uuid, attempts smallint)
language sql
volatile
set search_path = public
as $$
  update images i
     set ai_index_attempts = least(i.ai_index_attempts + 1, 32767)::smallint,
         ai_index_failed_at = now(),
         ai_index_error = left(f.err, 500)
    from unnest(p_ids, p_errors) as f(id, err)
   where i.id = f.id
     and i.ai_indexed_at is null
  returning i.id, i.ai_index_attempts;
$$;

comment on function record_ai_index_failures(uuid[], text[]) is
  'Record per-image AI-index failures reported by Modal: increments ai_index_attempts, stamps ai_index_failed_at/ai_index_error. Skips images already indexed.';

revoke all on function record_ai_index_failures(uuid[], text[]) from public, anon, authenticated;
grant execute on function record_ai_index_failures(uuid[], text[]) to service_role;

-- The queue now skips images that are cooling down or have given up. The old
-- one-argument signature is dropped first: `create or replace` with new
-- parameters would add an OVERLOAD, and a call passing only max_events would
-- then be ambiguous.
drop function if exists events_needing_ai_index(int);

create function events_needing_ai_index(
  max_events int default 200,
  max_attempts int default 3,
  retry_after_minutes int default 60
)
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
    and (
      i.ai_index_attempts = 0
      or (
        i.ai_index_attempts < max_attempts
        and i.ai_index_failed_at < now() - make_interval(mins => retry_after_minutes)
      )
    )
  group by i.event_id
  order by min(i.created_at) asc
  limit greatest(1, least(max_events, 2000));
$$;

comment on function events_needing_ai_index(int, int, int) is
  'Events holding AI-indexable images, oldest pending image first (FIFO so a bulk import cannot starve the events behind it). Skips images whose last AI-index failure is inside the retry cool-down or that have used max_attempts. Used by the ai-index-sweep cron.';

revoke all on function events_needing_ai_index(int, int, int) from public, anon, authenticated;
grant execute on function events_needing_ai_index(int, int, int) to service_role;
