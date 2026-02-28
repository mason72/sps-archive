-- Add thumbnail tracking column
-- When true, thumbnails exist in R2 at events/{eventId}/thumbnails/{variant}/{filename}.jpg
-- Until this migration runs, the grid falls back to original images via onError
ALTER TABLE images ADD COLUMN IF NOT EXISTS thumbnail_generated boolean DEFAULT false;

-- Index for filtering images that need thumbnail generation
CREATE INDEX IF NOT EXISTS idx_images_thumbnail_generated ON images (thumbnail_generated) WHERE thumbnail_generated = false;
