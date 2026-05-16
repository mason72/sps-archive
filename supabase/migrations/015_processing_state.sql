-- Migration 015: Processing state machine + error surface
--
-- Pre-Phase-1 behavior: /api/upload/complete flipped images straight to
-- `complete` before thumbnails or AI ran, then Inngest set them back to
-- `processing`, then back to `complete`. From the user's POV the "5 photos
-- processed!" toast fired while the grid was still blank for ~30s and any
-- thumbnail/AI failure was silently swallowed.
--
-- This migration adds the column that lets us surface that failure.
--
--   complete  = thumbnails ready (and AI done if applicable). Safe to render.
--   processing = uploaded + EXIF in, thumbnails / AI still working.
--   pending   = row exists but R2 PUT may not have happened.
--   failed    = at least one step errored; see `last_error` for detail.
--
-- last_error is a short human-readable message (max 500 chars), populated by
-- whichever step failed last. Cleared when retry-processing flips status
-- back to pending.

alter table images
  add column if not exists last_error text;

-- Single-pass count for processing-status UI (replaces 4 round-trips).
create or replace function event_image_status_counts(p_event_id uuid)
returns table (
  total       bigint,
  pending     bigint,
  processing  bigint,
  complete    bigint,
  failed      bigint
)
language sql
stable
security invoker
as $$
  select
    count(*) as total,
    count(*) filter (where processing_status = 'pending')    as pending,
    count(*) filter (where processing_status = 'processing') as processing,
    count(*) filter (where processing_status = 'complete')   as complete,
    count(*) filter (where processing_status = 'failed')     as failed
  from images
  where event_id = p_event_id;
$$;

grant execute on function event_image_status_counts(uuid) to authenticated, service_role;
