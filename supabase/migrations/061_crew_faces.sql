-- Crew faces (2026-08-15). Mason: "We often have setup photos with crew faces
-- (almost never named properly lol). It will be especially helpful to remember
-- who random one-time hires were."
--
-- Two tables, and two deliberate absences:
--
-- NOT a column on crew: recognition needs a reference SET (ArcFace across
-- years, beards and haircuts wants several embeddings; one photo is a bad day
-- away from never matching again). `is_avatar` marks the one a human looks at.
--
-- NOT a name written into persons.name: `persons` is the GUEST identity space
-- (People index, wall of fame, guest selfie search all read it). Naming a crew
-- member into a client's gallery clusters puts staff into the same namespace
-- as the client's guests — one future feature away from a share. crew_persons
-- keeps the association internal and reversible.

-- One reference face for one crew member.
create table if not exists crew_faces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  crew_id uuid not null references crew(id) on delete cascade,

  -- SNAPSHOT of the embedding, not a pointer to faces.embedding: the archive
  -- photo a reference came from can be deleted (setup frames usually are), and
  -- the recognition must survive that. 512-dim ArcFace, same space as faces.
  embedding vector(512),

  -- Where it came from. Archive-tagged references carry image_id/face_id (the
  -- crop renders from the image's own thumbnail + bbox); uploads carry a
  -- storage_key in R2 instead. Either way bbox is the normalized face box.
  image_id uuid references images(id) on delete set null,
  face_id uuid references faces(id) on delete set null,
  storage_key text,
  bbox jsonb,

  is_avatar boolean not null default false,
  -- upload | tagged | confirmed-suggestion — how this reference entered.
  source text not null default 'upload',
  created_at timestamptz not null default now()
);

create index if not exists crew_faces_by_crew on crew_faces (user_id, crew_id);

-- Exactly one avatar per person, enforced where it cannot be forgotten.
create unique index if not exists crew_faces_one_avatar
  on crew_faces (crew_id) where is_avatar;

-- "This cluster, in this event, is this crew member." Written only by a human
-- confirming a match — AI suggests, humans apply.
create table if not exists crew_persons (
  crew_id uuid not null references crew(id) on delete cascade,
  person_id uuid not null references persons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_by text not null default 'human',
  created_at timestamptz not null default now(),
  primary key (crew_id, person_id)
);

create index if not exists crew_persons_by_person on crew_persons (person_id);

-- Service-role only, same posture as sps_connections: RLS on, no policies.
-- Every access path goes through routes that gate on Event Intel and scope by
-- user_id explicitly.
alter table crew_faces enable row level security;
alter table crew_persons enable row level security;
