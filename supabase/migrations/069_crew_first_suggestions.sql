-- 069: the naming engine checks CREW first.
--
-- Mason, looking at Staff Photos (garbled filenames minting fake people):
-- "before we try to create a new face, shouldn't we look for Crew and ask
-- 'is this Christie?' before we ask if it's 'Marriott Green'?" Right — and
-- structurally necessary: crew rarely appear in filenames at all (Joey,
-- Justin and Jerrick have ZERO filename identities archive-wide), so crew
-- references are the ONLY way their clusters ever get recognized.
--
-- The invariant holds: crew names NEVER touch persons.name. A crew
-- suggestion resolves to a crew_persons LINK (confirmCrewPerson — which also
-- teaches), not a name.
alter table person_identity_suggestions
  add column if not exists kind text not null default 'guest'
    check (kind in ('guest', 'crew')),
  add column if not exists crew_id uuid references crew(id) on delete cascade;

-- Best crew match for one anonymous cluster: cluster centroid vs each crew's
-- reference-face snapshots, scored by the crew's BEST face (a reference set
-- spans years and haircuts; the closest one is the evidence).
create or replace function match_person_cluster_to_crew(p_person_id uuid, p_limit int default 3)
returns table (
  crew_id uuid,
  display_name text,
  similarity real
)
language sql
security definer
set search_path = public
as $$
  with cluster_centroid as (
    select avg(f.embedding)::vector(512) as c
    from faces f
    where f.person_id = p_person_id and f.embedding is not null
    having count(f.id) >= 1
  ),
  owner as (
    select e.user_id from persons p join events e on e.id = p.event_id
    where p.id = p_person_id
  )
  select cf.crew_id, c.display_name,
         max(1 - (cf.embedding <=> cc.c))::real as similarity
  from crew_faces cf
  join crew c on c.id = cf.crew_id
  cross join cluster_centroid cc
  where cf.user_id = (select user_id from owner)
    and cf.embedding is not null
  group by cf.crew_id, c.display_name
  order by max(1 - (cf.embedding <=> cc.c)) desc
  limit p_limit;
$$;
