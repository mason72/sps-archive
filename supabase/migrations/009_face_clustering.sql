-- Migration 009: Add face quality columns for clustering
-- Modal returns is_eyes_open and quality per-face, but they weren't being stored.
-- These are needed for selecting the best representative face per person cluster.

ALTER TABLE faces ADD COLUMN IF NOT EXISTS is_eyes_open boolean DEFAULT true;
ALTER TABLE faces ADD COLUMN IF NOT EXISTS quality real DEFAULT 0;
