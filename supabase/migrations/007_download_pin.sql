-- ============================================================
-- Add download PIN protection columns to shares
-- ============================================================

ALTER TABLE shares ADD COLUMN IF NOT EXISTS download_pin TEXT DEFAULT NULL;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS require_pin_bulk BOOLEAN DEFAULT false;
ALTER TABLE shares ADD COLUMN IF NOT EXISTS require_pin_individual BOOLEAN DEFAULT false;

COMMENT ON COLUMN shares.download_pin IS '4-digit PIN for download protection';
COMMENT ON COLUMN shares.require_pin_bulk IS 'Require PIN for Download All (ZIP)';
COMMENT ON COLUMN shares.require_pin_individual IS 'Require PIN for individual image download';
