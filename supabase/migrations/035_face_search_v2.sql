-- Face search v2 (2026-08-10, "AI revival" Phase 2 — guest selfie flow).
-- Same hardening the image RPC got in 034: drop the legacy
-- processing_status gate (display gates on thumbnail_generated), REQUIRE the
-- owner's user id so no caller can forget scoping, and default the threshold
-- for normalized ArcFace cosines (same-person ≥ ~0.5; callers shape further).

drop function if exists search_faces_by_embedding(vector, uuid, real, integer);

create or replace function search_faces_by_embedding(
  query_embedding vector(512),
  target_user_id uuid,
  target_event_id uuid default null::uuid,
  match_threshold real default 0.4,
  match_count integer default 200
)
returns table(
  face_id uuid,
  image_id uuid,
  person_id uuid,
  similarity real
)
language sql
stable
set search_path to 'public'
as $$
  select
    f.id as face_id,
    f.image_id,
    f.person_id,
    (1 - (f.embedding <=> query_embedding))::real as similarity
  from faces f
  join images i on i.id = f.image_id
  join events e on e.id = i.event_id
  where f.embedding is not null
    and i.thumbnail_generated = true
    and e.user_id = target_user_id
    and (target_event_id is null or i.event_id = target_event_id)
    and 1 - (f.embedding <=> query_embedding) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_count;
$$;
