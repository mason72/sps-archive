-- 102: the Scout integration (2026-11-23).
--
-- Scout (the TDP crew app, its own Supabase project) posts "Postcards": crew
-- behind-the-scenes photos filed under a gig. Pixeltrunk is their archive:
-- the original lands in R2, the normal AI lane indexes it, and the crew in the
-- frame are matched against `crew_faces`. Routes: src/app/api/integrations/scout/,
-- logic: src/lib/scout-integration/, doc: docs/TECHNICAL.md "Scout integration".
--
-- Three objects:
--
--   1. scout_postcard_links: one row per Scout postcard. The primary key IS the
--      idempotency key: a retried POST finds the row and returns it, and two
--      concurrent POSTs for one postcard cannot both win (the loser deletes its
--      own image and returns the winner's). image_id cascades, so deleting the
--      photo anywhere in Pixeltrunk forgets the postcard, and a later POST from
--      Scout would archive it again.
--
--   2. A unique index on the gig marker in sections.job_meta, so two postcards
--      from one new gig arriving together cannot make two sections for it.
--      Partial (only rows that carry the marker), so no other section is
--      affected. sections is small; the build takes a brief lock, bounded below.
--
--   3. scout_image_crew_candidates(): for each face in ONE photo, the crews whose
--      best reference face is closest, by cosine similarity (pgvector `<=>` is
--      cosine distance). The same scoring as match_person_cluster_to_crew (069),
--      per face instead of per cluster, because a single new photo has no
--      cluster yet. It only reads; the decision (>= 0.70 and a 0.10 lead over
--      the runner-up) is made in code, `pickCrewMatches()`. Crew only: nothing
--      here reads persons or any guest identity.
--
-- Server-only, like every integration table: RLS on with no policies, the API
-- roles' grants revoked, and the function not callable by anon/authenticated.

set lock_timeout = '5s';

create table if not exists scout_postcard_links (
  postcard_id uuid primary key,
  image_id uuid not null references images(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  section_id uuid references sections(id) on delete set null,
  gig_id text not null,
  author_email text,
  created_at timestamptz not null default now(),
  published_target text,
  published_at timestamptz,
  constraint scout_postcard_links_target_chk check (
    published_target is null
    or published_target in ('bts/headshot-booth', 'bts/photo-booth', 'bts/anti-booth')
  )
);

create index if not exists scout_postcard_links_image_idx on scout_postcard_links (image_id);

-- The CLIENT BTS BONUS (2026-11-24): a crew-loved postcard is COPIED into the
-- client's own gallery (images.event_id is single-owner, and the guest gallery,
-- ZIP and downloads read an event's photos by event_id). The link remembers
-- exactly that copy, so a pull deletes it and nothing else. `set null`: a copy
-- a person deletes in Pixeltrunk simply stops being placed.
alter table scout_postcard_links
  add column if not exists client_event_id uuid references events(id) on delete set null,
  add column if not exists client_image_id uuid references images(id) on delete set null,
  add column if not exists client_section_id uuid references sections(id) on delete set null,
  add column if not exists client_placed_at timestamptz;
create index if not exists scout_postcard_links_client_image_idx on scout_postcard_links (client_image_id);

-- Marks that copy in the client's event: a crew behind-the-scenes photo the
-- client SEES and DOWNLOADS, but that no people/face, recap, sort, Highlights,
-- cover or AI reader may treat as one of their photos. Constant default, so
-- PG 11+ adds it without rewriting the table; the lock is brief and bounded
-- by lock_timeout above.
alter table images add column if not exists is_crew_bts boolean not null default false;
create index if not exists scout_postcard_links_gig_idx on scout_postcard_links (gig_id);

alter table scout_postcard_links enable row level security;
-- service_role is in the revoke too: its default grant is all eight rights, and
-- granting four by name on top leaves all eight (platform-gotchas.md).
revoke all on table scout_postcard_links from public, anon, authenticated, service_role;
grant select, insert, update, delete on table scout_postcard_links to service_role;

create unique index if not exists sections_scout_gig_uniq
  on sections (event_id, (job_meta ->> 'scout_gig_id'))
  where job_meta ? 'scout_gig_id';

create or replace function scout_image_crew_candidates(
  p_image_id uuid,
  p_user_id uuid,
  p_per_face int default 3
)
returns table (face_id uuid, crew_id uuid, similarity real)
language sql
stable
set search_path = public
as $$
  select r.face_id, r.crew_id, r.similarity
  from (
    select
      f.id as face_id,
      cf.crew_id,
      max(1 - (cf.embedding <=> f.embedding))::real as similarity,
      row_number() over (
        partition by f.id
        order by max(1 - (cf.embedding <=> f.embedding)) desc
      ) as rn
    from faces f
    join images i on i.id = f.image_id
    join events e on e.id = i.event_id
    join crew_faces cf on cf.user_id = p_user_id and cf.embedding is not null
    where f.image_id = p_image_id
      and f.embedding is not null
      and e.user_id = p_user_id
    group by f.id, cf.crew_id
  ) r
  where r.rn <= greatest(1, least(p_per_face, 10))
  order by r.face_id, r.similarity desc;
$$;

comment on function scout_image_crew_candidates(uuid, uuid, int) is
  'Scout integration: per face of one photo, the top crews by best reference-face cosine similarity. Read-only; the auto-confirm rule (>=0.70, 0.10 lead) lives in src/lib/scout-integration/crew-match.ts.';

revoke all on function scout_image_crew_candidates(uuid, uuid, int) from public, anon, authenticated;
grant execute on function scout_image_crew_candidates(uuid, uuid, int) to service_role;
