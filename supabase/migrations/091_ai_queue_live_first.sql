-- 091: the AI-index queue puts LIVE galleries ahead of migrated ones.
--
-- 090 ordered the queue newest shoot first. That is right within one kind of
-- work and still wrong across two: the Pixieset migration is a backfill of
-- 901 archive galleries (so far), and some of those carry recent dates. A
-- gallery a person uploaded or pulled from SPS this week is being opened this
-- week; a migrated one has waited years and can wait a day more. Migrated
-- galleries are marked `settings.pixiesetCollectionId` by the ingest
-- (scripts/pixieset-ingest.ts), so the rule is one expression:
--
--   live before migrated, then newest shoot first, then oldest gallery row.
--
-- Same signature and return shape as 090, so `create or replace` and no type
-- change. The ORDER BY appears twice (pick, then output) and must stay in step.

create or replace function events_needing_ai_index(
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
    select
      e.id,
      (coalesce(e.settings, '{}'::jsonb) ? 'pixiesetCollectionId') as migrated,
      coalesce(e.event_date, e.created_at::date) as shoot_date,
      e.created_at
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
    order by migrated asc, shoot_date desc, e.created_at asc
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
  order by n.migrated asc, n.shoot_date desc, n.created_at asc;
$$;

comment on function events_needing_ai_index(int, int, int, int) is
  'Galleries holding AI-indexable photos, in the order the lane should work them: live galleries before Pixieset-migrated ones, then newest shoot first, with how many photos are waiting. Picks galleries before counting so cost follows gallery count, not backlog size. Skips galleries with uploads in flight and photos inside the retry cool-down or out of attempts. Read by src/lib/ai-index/plan.ts.';
