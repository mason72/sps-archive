-- 092: pg_catalog FIRST in the search_path of the two SECURITY DEFINER
-- capacity functions (090 had `public, pg_catalog`).
--
-- A SECURITY DEFINER function runs with its owner's rights, so every
-- unqualified name in it must resolve where the owner expects. With `public`
-- first, an object created in public named like a catalog relation
-- (pg_settings, pg_class, pg_stat_activity) would be read instead of the real
-- one. Nothing does that today; the order costs nothing to get right.
-- Bodies are unchanged, so this is ALTER, not a rewrite.

alter function capacity_snapshot() set search_path = pg_catalog, public;
alter function ai_backlog_snapshot() set search_path = pg_catalog, public;
