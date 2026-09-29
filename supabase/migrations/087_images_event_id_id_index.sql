-- 087: (event_id, id) index on images, for keyset paging inside one gallery.
--
-- Applied 2026-09-29 08:39 UTC, by hand, OUTSIDE scripts/db-sql.ts --file:
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction, and the runner
-- sends a file as one transaction with a 120 s statement budget. Sent alone via
-- `db-sql.ts --query`; built in 8 s, valid, 43 MB at ~900k photos. Recorded in
-- supabase_migrations.schema_migrations as (20260929083941, images_event_id_id_index).
--
-- Why (lesson 172): the /people index build reads every photo, one gallery at a
-- time, `where event_id = $1 and id > $last order by id limit 1000`. With only
-- `idx_images_event_id (event_id)`, every page fetched and SORTED the whole
-- gallery before returning 1,000 rows, so an 11,194-photo gallery re-read all of
-- itself on each of its 12 pages and hit the 15 s service_role statement timeout
-- under ingest load. With this index each page is an ordered index range scan
-- that stops at the LIMIT: slowest page 15.2 s -> 1.06 s, 0 failures over 1,298
-- pages (measured against production, 2026-09-29).
--
-- idx_images_event_id (event_id) is now redundant with this index's prefix. It
-- is left in place on purpose: dropping it is a separate, measured change.

create index concurrently if not exists idx_images_event_id_id
  on public.images (event_id, id);
