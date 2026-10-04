-- 089: index on images.ai_indexed_at, so "how much was indexed lately" and
-- "when did indexing last succeed" are index reads instead of archive scans.
--
-- Apply by hand, ALONE, via `scripts/db-sql.ts --query` (same reason as 087):
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, and the runner
-- sends a --file as one transaction.
--
-- Why (lesson 175, 2026-10-04): the AI lane's throughput fell from ~90,000
-- photos a day to ~10,000 over nine days and nothing measured it, because the
-- only way to ask was a scan of the whole images heap. The hourly capacity
-- check (migration 090, src/lib/monitoring/capacity.ts) reads both numbers from this
-- index. Partial on purpose: unindexed rows are already covered by
-- idx_images_unindexed, and leaving them out keeps a bulk import from paying
-- for an index entry it does not need yet.

create index concurrently if not exists idx_images_ai_indexed_at
  on public.images (ai_indexed_at)
  where ai_indexed_at is not null;
