-- event_readiness: count photos AI indexing has given up on (lesson 151 follow-up).
--
-- Migration 082 made a photo that fails Modal 3 times stop being retried. It
-- still has ai_indexed_at NULL, so `indexed` never reached `total` and the
-- gallery's readiness badge never reached ready. The same held for the event
-- page's banner and its AI-dependent controls (scene sorting, Smart section),
-- which would have stayed disabled forever over one undecodable photo.
--
-- The fix is a NAMED count, not a quiet one: `gave_up` is returned beside
-- `indexed` and never folded into it, because "indexed" must stay a true claim.
-- Readiness in TS (isAiReady in src/lib/events/status.ts) is then
-- indexed + gave_up >= total, and the UI says how many were not processed.
--
-- p_max_attempts is PASSED from src/lib/ai-index/failures.ts
-- (AI_INDEX_MAX_ATTEMPTS), the one home for that number; the default exists
-- only so a caller that predates this migration keeps working.
--
-- Return type changes, so the function is dropped and recreated rather than
-- replaced. db-sql.ts sends the file as one transaction, so no caller sees a
-- gap. Grants match what is live (migration 049 narrowed it to service_role);
-- captured from pg_proc.proacl on 2026-09-14 before writing this.

drop function if exists public.event_readiness(uuid[]);

create function public.event_readiness(p_event_ids uuid[], p_max_attempts int default 3)
returns table (
  event_id uuid,
  total bigint,
  indexed bigint,
  uploading bigint,
  stalled bigint,
  all_rows bigint,
  gave_up bigint
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
    count(*) as all_rows,
    count(*) filter (
      where i.media_type = 'image'
        and i.processing_status = 'complete'
        and i.ai_indexed_at is null
        and i.ai_index_attempts >= p_max_attempts
    ) as gave_up
  from images i
  where i.event_id = any(p_event_ids)
  group by i.event_id;
$$;

comment on function public.event_readiness(uuid[], int) is
  'Per-event readiness counts in one grouped pass: settled photos (total), AI-indexed, uploading, stalled, every row, and gave_up (unindexed after p_max_attempts Modal failures). Readiness = indexed + gave_up >= total.';

revoke all on function public.event_readiness(uuid[], int) from public, anon, authenticated;
grant execute on function public.event_readiness(uuid[], int) to service_role;
