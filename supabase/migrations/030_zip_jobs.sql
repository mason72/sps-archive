-- Background ZIP builds for large gallery downloads.
--
-- Streaming multi-GB ZIPs through a request lambda dies two ways: the 300s
-- wall (fixed with maxDuration) and OOM when the platform's response
-- transport buffers producer-vs-client speed differences in memory (observed
-- live 2026-07-02 on a 1553-photo gallery). Big downloads are now built by an
-- Inngest job that streams the archive into R2 (bounded memory) and hands the
-- guest a presigned link — resumable, no lambda in the download path.
--
-- scope_key is a content hash of the selected image ids, so a changed gallery
-- (or changed favorites set) naturally misses the cache and rebuilds.

create table zip_jobs (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references shares(id) on delete cascade,
  scope jsonb not null default '{}'::jsonb,
  scope_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'building', 'ready', 'error')),
  zip_filename text not null,
  r2_key text,
  size_bytes bigint,
  image_count int,
  error text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  expires_at timestamptz
);

create index idx_zip_jobs_share_scope
  on zip_jobs (share_id, scope_key, created_at desc);
create index idx_zip_jobs_expiry on zip_jobs (expires_at)
  where expires_at is not null;

-- Service-role only (route handlers / Inngest); no client access.
alter table zip_jobs enable row level security;
