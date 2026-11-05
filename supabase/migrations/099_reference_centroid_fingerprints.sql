-- 099: match_person_cluster shortlists on a 1-bit fingerprint, then ranks
-- exactly. Same signature, same output; ~20x less work per call.
--
-- WHY (2026-11-05). match_person_cluster was the most expensive query in the
-- database: 111,896 calls since 2026-09-28 at 618 ms each, 19.2 hours of
-- database CPU (pg_stat_statements). Every call compared one cluster's average
-- face against ALL 83,151 reference faces at full precision, with no index:
-- each comparison read a 2 KB vector out of TOAST (Postgres's overflow storage
-- for large values), so it was a 245 MB scan per call. It runs once per
-- undecided cluster on every identity scan, which follows every face clustering
-- run, so it lands in the same window as a big upload's face inserts.
--
-- WHAT. Each reference face gets a stored fingerprint, `centroid_bits`: one bit
-- per dimension (64 bytes instead of 2,048), computed by Postgres from
-- `centroid` on every insert/update, so no writer has to know it exists. The
-- function scans the fingerprints by Hamming distance (how many bits differ) to
-- pick the 200 closest, then re-ranks only those on the real vectors. The
-- fingerprints are small enough to live in the table row, so the scan never
-- touches TOAST: 83k rows in ~24 ms. Measured: 799 ms -> 42 ms on one cluster;
-- 302 s -> 21 s for 400 clusters.
--
-- MEASURED (two samples of 400 clusters each: 300 that once earned a guest
-- suggestion, 100 random unnamed): every hit at similarity >= 0.45 was
-- identical to the exact search, same person, same similarity to 4 decimals,
-- same order: 303 of 303 clusters before applying (against a prototype), 304
-- of 304 after (the live function against an exact search written inline).
-- The deepest fingerprint rank any decisive hit reached was 6 (343 hits), so
-- the shortlist has ~30x headroom. 0.45 is the line that
-- matters: suggestions need >= 0.55, and auto-confirm needs >= 0.70 with a
-- 0.10 margin over the runner-up, so a hit below 0.45 cannot change either
-- decision. Below that the order of near-strangers can differ (top-1 differed
-- in 6 of 400, all under 0.45). Re-check: scripts/triage/match-cluster-parity.ts.
--
-- WHY NOT AN HNSW INDEX on the fingerprint (migration 050's pattern, tried
-- first and dropped here): it MISSED the true best match, a 0.84 hit ranked #1
-- by exact Hamming distance (83 bits vs ~211 for every stranger), at both 200
-- and 400 candidates. Almost every reference face sits at nearly the same
-- distance from any query, so the graph has nothing to steer by and loses the
-- few faces that are actually close: the only ones that matter here. An exact
-- scan cannot miss what quantization keeps. It is linear in reference count
-- (~24 ms per 83k), which is fine to several hundred thousand references.
--
-- ROLLBACK: restore the function body from migration 065 (its only copy) and
-- `alter table person_reference_centroids drop column centroid_bits`.
--
-- Adding a STORED generated column rewrites the table (245 MB) under an
-- exclusive lock for a few seconds. Only the identity engine reads it, never a
-- guest page. The runner's lock_timeout (5 s) makes this fail rather than queue
-- if a centroid refresh holds the table; re-run it if so.

alter table public.person_reference_centroids
  add column if not exists centroid_bits bit(512)
  generated always as (binary_quantize(centroid)::bit(512)) stored;

create or replace function public.match_person_cluster(p_person_id uuid, p_limit integer default 3)
 returns table(matched_person_id uuid, name_key text, name text, face_count integer, similarity real)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with cluster_centroid as (
    select avg(f.embedding)::vector(512) as c
    from faces f
    where f.person_id = p_person_id and f.embedding is not null
    having count(f.id) >= 1
  ),
  shortlist as (
    -- The owner filter stays INSIDE the shortlist (050's trap): take 200
    -- globally and then filter, and another account's faces eat the slots.
    select r.person_id
    from person_reference_centroids r
    where r.user_id = (
      select e.user_id from persons p join events e on e.id = p.event_id
      where p.id = p_person_id
    )
    -- A scalar subquery, not a join: the distance is then computed against
    -- one value, once.
    order by r.centroid_bits <~> (select binary_quantize(cc.c)::bit(512) from cluster_centroid cc)
    limit greatest(p_limit * 50, 200)
  )
  select r.person_id, r.name_key, r.name, r.face_count,
         (1 - (r.centroid <=> cc.c))::real as similarity
  from shortlist s
  join person_reference_centroids r on r.person_id = s.person_id,
  cluster_centroid cc
  order by r.centroid <=> cc.c
  limit p_limit;
$function$;

-- Built during the 2026-11-05 investigation; the HNSW lost the true best match
-- (see above), so it goes.
drop index if exists public.idx_person_ref_centroids_binary;

-- Grants: CREATE OR REPLACE keeps the existing ones (service_role only since
-- migration 097). Nothing to change.
