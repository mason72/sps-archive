-- Search on a fingerprint, then re-rank on the real thing.
--
-- WHY. Semantic search compares a query against every candidate photo. Today
-- that comparison runs against the full 1152-number vector, and the index that
-- makes it fast has to sit in RAM. RAM is the only expensive thing in this
-- system: Supabase sells it as instance tiers (~$13/GB/month), while disk is
-- $0.125/GB/month and R2 is $0.015. At Mason's real pace of ~370,000 photos a
-- year, that index reaches 17 GB in four years and forces a $410/month
-- instance — before Pixieset's 1.88M are considered at all. That does not close
-- as a product: a photographer cannot be charged $200/month to cover search.
--
-- WHAT CHANGES. `binary_quantize` reduces each vector to one bit per dimension
-- — a 144-byte fingerprint instead of 4,608 bytes. The fingerprint index picks
-- a generous shortlist by Hamming distance (how many bits differ), and then the
-- REAL vectors decide the final order among only those candidates. The cheap
-- structure narrows; the exact one ranks.
--
-- MEASURED on the live archive (30,098 photos) before writing this:
--   full-precision index  226 MB
--   half-precision        75 MB   (3x)
--   fingerprint           13 MB   (18x)
-- and on 25 sample queries, the fingerprint+re-rank top 10 matched the
-- full-precision top 10 on average 9.875 times out of 10, never worse than 9.
--
-- TWO THINGS DELIBERATELY NOT DONE HERE:
--
-- 1. `score_images_by_embedding` is untouched. It has no ORDER BY and no LIMIT
--    — it scores every photo in one event for the section planner and the
--    highlights ranker. It never used the vector index, so it gains nothing
--    from a shortlist, and adding one would silently change it from "score all"
--    to "score some", which is a different function wearing the same name.
--
-- 2. The old full-precision indexes are NOT dropped. Once these functions stop
--    ordering by the raw vector, those indexes become dead weight and dropping
--    them is where the saving is actually realised — but that is a separate,
--    verified step. Keeping them means this migration can be rolled back by
--    restoring two function bodies and nothing else.
--
-- THE TRAP THIS AVOIDS. Every filter stays INSIDE the shortlist. Take the
-- global nearest 200 fingerprints first and then filter to one event, and a
-- search scoped to a small gallery returns nothing at all, because the whole
-- shortlist belonged to other galleries. The filters must narrow the candidate
-- set before the shortlist is cut, not after.

begin;

set local lock_timeout = '8s';

-- Fingerprint indexes. `bit_hamming_ops` ranks by how many bits differ.
-- The expression must match the queries below EXACTLY or the planner ignores
-- the index and silently falls back to a sequential scan — correct answers,
-- terrible speed, no error to notice.
create index if not exists idx_images_siglip_binary
  on public.images
  using hnsw ((binary_quantize(siglip_embedding)::bit(1152)) bit_hamming_ops);

create index if not exists idx_faces_embedding_binary
  on public.faces
  using hnsw ((binary_quantize(embedding)::bit(512)) bit_hamming_ops);

-- ─── Archive / gallery semantic search ─────────────────────────────────────

create or replace function public.search_images_by_embedding(
  query_embedding vector,
  target_user_id uuid,
  target_event_id uuid default null::uuid,
  match_threshold real default 0.02,
  match_count integer default 50
)
returns table(
  id uuid, event_id uuid, filename text, original_filename text,
  r2_key text, similarity real
)
language sql stable
set search_path to 'public'
-- ef_search is how many candidates the index walk examines. It MUST be >= the
-- shortlist size or the walk returns short, and a search narrowed to one event
-- then returns a fraction of what was asked for. Default is 40; the first
-- version of this migration inherited it and event-scoped searches came back
-- with 8 rows instead of 30.
set hnsw.ef_search to 800
as $function$
  with shortlist as (
    select
      i.id, i.event_id, i.filename, i.original_filename, i.r2_key,
      i.siglip_embedding
    from images i
    join events e on e.id = i.event_id
    where i.siglip_embedding is not null
      and i.thumbnail_generated = true
      and e.user_id = target_user_id
      and (target_event_id is null or i.event_id = target_event_id)
    -- Ten candidates per result, floor of 200. Generous on purpose: the
    -- fingerprint only has to get the right photos into the room, and the
    -- re-rank below decides the order.
    order by binary_quantize(i.siglip_embedding)::bit(1152)
           <~> binary_quantize(query_embedding)::bit(1152)
    limit greatest(match_count * 10, 200)
  )
  select
    s.id, s.event_id, s.filename, s.original_filename, s.r2_key,
    (1 - (s.siglip_embedding <=> query_embedding))::real as similarity
  from shortlist s
  -- The threshold is applied AFTER re-ranking, against true similarity. A
  -- fingerprint distance is not a similarity and must never be compared to one.
  where 1 - (s.siglip_embedding <=> query_embedding) > match_threshold
  order by s.siglip_embedding <=> query_embedding
  limit match_count;
$function$;

-- ─── Selfie search (guest-facing) ──────────────────────────────────────────

create or replace function public.search_faces_by_embedding(
  query_embedding vector,
  target_user_id uuid,
  target_event_id uuid default null::uuid,
  match_threshold real default 0.4,
  match_count integer default 200
)
returns table(face_id uuid, image_id uuid, person_id uuid, similarity real)
language sql stable
set search_path to 'public'
set hnsw.ef_search to 800
as $function$
  with shortlist as (
    select f.id, f.image_id, f.person_id, f.embedding
    from faces f
    join images i on i.id = f.image_id
    join events e on e.id = i.event_id
    where f.embedding is not null
      and i.thumbnail_generated = true
      and e.user_id = target_user_id
      and (target_event_id is null or i.event_id = target_event_id)
    order by binary_quantize(f.embedding)::bit(512)
           <~> binary_quantize(query_embedding)::bit(512)
    limit greatest(match_count * 10, 200)
  )
  select
    s.id as face_id, s.image_id, s.person_id,
    (1 - (s.embedding <=> query_embedding))::real as similarity
  from shortlist s
  where 1 - (s.embedding <=> query_embedding) > match_threshold
  order by s.embedding <=> query_embedding
  limit match_count;
$function$;

grant execute on function public.search_images_by_embedding(vector, uuid, uuid, real, integer) to service_role;
grant execute on function public.search_faces_by_embedding(vector, uuid, uuid, real, integer) to service_role;

commit;
