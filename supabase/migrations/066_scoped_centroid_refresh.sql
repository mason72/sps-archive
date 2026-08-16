-- 066: the centroid refresh gets an event scope.
--
-- The full-archive rebuild aggregates ~57k 512-d vectors grouped by ~1,600
-- clusters and cannot fit PostgREST's 8s statement budget (measured: 57014
-- statement timeout on the first live call). But nothing routine NEEDS the
-- full rebuild: named clusters only change per event — clustering runs per
-- event, and a confirmed suggestion names one cluster in one event. So the
-- routine path refreshes ONE event's rows (small, fast), and the full rebuild
-- is reserved for the backfill script, which runs through the Management API
-- with its own 120s timeout.
-- The 065 one-arg version must go first: with the new default parameter the
-- two overloads make every call ambiguous (42725, hit live).
drop function if exists refresh_person_reference_centroids(uuid);

create or replace function refresh_person_reference_centroids(
  p_user_id uuid,
  p_event_id uuid default null
)
returns int
language sql
security definer
set search_path = public
as $$
  with removed as (
    delete from person_reference_centroids c
    where c.user_id = p_user_id
      and (p_event_id is null or c.person_id in (
        select id from persons where event_id = p_event_id
      ))
  ),
  named as (
    select p.id as person_id, p.name,
           regexp_replace(lower(p.name), '[^a-z]', '', 'g') as name_key
    from persons p
    join events e on e.id = p.event_id
    where e.user_id = p_user_id
      and (p_event_id is null or p.event_id = p_event_id)
      and p.name is not null
      and regexp_replace(lower(p.name), '[^a-z]', '', 'g') not in (
        select person_key from excluded_people where user_id = p_user_id
      )
  ),
  inserted as (
    insert into person_reference_centroids
      (person_id, user_id, name_key, name, face_count, centroid, updated_at)
    select n.person_id, p_user_id, n.name_key, n.name,
           count(f.id)::int, avg(f.embedding)::vector(512), now()
    from named n
    join faces f on f.person_id = n.person_id and f.embedding is not null
    group by n.person_id, n.name_key, n.name
    having count(f.id) >= 2
    returning 1
  )
  select count(*)::int from inserted;
$$;
