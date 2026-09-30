-- A reference face must be the SITTER of its frame (2026-09-30, lesson 173).
--
-- The naming engine matches anonymous clusters against a reference centroid
-- per named person. That centroid averaged EVERY face in the named cluster,
-- including faces that are nobody's evidence of who the name belongs to:
--   * "Semhar Negassa" (2 faces): a HAND the detector found beside her in two
--     of her own headshots. The filename named every face in the frame, so
--     the hand got her name and became a reference.
--   * "Vijaya Kumar Vegi" (9 faces): tiny background faces from crowd shots
--     (7–42 faces per frame, quality 0.007–0.27), confirmed once at 0.558.
-- A blurry or non-face embedding sits near the middle of the space and so
-- matches everything a little: that one centroid was the best match for 11
-- unrelated clusters in 6 galleries.
--
-- Rule: a face counts toward a reference only if it is the highest-quality
-- face in its own frame AND clears the clustering seed floor (0.15, the
-- `minSeedQuality` default in src/lib/faces/clustering-core.ts — a face too
-- poor to START a cluster is too poor to vouch for a name). A solo headshot
-- always passes. Measured before shipping on all 26,458 centroids: 24,781
-- unchanged, 1,455 lose background faces, 221 drop out (every one built from
-- group frames, 2–12 faces each; "HR Team" and "Petros Efstathopoulosand
-- Darren Shou" among them), which retires 33 of 205 pending guest cards.
--
-- Body is the LIVE definition read from pg_proc on 2026-09-30 (identical to
-- 081) with only the sitter/quality filter added.
--
-- The whole-archive form (p_event_id null) no longer fits one statement at
-- 26k references; rebuild with scripts/triage/rebuild-reference-centroids.ts.
create or replace function public.refresh_person_reference_centroids(
  p_user_id uuid,
  p_event_id uuid default null::uuid,
  p_excluded_event_names text[] default '{}'::text[]
)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inserted_count int;
begin
  delete from person_reference_centroids c
  where c.user_id = p_user_id
    and (p_event_id is null or c.person_id in (
      select id from persons where event_id = p_event_id
    ));

  insert into person_reference_centroids
    (person_id, user_id, name_key, name, face_count, centroid, updated_at)
  select p.id, p_user_id,
         person_name_key(p.name),
         p.name, count(f.id)::int, avg(f.embedding)::vector(512), now()
  from persons p
  join events e on e.id = p.event_id
  join faces f on f.person_id = p.id and f.embedding is not null
  where e.user_id = p_user_id
    and (p_event_id is null or p.event_id = p_event_id)
    and not (e.name = any(p_excluded_event_names))
    and p.name is not null
    and person_name_key(p.name) not in (
      select person_key from excluded_people where user_id = p_user_id
    )
    -- The sitter rule (see header). Correlated on the candidate face's own
    -- frame (idx_faces_image_id), so a scoped refresh touches only that
    -- gallery. Twin of sitterFaceByImage() in cluster-event.ts: embedded
    -- faces only, null quality ranks as 0, ties on id.
    and f.quality >= 0.15
    and f.id = (
      select f2.id from faces f2
      where f2.image_id = f.image_id and f2.embedding is not null
      order by coalesce(f2.quality, 0) desc, f2.id
      limit 1
    )
  group by p.id, p.name
  having count(f.id) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;
