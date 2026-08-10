-- ── increment_share_views stamps the time as well as the count ──
--
-- The original in 011 only bumped view_count, so last_viewed_at was NULL on
-- every row in the table while galleries accumulated hundreds of real views.
-- Two surfaces render it (the event sidebar's share list and the activity
-- panel), and both formatted NULL as "Never" — so a share sat there reading
-- "12 views · Never".
--
-- Historical NULLs are deliberately NOT backfilled. We know those views
-- happened; we do not know when, and now() would invent a timestamp that
-- looks authoritative. The UI reports "Unknown" for a share that has views
-- but no stamp, and starts telling the truth from its next view onward.
--
-- Signature is unchanged, so no type regeneration is needed.
--
-- `set search_path = public` is carried over deliberately: 033 hardened this
-- function against search_path injection with an ALTER, which lives on the
-- live definition and NOT in 011. A create-or-replace that omits it silently
-- reverts that security fix — the live definition is the thing to diff
-- against, never the original migration.

create or replace function increment_share_views(p_share_id uuid)
returns void
language sql
set search_path = public
as $$
  update shares
  set view_count     = coalesce(view_count, 0) + 1,
      last_viewed_at = now()
  where id = p_share_id;
$$;
