-- 013_site_scenes.sql
--
-- Public marketing lane for the Two Dudes Photo website.
--
-- The website pulls rotating, curated imagery the team manages inside Pixeltrunk
-- via GET /api/site/scene/[key]. An image only becomes publicly visible once it
-- is explicitly tagged into a named website "scene" (site_scene). Tagging also
-- copies that image's display + thumbnail variants into the PUBLIC R2 bucket
-- (sps-public); private client galleries keep using sps-prism with presigned,
-- expiring URLs and are never exposed by this feature.
--
-- Scene keys (validated in app code, src/lib/site/scenes.ts — not enforced here
-- so we can add scenes without a migration):
--   hero, featured-work, backgrounds,
--   service/headshot-booth, service/photo-booth, service/anti-booth,
--   service/event-photography, service/video, service/environmental-portraits

-- City is an event-level attribute (an event happens in one place). The site's
-- "Recent Work" reads it per curated image by joining through the event.
ALTER TABLE events ADD COLUMN IF NOT EXISTS city text;

-- Per-image curation fields for the website.
ALTER TABLE images ADD COLUMN IF NOT EXISTS site_scene text;
ALTER TABLE images ADD COLUMN IF NOT EXISTS service text;
ALTER TABLE images ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE images ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;
-- When the public variants were last copied into sps-public (NULL = not published).
ALTER TABLE images ADD COLUMN IF NOT EXISTS site_published_at timestamptz;

-- The site API filters by scene and orders by featured, then display_order.
-- Partial index keeps it tiny — only curated rows are indexed.
CREATE INDEX IF NOT EXISTS idx_images_site_scene
  ON images (site_scene, featured DESC, display_order)
  WHERE site_scene IS NOT NULL;
