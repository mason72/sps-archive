-- Migration 017: Photographer-private star
--
-- Pre-Phase-3, the only "favorite" concept was the public client
-- favorite (favorites table, populated through the gallery viewer).
-- Pressing F in the photographer's gallery would auto-create a public
-- share and add to that table — terrifying for organizational use:
-- the photographer's culling marks would leak as if a client had
-- picked them.
--
-- This column is the photographer's private "best of" mark. Lives on
-- the image row so it's per-event and follows the image around;
-- visible only to the owner (already enforced by RLS on images);
-- never exposed to share viewers.

alter table images
  add column if not exists starred boolean not null default false;

-- Partial index for the common filter "show me only starred photos in
-- this event" — typical events have <10% stars so a partial index is
-- much smaller than indexing the column unconditionally.
create index if not exists idx_images_event_starred
  on images(event_id)
  where starred = true;
