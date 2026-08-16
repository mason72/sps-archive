-- 068: split-by-face groundwork — clean references, and a dismissal memory.
--
-- 1. The reference refresh gains an excluded-gallery list. The wall excludes
--    the marketing galleries (NON_PERSON_GALLERIES in index-people.ts) because
--    their filenames mint fake people — but the centroid refresh didn't, so
--    "Golden Gate YPO" (8 clusters) and "Linked In" became naming-engine
--    REFERENCE MATERIAL. The list stays single-homed in TypeScript; callers
--    pass it in. Default '{}' keeps the signature honest for ad-hoc SQL use.
--
-- 2. person_split_dismissals: the conflation detector flags a name whose
--    clusters' faces disagree (impostor-territory centroid similarity). When
--    Mason looks and says "same person" — a haircut, a decade, a bad crop —
--    that judgement must stick, or the card nags forever.
create table if not exists person_split_dismissals (
  user_id    uuid not null references auth.users(id) on delete cascade,
  name_key   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, name_key)
);

alter table person_split_dismissals enable row level security;
drop policy if exists "Service role manages split dismissals" on person_split_dismissals;
create policy "Service role manages split dismissals" on person_split_dismissals
  for all using (auth.role() = 'service_role');

drop function if exists refresh_person_reference_centroids(uuid, uuid);

create or replace function refresh_person_reference_centroids(
  p_user_id uuid,
  p_event_id uuid default null,
  p_excluded_event_names text[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
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
         regexp_replace(lower(p.name), '[^a-z]', '', 'g'),
         p.name, count(f.id)::int, avg(f.embedding)::vector(512), now()
  from persons p
  join events e on e.id = p.event_id
  join faces f on f.person_id = p.id and f.embedding is not null
  where e.user_id = p_user_id
    and (p_event_id is null or p.event_id = p_event_id)
    and not (e.name = any(p_excluded_event_names))
    and p.name is not null
    and regexp_replace(lower(p.name), '[^a-z]', '', 'g') not in (
      select person_key from excluded_people where user_id = p_user_id
    )
  group by p.id, p.name
  having count(f.id) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;
