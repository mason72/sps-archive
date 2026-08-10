-- Scene scoring for intelligent sections (2026-08-10, AI revival Phase 4).
--
-- Returns a similarity for EVERY indexed image in an event — deliberately no
-- ORDER BY distance and no LIMIT, so the planner gets an exact sequential
-- scan instead of an HNSW approximation (ANN top-K would silently drop rows,
-- and section planning needs full coverage). Ownership is a required
-- parameter, same contract as the search RPCs.

create or replace function score_images_by_embedding(
  query_embedding vector(1152),
  target_user_id uuid,
  target_event_id uuid
)
returns table(
  id uuid,
  similarity real
)
language sql
stable
set search_path to 'public'
as $$
  select
    i.id,
    (1 - (i.siglip_embedding <=> query_embedding))::real as similarity
  from images i
  join events e on e.id = i.event_id
  where i.event_id = target_event_id
    and e.user_id = target_user_id
    and i.siglip_embedding is not null
    and i.thumbnail_generated = true;
$$;
