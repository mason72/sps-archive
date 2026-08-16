-- 065: the naming engine's storage — reference centroids and suggestions.
--
-- The archive holds ~3,200 ANONYMOUS face clusters (80% of group-shot faces)
-- because clusters are only auto-named by filename consensus, and the
-- group-heavy galleries name nobody. But ~1,440 identities are already named
-- from headshot days. The engine matches anonymous clusters against those
-- known faces and SUGGESTS — a human confirms, always (two John Smiths are
-- one filename identity, and similarity is evidence, not identity).
--
-- Vector math lives in SQL (pgvector, where the embeddings already are);
-- orchestration and skip-rules live in TypeScript where they are testable.
-- AI writes ONLY these tables — persons.name is written exclusively by the
-- human's confirm through the API route (the standing AI invariant).

-- One row per named guest cluster: the centroid of its member faces.
-- Rebuilt by refresh_person_reference_centroids before a scan; a confirmed
-- suggestion names a cluster, so the next refresh absorbs it as reference
-- material automatically — teach-on-confirm by construction.
create table if not exists person_reference_centroids (
  person_id   uuid primary key references persons(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- normalizeNameKey's SQL twin: lower + strip non-letters. Must stay in
  -- lockstep with src/lib/people/index-people.ts.
  name_key    text not null,
  name        text not null,
  face_count  int  not null,
  centroid    vector(512) not null,
  updated_at  timestamptz not null default now()
);

create index if not exists person_reference_centroids_user
  on person_reference_centroids (user_id);

alter table person_reference_centroids enable row level security;
drop policy if exists "Service role manages reference centroids" on person_reference_centroids;
create policy "Service role manages reference centroids" on person_reference_centroids
  for all using (auth.role() = 'service_role');

-- The queue. One suggestion per anonymous cluster (its best match above the
-- bar). status: pending → confirmed | rejected | superseded (a human named
-- the cluster some other way before deciding).
create table if not exists person_identity_suggestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  person_id       uuid not null references persons(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  suggested_key   text not null,
  suggested_name  text not null,
  -- The reference cluster that matched best — its representative face fronts
  -- the "is this them?" card. Nullable: references can merge away.
  matched_person_id uuid references persons(id) on delete set null,
  confidence      real not null,
  -- Cluster size at scan time: the queue sorts by payoff.
  photo_count     int not null default 0,
  status          text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'superseded')),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  unique (person_id)
);

create index if not exists person_identity_suggestions_queue
  on person_identity_suggestions (user_id, status, photo_count desc);

alter table person_identity_suggestions enable row level security;
drop policy if exists "Service role manages identity suggestions" on person_identity_suggestions;
create policy "Service role manages identity suggestions" on person_identity_suggestions
  for all using (auth.role() = 'service_role');
drop policy if exists "Users read own identity suggestions" on person_identity_suggestions;
create policy "Users read own identity suggestions" on person_identity_suggestions
  for select using (user_id = auth.uid());

-- Rebuild the reference library for one user: every NAMED cluster except
-- excluded identities. Centroids of normalized embeddings; clusters need 2+
-- embedded faces so a single blurry face can't become someone's reference.
create or replace function refresh_person_reference_centroids(p_user_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  with refreshed as (
    delete from person_reference_centroids where user_id = p_user_id
  ),
  named as (
    select p.id as person_id, p.name,
           regexp_replace(lower(p.name), '[^a-z]', '', 'g') as name_key
    from persons p
    join events e on e.id = p.event_id
    where e.user_id = p_user_id
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

-- Best reference matches for one anonymous cluster, by cosine similarity of
-- centroids. The caller (TypeScript) applies the confidence bar, the skip
-- rules, and rejected_names — SQL only answers "who does this look like".
create or replace function match_person_cluster(p_person_id uuid, p_limit int default 3)
returns table (
  matched_person_id uuid,
  name_key text,
  name text,
  face_count int,
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
  )
  select r.person_id, r.name_key, r.name, r.face_count,
         (1 - (r.centroid <=> cc.c))::real as similarity
  from person_reference_centroids r, cluster_centroid cc
  where r.user_id = (
    select e.user_id from persons p join events e on e.id = p.event_id
    where p.id = p_person_id
  )
  order by r.centroid <=> cc.c
  limit p_limit;
$$;
