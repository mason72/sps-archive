-- event_readiness: also return the event's RAW row count.
--
-- Why: GET /api/events asked Postgres for the per-event photo count twice over,
-- by two different mechanisms. The dashboard card's "N images" came from
-- PostgREST's embedded aggregate `images!images_event_id_fkey(count)`, which
-- runs a correlated subquery PER EVENT ROW; this function then scanned the same
-- rows again, once, for readiness. Measured on the live archive (26 events,
-- 30,111 images): the embedded version is an index-only scan that performs
-- 23,136 HEAP FETCHES, because `images` is written to constantly (uploads, AI
-- indexing, SPS pulls) and its visibility map is never current. Warm it runs in
-- 16ms; under write load with cold buffers it exceeded the 8s statement_timeout
-- PostgREST inherits from the `authenticator` role, Postgres cancelled the
-- statement, and the whole dashboard returned 500 — "Something went wrong",
-- cured by two or three hard refreshes. Three of those in one 45-minute window
-- on 2026-08-12.
--
-- Folding the count into this function's existing GROUP BY costs one more
-- aggregate over rows already being scanned, and lets the events list stop
-- touching `images` at all.
--
-- `all_rows` is deliberately NOT `total`. They count different things and the
-- dashboard needs the wider one:
--   total    — settled photos (media_type='image' AND processing_status='complete');
--              the denominator of the readiness ring.
--   all_rows — every row in the event: videos, pending uploads, failures too.
--              This is what the card's "N images" has always shown, and
--              silently narrowing it would shrink every count on the dashboard.
--
-- This function has run in production since the readiness work landed but was
-- applied by hand and never checked in — there was no migration file for it
-- anywhere in the repo. This migration is therefore also its first definition
-- under version control. The DROP + CREATE pair is required (a return TABLE
-- shape cannot be changed by CREATE OR REPLACE) and runs in one transaction,
-- so a concurrent dashboard load sees either the old function or the new one,
-- never a missing one.

begin;

set local lock_timeout = '8s';

drop function if exists public.event_readiness(uuid[]);

create function public.event_readiness(p_event_ids uuid[])
returns table (
  event_id uuid,
  total bigint,
  indexed bigint,
  uploading bigint,
  stalled bigint,
  all_rows bigint
)
language sql
stable
as $$
  select
    i.event_id,
    count(*) filter (
      where i.media_type = 'image' and i.processing_status = 'complete'
    ) as total,
    count(*) filter (
      where i.media_type = 'image'
        and i.processing_status = 'complete'
        and i.ai_indexed_at is not null
    ) as indexed,
    count(*) filter (
      where i.processing_status = 'pending'
        and i.created_at > now() - interval '30 minutes'
    ) as uploading,
    count(*) filter (
      where i.processing_status = 'pending'
        and i.created_at <= now() - interval '30 minutes'
    ) as stalled,
    count(*) as all_rows
  from images i
  where i.event_id = any(p_event_ids)
  group by i.event_id;
$$;

-- Grants recreated EXACTLY as the live function carried them (captured from
-- pg_proc.proacl before the drop): EXECUTE to PUBLIC plus the three Supabase
-- roles. Only the server's service client calls this, so `anon` holding EXECUTE
-- is wider than it needs to be — but narrowing access is a different change
-- with a different blast radius, and bundling it into a performance fix would
-- make a rollback ambiguous. Raised separately.
grant execute on function public.event_readiness(uuid[]) to anon, authenticated, service_role;

commit;
