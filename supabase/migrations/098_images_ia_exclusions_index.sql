-- 098: partial index for the R2 Infrequent Access exclusion list, so
-- loadIaExclusions() (src/lib/r2/tiering-run.ts) reads ~1,800 rows instead of
-- walking the whole images table.
--
-- Apply by hand, ALONE, via `scripts/db-sql.ts --query` (same reason as 087 and
-- 089): CREATE INDEX CONCURRENTLY cannot run inside a transaction, and the
-- runner sends a --file as one transaction.
--
-- Why (2026-11-05): the nightly r2-infrequent-access job died at 02:49 PT with
-- "loadIaExclusions: canceling statement due to statement timeout". The list
-- (website-published photos + cover uploads) had no index, so every page was a
-- walk of images in id order filtering out everything else: measured before
-- this index, page one took 4,068 ms and touched ~940k buffers on a 1.63M-row
-- table (it was ~0.75 s on 2026-10-20). The job reloads the list once per
-- slice, so under a heavy AI-indexing night (10,640 photos landed 21:00-00:00)
-- it was the first query to hit the timeout, and four tries in a row lost.
--
-- The predicate matches the PostgREST filter
-- `.or("site_published_at.not.is.null,is_cover_upload.eq.true")` exactly, so
-- the planner can prove the query implies it. Keyed on id because the reader
-- keyset-pages `order by id`; r2_key is INCLUDEd so the read can be index-only.
-- Partial: ~1,800 of 1.63M rows, so a bulk import pays nothing for it.

create index concurrently if not exists idx_images_ia_exclusions
  on public.images (id) include (r2_key)
  where site_published_at is not null or is_cover_upload = true;
