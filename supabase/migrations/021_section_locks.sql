-- 021_section_locks.sql
--
-- Per-section lock toggle: a soft guard against inadvertent edits to curated
-- sections (most importantly the TDP Website gallery, where drag order IS the
-- live site). Locked sections reject membership changes (add/remove/move),
-- reordering, section deletion, uploads targeting them, and hard-deletes of
-- their member images — enforced server-side in the mutation routes with
-- clear errors, and surfaced in the editor UI. Not a security feature: anyone
-- can unlock with one click; the point is that editing becomes deliberate.

ALTER TABLE sections ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
