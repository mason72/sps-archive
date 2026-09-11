-- A shared name is not a shared person. The /people index keys identity on
-- the name filenames carry, so every "Alex" in the archive was one card —
-- five different men, ranked #1 on the Wall of Fame (Mason, 2026-09-11:
-- "they are totally different people"). This function lets the index ask, for
-- each name spanning several events, whether the frames filed under it in two
-- events show the same face.
--
-- Measured the day it was written, over every identity spanning 2+ events:
-- of 709 event pairs, 632 matched (>= 0.55) and 77 did not (< 0.363), and none
-- fell between. See src/lib/people/face-split.ts.
--
-- Input is two parallel lists (group label, image id) plus the pairs of groups
-- to compare. Only frames with exactly ONE embedded face count — a group shot
-- cannot promise which face is the person (lesson 96). Averaging happens here
-- so no embedding ever leaves the database.

create or replace function face_group_similarity(
  p_group text[],
  p_image uuid[],
  p_a text[],
  p_b text[]
)
returns table (a text, b text, sim double precision, solo_a integer, solo_b integer)
language sql
stable
set search_path = public, extensions
as $$
  with m as (
    select unnest(p_group) as g, unnest(p_image) as img
  ),
  solo as (
    select f.image_id
    from faces f
    where f.image_id in (select img from m)
      and f.embedding is not null
    group by f.image_id
    having count(*) = 1
  ),
  c as (
    select m.g, avg(f.embedding) as v, count(*)::int as n
    from m
    join solo s on s.image_id = m.img
    join faces f on f.image_id = m.img and f.embedding is not null
    group by m.g
  ),
  pr as (
    select unnest(p_a) as a, unnest(p_b) as b
  )
  select pr.a, pr.b, (1 - (ca.v <=> cb.v))::double precision, ca.n, cb.n
  from pr
  join c ca on ca.g = pr.a
  join c cb on cb.g = pr.b
$$;

-- Server-side only: face similarity across a photographer's clients is not
-- something a browser session should be able to ask for.
revoke all on function face_group_similarity(text[], uuid[], text[], text[]) from public, anon, authenticated;
grant execute on function face_group_similarity(text[], uuid[], text[], text[]) to service_role;
