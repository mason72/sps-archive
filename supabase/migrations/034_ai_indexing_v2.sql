-- AI indexing v2 (2026-08-09, tasks/todo.md "AI revival" Phase 0)
--
-- The v1 CLIP pipeline never deployed: clip_embedding was NULL on all 19,642
-- rows when this ran (verified live). Replaced by SigLIP-2 so400m (1152-dim).
-- scene_tags / aesthetic_score / sharpness_score columns stay: aesthetic +
-- sharpness are written by the v2 indexer; scene_tags is legacy-empty (scene
-- classification is now computed at suggest time from stored embeddings,
-- never persisted at ingest).
--
-- Invariant: the AI indexer writes ONLY siglip_embedding, embedding_model,
-- ai_indexed_at, aesthetic_score, sharpness_score (+ faces rows). It never
-- touches processing_status or any column the upload/display path reads.

alter table images drop column if exists clip_embedding;

alter table images add column if not exists siglip_embedding vector(1152);
alter table images add column if not exists embedding_model text;
alter table images add column if not exists ai_indexed_at timestamptz;

create index if not exists idx_images_siglip_embedding
  on images using hnsw (siglip_embedding vector_cosine_ops);

-- Find events with unindexed work cheaply (reconciler sweep + settlement job).
create index if not exists idx_images_unindexed
  on images (event_id)
  where ai_indexed_at is null and thumbnail_generated = true;

-- Old 768-dim RPC gated on processing_status = 'complete' — the legacy column
-- that once hid fully-uploaded photos. The replacement gates on
-- thumbnail_generated (the display gate) and REQUIRES a user id so ownership
-- scoping can never be forgotten by a caller (the getAuthUser IDOR class).
-- NOTE: SigLIP similarities are well-calibrated but small in magnitude
-- (typical match ~0.05-0.15 cosine), so the default threshold is low;
-- calibrate in the search route, not here.
drop function if exists search_images_by_embedding(vector, uuid, real, integer);

create or replace function search_images_by_embedding(
  query_embedding vector(1152),
  target_user_id uuid,
  target_event_id uuid default null::uuid,
  match_threshold real default 0.02,
  match_count integer default 50
)
returns table(
  id uuid,
  event_id uuid,
  filename text,
  original_filename text,
  r2_key text,
  similarity real
)
language sql
stable
set search_path to 'public'
as $$
  select
    i.id,
    i.event_id,
    i.filename,
    i.original_filename,
    i.r2_key,
    (1 - (i.siglip_embedding <=> query_embedding))::real as similarity
  from images i
  join events e on e.id = i.event_id
  where i.siglip_embedding is not null
    and i.thumbnail_generated = true
    and e.user_id = target_user_id
    and (target_event_id is null or i.event_id = target_event_id)
    and 1 - (i.siglip_embedding <=> query_embedding) > match_threshold
  order by i.siglip_embedding <=> query_embedding
  limit match_count;
$$;
