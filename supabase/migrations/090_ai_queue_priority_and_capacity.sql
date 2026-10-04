-- 090: the AI-index queue stops scanning the whole backlog, puts the newest
-- shoot first, and the database starts reporting its own capacity.
--
-- What broke (lesson 175, 2026-10-04). `events_needing_ai_index` grouped EVERY
-- unindexed image to pick the next galleries. At a 471,923-photo backlog that
-- took 18.4 s against the 15 s service_role timeout, so the 30-minute sweep
-- failed on all 96 runs for 48 hours and nothing that landed in that window was
-- ever requested. AAOMS 2026 (7,104 photos, pulled from SPS on 10-03) sat at
-- "Queued" behind it, 238th in a first-in-first-out line of 333 galleries.
--
-- Two changes to the queue:
--
--   1. PICK FIRST, COUNT AFTER. Walk `events` (under a thousand rows) and probe
--      the partial index once per gallery, then count only the galleries that
--      were picked. Cost follows the number of galleries, not the size of the
--      backlog. Measured cold on production at the same backlog: 2.4 s.
--
--   2. NEWEST SHOOT FIRST, not oldest-waiting first. The old order was fair
--      inside one bulk import and wrong across two kinds of work: a client
--      gallery from last week waited behind 419,014 archive photos from 2023
--      and 2024. The shoot people are opening this week is the newest one.
--      Nothing starves: the backlog is finite, and a gallery whose photos keep
--      failing drops out through the attempt rules below.
--
-- Galleries with uploads still in flight are left out. The job would only skip
-- them ("uploads-in-flight"), and under a capacity-sized sweep a skipped
-- gallery would hold a slot that real work could use. Upload finalize sends
-- its own request when the session settles.
--
-- `max_events` is clamped to 50. Each returned gallery costs one count over its
-- waiting photos; the old 2,000 ceiling is how a helper becomes the 18 s query.

drop function if exists events_needing_ai_index(int, int, int);

create function events_needing_ai_index(
  max_events int default 25,
  max_attempts int default 3,
  retry_after_minutes int default 60,
  upload_stale_minutes int default 30
)
returns table (event_id uuid, pending bigint, oldest timestamptz)
language sql
stable
set search_path = public
as $$
  with next_events as (
    select e.id, e.event_date, e.created_at
    from events e
    where exists (
        select 1
        from images i
        where i.event_id = e.id
          and i.ai_indexed_at is null
          and i.thumbnail_generated = true
          and i.media_type = 'image'
          and (
            i.ai_index_attempts = 0
            or (
              i.ai_index_attempts < max_attempts
              and i.ai_index_failed_at < now() - make_interval(mins => retry_after_minutes)
            )
          )
      )
      and not exists (
        select 1
        from images p
        where p.event_id = e.id
          and p.processing_status = 'pending'
          and p.created_at > now() - make_interval(mins => upload_stale_minutes)
      )
    order by coalesce(e.event_date, e.created_at::date) desc, e.created_at asc
    limit greatest(1, least(max_events, 50))
  )
  select n.id as event_id, c.pending, c.oldest
  from next_events n
  cross join lateral (
    select count(*) as pending, min(i.created_at) as oldest
    from images i
    where i.event_id = n.id
      and i.ai_indexed_at is null
      and i.thumbnail_generated = true
      and i.media_type = 'image'
      and (
        i.ai_index_attempts = 0
        or (
          i.ai_index_attempts < max_attempts
          and i.ai_index_failed_at < now() - make_interval(mins => retry_after_minutes)
        )
      )
  ) c
  order by coalesce(n.event_date, n.created_at::date) desc, n.created_at asc;
$$;

comment on function events_needing_ai_index(int, int, int, int) is
  'Galleries holding AI-indexable photos, newest shoot first, with how many are waiting. Picks galleries before counting so cost follows gallery count, not backlog size. Skips galleries with uploads in flight and photos inside the retry cool-down or out of attempts. Used by the ai-index-sweep cron.';

revoke all on function events_needing_ai_index(int, int, int, int) from public, anon, authenticated;
grant execute on function events_needing_ai_index(int, int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Capacity: the database reports its own size against the machine it runs on.
--
-- The incident's root cause was not the queue query. The compute size (Micro,
-- 1 GB) had been outgrown: the two HNSW indexes reached 691 MB against 768 MB
-- of cacheable memory, every face insert went to disk, and a 50-row insert went
-- from ~0.1 s to a mean of 8.3 s. 93 alert emails said "ai-index failing:
-- statement timeout" and none said "the database is out of memory, resize it".
-- These two functions are the raw readings; src/lib/monitoring/capacity.ts turns them
-- into one plain-language alert with the action attached.
--
-- Rows the check itself writes (context `capacity.*`, its alert ledger) are
-- left out of the timeout count, or an alert about timeouts would count as one.
--
-- SECURITY DEFINER so the readings are complete whoever asks (pg_stat_activity
-- hides other roles' rows from a plain role). No arguments, fixed search_path,
-- execute granted to service_role only.
--
-- TWO functions on purpose: the catalog reading is always fast, the backlog
-- reading counts rows. If the database is too slow to count, the first still
-- answers, and the check reports the second's failure as a finding instead of
-- going blind at exactly the moment it is needed.

create or replace function capacity_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'shared_buffers_bytes',
      (select setting::bigint * 8192 from pg_settings where name = 'shared_buffers'),
    'effective_cache_bytes',
      (select setting::bigint * 8192 from pg_settings where name = 'effective_cache_size'),
    'max_connections',
      (select setting::int from pg_settings where name = 'max_connections'),
    'connections',
      (select count(*) from pg_stat_activity where backend_type = 'client backend'),
    'vector_index_bytes',
      (select coalesce(sum(pg_relation_size(c.oid)), 0)
         from pg_class c
         join pg_am a on a.oid = c.relam
        where c.relkind = 'i' and a.amname in ('hnsw', 'ivfflat')),
    'timeouts_6h',
      (select count(*) from system_errors
        where created_at > now() - interval '6 hours'
          and message ilike '%statement timeout%'
          and context not like 'capacity.%'),
    'timeout_contexts_6h',
      (select coalesce(jsonb_object_agg(t.context, t.n), '{}'::jsonb)
         from (
           select context, count(*) as n
             from system_errors
            where created_at > now() - interval '6 hours'
              and message ilike '%statement timeout%'
              and context not like 'capacity.%'
            group by context
            order by count(*) desc
            limit 5
         ) t),
    'sweep_failures_2h',
      (select count(*) from system_errors
        where context = 'inngest.ai-index-sweep'
          and created_at > now() - interval '2 hours')
  );
$$;

comment on function capacity_snapshot() is
  'Catalog-only capacity reading: database size, memory settings, connections, vector index size, recent statement timeouts. Always fast. Read by the hourly capacity check.';

revoke all on function capacity_snapshot() from public, anon, authenticated;
grant execute on function capacity_snapshot() to service_role;

create or replace function ai_backlog_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'backlog_photos', b.photos,
    'backlog_events', b.events,
    'indexed_24h',
      (select count(*) from images where ai_indexed_at > now() - interval '24 hours'),
    'newest_indexed_at', (select max(ai_indexed_at) from images)
  )
  from (
    -- Exactly idx_images_unindexed's predicate, so this never touches the
    -- indexed bulk of the table.
    select count(*) as photos, count(distinct event_id) as events
      from images
     where ai_indexed_at is null
       and thumbnail_generated = true
  ) b;
$$;

comment on function ai_backlog_snapshot() is
  'AI-index backlog reading: photos and galleries waiting, photos indexed in the last 24 hours, newest successful index time. Needs idx_images_ai_indexed_at (089).';

revoke all on function ai_backlog_snapshot() from public, anon, authenticated;
grant execute on function ai_backlog_snapshot() to service_role;

-- One row per check. The trend is the point: "the backlog grew for nine days"
-- had to be reconstructed by hand on 2026-10-04 because nothing recorded it.
create table if not exists capacity_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  data jsonb not null
);

create index if not exists idx_capacity_snapshots_taken_at
  on capacity_snapshots (taken_at desc);

-- Service role only: RLS on with no policies, same as sps_connections.
alter table capacity_snapshots enable row level security;
revoke all on capacity_snapshots from anon, authenticated;
