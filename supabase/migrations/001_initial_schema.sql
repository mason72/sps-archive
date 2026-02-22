-- Enable pgvector extension for embedding storage
create extension if not exists vector;

-- ============================================================
-- EVENTS (a shoot, wedding, headshot session, etc.)
-- ============================================================
create table events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,
  description   text,
  event_date    date,
  event_type    text, -- 'wedding', 'headshot', 'corporate', 'portrait', etc.
  cover_image_id uuid, -- FK added after images table exists
  settings      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_events_slug on events(slug);
create index idx_events_event_date on events(event_date desc);

-- ============================================================
-- IMAGES (every uploaded photo)
-- ============================================================
create table images (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,

  -- File info
  filename        text not null,
  original_filename text not null,
  r2_key          text not null unique,
  file_size       bigint not null,
  width           int,
  height          int,
  mime_type       text not null,

  -- Parsed from filename (for headshot events)
  parsed_name     text, -- e.g. "Smith, John" extracted from "SmithJohn_001.jpg"

  -- EXIF metadata
  taken_at        timestamptz,
  camera_make     text,
  camera_model    text,
  lens            text,
  focal_length    real,
  aperture        real,
  shutter_speed   text,
  iso             int,
  gps_lat         double precision,
  gps_lng         double precision,

  -- AI-generated embeddings
  clip_embedding  vector(768),   -- CLIP ViT-L/14 for semantic search

  -- AI-generated metadata
  aesthetic_score real,           -- 0-1 quality score
  sharpness_score real,           -- 0-1 sharpness
  is_eyes_open    boolean,        -- face quality check
  scene_tags      text[],         -- AI-detected: ['ceremony', 'outdoor', 'group']

  -- Smart stack membership
  stack_id        uuid,           -- which stack this belongs to (null = standalone)
  stack_rank      int,            -- position within stack (1 = best/top)

  -- Processing status
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'complete', 'failed')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Core lookups
create index idx_images_event_id on images(event_id);
create index idx_images_r2_key on images(r2_key);
create index idx_images_filename on images(original_filename);
create index idx_images_parsed_name on images(parsed_name);
create index idx_images_stack_id on images(stack_id, stack_rank);
create index idx_images_processing on images(processing_status) where processing_status != 'complete';

-- Vector similarity search (HNSW index for fast approximate nearest neighbor)
create index idx_images_clip_embedding on images
  using hnsw (clip_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Scene tag search
create index idx_images_scene_tags on images using gin(scene_tags);

-- ============================================================
-- FACES (every detected face in every image)
-- ============================================================
create table faces (
  id              uuid primary key default gen_random_uuid(),
  image_id        uuid not null references images(id) on delete cascade,

  -- Bounding box (normalized 0-1 coordinates)
  bbox_x          real not null,
  bbox_y          real not null,
  bbox_w          real not null,
  bbox_h          real not null,

  -- Face embedding for clustering
  embedding       vector(512),    -- ArcFace embedding

  -- Cluster assignment
  person_id       uuid,           -- FK to persons table
  confidence      real,           -- clustering confidence 0-1

  created_at      timestamptz not null default now()
);

create index idx_faces_image_id on faces(image_id);
create index idx_faces_person_id on faces(person_id);

-- Face similarity search
create index idx_faces_embedding on faces
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ============================================================
-- PERSONS (clustered face identities)
-- ============================================================
create table persons (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  name            text,           -- photographer can label: "John Smith"
  representative_face_id uuid,    -- best face crop for this person
  face_count      int not null default 0,
  created_at      timestamptz not null default now()
);

create index idx_persons_event_id on persons(event_id);
create index idx_persons_name on persons(name);

-- Add FK from faces to persons
alter table faces add constraint fk_faces_person
  foreign key (person_id) references persons(id) on delete set null;

-- ============================================================
-- SMART STACKS (groups of similar/sequential images)
-- ============================================================
create table stacks (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  stack_type      text not null default 'face'
    check (stack_type in ('face', 'burst', 'similar')),
  cover_image_id  uuid,           -- the "best" image shown on top
  image_count     int not null default 0,
  person_id       uuid references persons(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index idx_stacks_event_id on stacks(event_id);
create index idx_stacks_person_id on stacks(person_id);

-- Add FK from images to stacks
alter table images add constraint fk_images_stack
  foreign key (stack_id) references stacks(id) on delete set null;

-- Add FK from events to cover image
alter table events add constraint fk_events_cover_image
  foreign key (cover_image_id) references images(id) on delete set null;

-- ============================================================
-- SECTIONS (auto-generated or manual gallery sections)
-- ============================================================
create table sections (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  name            text not null,
  description     text,
  sort_order      int not null default 0,
  is_auto         boolean not null default true,  -- AI-generated vs manual
  filter_query    text,           -- the semantic query that defines this section
  created_at      timestamptz not null default now()
);

create index idx_sections_event_id on sections(event_id, sort_order);

-- Images can belong to multiple sections (dynamic/overlapping)
create table section_images (
  section_id      uuid not null references sections(id) on delete cascade,
  image_id        uuid not null references images(id) on delete cascade,
  sort_order      int not null default 0,
  relevance_score real,           -- how well this image fits the section
  primary key (section_id, image_id)
);

create index idx_section_images_image on section_images(image_id);

-- ============================================================
-- SHARES (client-facing gallery links)
-- ============================================================
create table shares (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,

  -- Access control
  slug            text unique not null,
  password_hash   text,           -- null = no password required
  pin             text,           -- simple 4-6 digit PIN alternative
  expires_at      timestamptz,
  is_active       boolean not null default true,

  -- What's shared
  share_type      text not null default 'full'
    check (share_type in ('full', 'section', 'selection', 'person')),
  section_id      uuid references sections(id) on delete cascade,
  person_id       uuid references persons(id) on delete cascade,

  -- Permissions
  allow_download  boolean not null default true,
  allow_favorites boolean not null default true,
  download_quality text not null default 'original'
    check (download_quality in ('original', 'high', 'web')),

  -- Branding
  custom_message  text,

  -- Analytics
  view_count      int not null default 0,
  last_viewed_at  timestamptz,

  created_at      timestamptz not null default now()
);

create index idx_shares_slug on shares(slug);
create index idx_shares_event_id on shares(event_id);

-- ============================================================
-- CLIENT FAVORITES (from shared galleries)
-- ============================================================
create table favorites (
  id              uuid primary key default gen_random_uuid(),
  share_id        uuid not null references shares(id) on delete cascade,
  image_id        uuid not null references images(id) on delete cascade,
  client_name     text,
  client_email    text,
  created_at      timestamptz not null default now(),
  unique (share_id, image_id, client_email)
);

create index idx_favorites_share on favorites(share_id);
create index idx_favorites_image on favorites(image_id);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Semantic search: find images similar to a text query embedding
create or replace function search_images_by_embedding(
  query_embedding vector(768),
  target_event_id uuid default null,
  match_threshold real default 0.2,
  match_count int default 50
)
returns table (
  id uuid,
  event_id uuid,
  filename text,
  original_filename text,
  r2_key text,
  similarity real
)
language sql stable
as $$
  select
    i.id,
    i.event_id,
    i.filename,
    i.original_filename,
    i.r2_key,
    1 - (i.clip_embedding <=> query_embedding) as similarity
  from images i
  where i.clip_embedding is not null
    and i.processing_status = 'complete'
    and (target_event_id is null or i.event_id = target_event_id)
    and 1 - (i.clip_embedding <=> query_embedding) > match_threshold
  order by i.clip_embedding <=> query_embedding
  limit match_count;
$$;

-- Face search: find faces similar to a given face embedding
create or replace function search_faces_by_embedding(
  query_embedding vector(512),
  target_event_id uuid default null,
  match_threshold real default 0.6,
  match_count int default 50
)
returns table (
  face_id uuid,
  image_id uuid,
  person_id uuid,
  similarity real
)
language sql stable
as $$
  select
    f.id as face_id,
    f.image_id,
    f.person_id,
    1 - (f.embedding <=> query_embedding) as similarity
  from faces f
  join images i on i.id = f.image_id
  where f.embedding is not null
    and i.processing_status = 'complete'
    and (target_event_id is null or i.event_id = target_event_id)
    and 1 - (f.embedding <=> query_embedding) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

-- Update updated_at on row changes
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger events_updated_at before update on events
  for each row execute function update_updated_at();

create trigger images_updated_at before update on images
  for each row execute function update_updated_at();
