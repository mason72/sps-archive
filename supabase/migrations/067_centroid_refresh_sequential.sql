-- 067: the centroid refresh becomes plpgsql — the CTE version could never
-- refresh an existing row.
--
-- In a single statement, data-modifying CTEs all run against the SAME
-- snapshot: the INSERT cannot see the DELETE's effect, so re-refreshing any
-- cluster already in the table hit the primary key (23505, live on the first
-- scoped refresh — the initial full seed only worked because the table was
-- empty). plpgsql runs the delete and insert as sequential statements, which
-- is the semantics the function always claimed to have.
create or replace function refresh_person_reference_centroids(
  p_user_id uuid,
  p_event_id uuid default null
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
