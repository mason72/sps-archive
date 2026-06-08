-- 012_section_images_sort_backfill.sql
--
-- Manual (drag-to-reorder) sort needs section_images.sort_order to be a clean,
-- gapless, unique per-section sequence. Today it holds the AI clustering
-- pipeline's relevance buckets — ~50 distinct values (0–49) per section with
-- hundreds of images tied (747 duplicate (section_id, sort_order) groups). That
-- can't represent a hand-arranged order, so we backfill to row_number() seeded
-- from the existing order (preserving the current relevance ranking as the
-- starting arrangement) and add an index for section-ordered reads.

-- Backfill: gapless 0..n-1 per section, deterministic (image_id tiebreak).
UPDATE section_images si
SET sort_order = r.rn
FROM (
  SELECT
    section_id,
    image_id,
    row_number() OVER (
      PARTITION BY section_id
      ORDER BY sort_order, image_id
    ) - 1 AS rn
  FROM section_images
) r
WHERE si.section_id = r.section_id
  AND si.image_id = r.image_id;

-- Index for ordered reads (only image_id was indexed before). No UNIQUE
-- constraint on (section_id, sort_order): the reorder endpoint rewrites the full
-- list and a unique constraint would reject the transient duplicates that occur
-- mid-renumber.
CREATE INDEX IF NOT EXISTS idx_section_images_section_sort
  ON section_images (section_id, sort_order);
