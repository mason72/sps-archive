-- Usage metering (Phase 1 of tasks/todo.md "Alpha access + ops.pixeltrunk.com").
--
-- usage_events is an append-only FLOW ledger: one row per metered operation
-- (Modal wall-time, zip builds, email sends), attributed to the owning user.
-- Storage is a STOCK and is computed live from images/zip_jobs via
-- get_user_storage() below — never from this table, so deletes are honest.

create table usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_id   uuid references events(id) on delete set null,
  kind       text not null,    -- ai_index | ai_embed_text | ai_embed_selfie |
                               -- video_process | zip_build | cover_raster | email_send
  quantity   numeric not null, -- measured in `unit`s (Modal lanes: wall-clock seconds)
  unit       text not null,    -- seconds | bytes | images | emails
  metadata   jsonb,
  created_at timestamptz not null default now()
);

create index idx_usage_events_user_time on usage_events(user_id, created_at desc);
create index idx_usage_events_kind_time on usage_events(kind, created_at desc);

-- Service-role only (RLS on, no policies) — written by recordUsage(), read by /ops.
alter table usage_events enable row level security;

-- Real thumbnail bytes (3 variants summed), written at generation time.
-- NULL = generated before metering existed, or written by the Modal video
-- pipeline (poster sizes unknown here) — the storage rollup estimates those.
alter table images add column thumb_bytes bigint;

-- Alpha triage: whose action broke it. Nullable — system-level errors have no owner.
alter table system_errors
  add column user_id uuid references auth.users(id) on delete set null,
  add column event_id uuid references events(id) on delete set null;

-- Per-user storage stock, one authoritative home. unmeasured_original_bytes is
-- the file_size sum of images with NULL thumb_bytes — the TS rollup multiplies
-- it by an estimated thumb ratio so the total doesn't silently undercount.
create function get_user_storage(p_user_id uuid)
returns table(
  original_bytes bigint,
  thumb_bytes bigint,
  unmeasured_original_bytes bigint,
  zip_bytes bigint
)
language sql stable as $$
  select
    coalesce(sum(i.file_size), 0)::bigint,
    coalesce(sum(i.thumb_bytes), 0)::bigint,
    -- Images only: video posters are small and Modal-written (thumb_bytes
    -- stays NULL forever) — estimating them at a ratio of a multi-GB original
    -- would invent phantom storage.
    coalesce(sum(i.file_size) filter (where i.thumb_bytes is null and i.media_type = 'image'), 0)::bigint,
    (select coalesce(sum(z.size_bytes), 0)::bigint
       from zip_jobs z
       join shares s on s.id = z.share_id
       join events e2 on e2.id = s.event_id
      where e2.user_id = p_user_id
        and z.r2_key is not null
        and (z.expires_at is null or z.expires_at > now()))
  from images i
  join events e on e.id = i.event_id
  where e.user_id = p_user_id;
$$;

-- House convention (033): internal functions are not PostgREST-callable.
revoke execute on function get_user_storage(uuid) from public, anon, authenticated;
