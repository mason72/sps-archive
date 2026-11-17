-- Score every photo in one event against SEVERAL vectors in one pass (2026-11-16).
--
-- The Highlights picker scores each photo against its learned direction plus
-- eight rule phrases (lib/highlights/rules.ts). With score_images_by_embedding
-- that was nine calls, each a full scan re-run for every 1,000-row page because
-- PostgREST caps a response at 1,000 rows: 8.6 s on Electronica 2026 (4,964
-- photos). This returns ONE jsonb object, {image_id: [sim per vector, ...]},
-- so it is one scan and one round trip, and the row cap does not apply.
--
-- Same contract as score_images_by_embedding (036): ownership is a required
-- parameter, no ORDER BY / LIMIT, so the planner does an exact scan and every
-- indexed photo is covered. Vectors arrive as a jsonb array of arrays and are
-- cast per element, which PostgREST passes through unchanged.

create or replace function score_images_by_vectors(
  query_embeddings jsonb,
  target_user_id uuid,
  target_event_id uuid
)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  -- MATERIALIZED: otherwise Postgres inlines this CTE into the per-photo
  -- subquery and re-parses every vector's text for every photo (45k parses of
  -- ~10 KB on Electronica: 11.1 s, slower than the nine calls it replaced).
  with q as materialized (
    select ord, (elem::text)::vector(1152) as v
    from jsonb_array_elements(query_embeddings) with ordinality as t(elem, ord)
  )
  select coalesce(jsonb_object_agg(s.id, s.sims), '{}'::jsonb)
  from (
    select
      i.id,
      (
        -- ::real, NOT round(): the old function returned real, and rounding to 5
        -- decimals created score ties that reordered picks (review, 2026-11-16).
        select jsonb_agg((1 - (i.siglip_embedding <=> q.v))::real order by q.ord)
        from q
      ) as sims
    from images i
    join events e on e.id = i.event_id
    where i.event_id = target_event_id
      and e.user_id = target_user_id
      and i.siglip_embedding is not null
      and i.thumbnail_generated = true
  ) s;
$$;

-- Server-only, decided here (security-currency rule: every function's grant is
-- decided in the migration that creates it).
revoke all on function score_images_by_vectors(jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function score_images_by_vectors(jsonb, uuid, uuid) to service_role;
