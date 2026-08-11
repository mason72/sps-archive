-- Pulling finished events out of SimplePhotoShare and into the archive.
-- Contract: tasks/sps-archive-pull-spec.md. Pixeltrunk pulls; SPS never pushes.
--
-- Three facts need homes here: the credential, the provenance of a pulled
-- photo, and the progress of an import that moves tens of gigabytes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The credential
--
-- Per USER, not an env var: SPS mints per user_id (its archive_connections is
-- keyed that way), so one env var would pin this whole install to Mason's SPS
-- account and quietly break the second photographer who connects.
--
-- Note the asymmetry that decides how this is held. SPS only ever *verifies*
-- the token, so it stores a sha256. Pixeltrunk must *present* it on every
-- request, so it has to keep the plaintext. That makes this a stored
-- credential: RLS on with NO policies (service-role only, so a leaked anon key
-- reads nothing), never returned to the browser, and only ever read by
-- getSpsToken() in src/lib/sps-integration/connection.ts.
--
-- Disconnecting DELETES the row rather than tombstoning it. SPS tombstones to
-- keep last_pull_at as evidence of what a revoked key reached; here the row IS
-- a live credential, so retaining one we've stopped using is strictly worse
-- than losing the timestamp.
create table sps_connections (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  token        text not null,
  -- Shown in the UI so the photographer can tell which key is installed —
  -- the same masked prefix SPS's own settings panel displays.
  token_prefix text not null,
  connected_at timestamptz not null default now(),
  -- Advanced by a successful pull, so "connected but never used" is visible.
  last_pull_at timestamptz
);

alter table sps_connections enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Provenance, on the photo
--
-- This lives on `images` rather than on the import job because it must outlive
-- the import: it is what makes a lossy frame findable months later, and it is
-- the idempotency key for a resumed or repeated pull.
alter table images
  -- The SPS images.id this frame came from. Never a filename — SPS and
  -- Pixeltrunk rename independently.
  add column sps_image_id uuid,
  -- Exactly what SPS reported at pull time. NEVER inferred: SPS's IMAGE_SIZES
  -- still reads quality:95 because that encoder runs for the cases its
  -- passthrough branch excludes, so reading the config gives the wrong answer.
  -- 'archive' = verbatim camera file. 'lossy' = the q95 re-encode.
  add column sps_quality text check (sps_quality in ('archive', 'lossy')),
  -- When SPS was told the bytes are durable here, which is what makes its own
  -- copy eligible for deletion. NULL means the confirmation still owes SPS a
  -- call — harmless (it holds an unclaimed copy 30 days) and retryable.
  add column sps_pulled_at timestamptz;

-- The idempotency guard, enforced by the database rather than by the importer's
-- good intentions: a resumed job, a double-click, or a re-run cannot land the
-- same SPS frame twice in one event.
create unique index images_sps_image_per_event
  on images(event_id, sps_image_id)
  where sps_image_id is not null;

-- "Which frames in this event came in degraded?" — the question the quality
-- column exists to answer.
create index idx_images_sps_quality
  on images(event_id, sps_quality)
  where sps_quality is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Import progress
--
-- An import walks the SPS manifest a page at a time, so `next_offset` is both
-- the progress indicator and the resume point — a crashed or continued job
-- picks up exactly where it stopped, with fresh (1h) signed URLs.
--
-- `expected_total` is counted from the manifest at kickoff, never from SPS's
-- event.image_count, which includes the AI copies the manifest excludes.
create table sps_pull_jobs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  event_id       uuid not null references events(id) on delete cascade,
  sps_event_id   uuid not null,
  -- Display only, for the progress panel. The id is the only key.
  sps_event_name text,
  status         text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  -- Manifest offset to resume from.
  next_offset    integer not null default 0,
  expected_total integer,
  images_done    integer not null default 0,
  images_failed  integer not null default 0,
  -- Frames already present in the event (a re-run over a partial import).
  images_skipped integer not null default 0,
  bytes_copied   bigint  not null default 0,
  -- Frames SPS has been told are durable here.
  confirmed      integer not null default 0,
  -- The SPS image ids the photographer deselected in review. Stored as the
  -- EXCLUSION set, not the selection: everything is selected by default, so
  -- this is normally empty or tiny, and the import never depends on how far
  -- the review grid was scrolled.
  deselected     uuid[] not null default '{}',
  -- Per-image failures, capped by the writer. Enough to tell the photographer
  -- what to retry without turning a row into a log file.
  failures       jsonb  not null default '[]',
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index idx_sps_pull_jobs_user on sps_pull_jobs(user_id, created_at desc);
create index idx_sps_pull_jobs_event on sps_pull_jobs(event_id);

-- Service-role only, same as every other job table here: the API routes read
-- and write it through getAuthUser()'s service client with an explicit
-- ownership filter on user_id.
alter table sps_pull_jobs enable row level security;
