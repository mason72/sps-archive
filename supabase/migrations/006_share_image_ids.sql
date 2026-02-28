-- ============================================================
-- Add image_ids column to shares for 'selection' share type
-- Stores the array of image IDs when share_type = 'selection'
-- ============================================================

ALTER TABLE shares ADD COLUMN IF NOT EXISTS image_ids uuid[] DEFAULT NULL;

COMMENT ON COLUMN shares.image_ids IS 'Array of image IDs for selection-type shares';
