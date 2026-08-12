-- Drop the full-precision vector indexes. This is where the saving lands.
--
-- 050 changed both search functions to shortlist on a fingerprint index and
-- re-rank the shortlist against the real vectors. Re-ranking sorts at most a
-- few hundred rows, which needs no index at all — so these two are now dead
-- weight that still costs RAM, disk, and write time on every upload.
--
-- Verified before dropping: the only other caller of a vector column is
-- `score_images_by_embedding`, which has no ORDER BY and no LIMIT (it scores
-- every photo in one event) and therefore never used an index in the first
-- place. Nothing else in the codebase runs `<=>` — the app reaches vectors
-- exclusively through these RPCs.
--
--   idx_images_siglip_embedding   226 MB
--   idx_faces_embedding           103 MB
--   replaced by fingerprints at    13 MB and ~7 MB
--
-- Reversible: recreating either takes well under a minute at current size, and
-- the definitions are in 048 and this file's header. If search quality ever
-- looks wrong, restore the 050 function bodies from git and rebuild these two.

begin;

set local lock_timeout = '8s';

drop index if exists public.idx_images_siglip_embedding;
drop index if exists public.idx_faces_embedding;

commit;
