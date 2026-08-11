-- Photo sort was ONE event-wide setting (events.settings.grid.sortBy) written
-- by a control that sits inside a section — so choosing "Filename" for an
-- alphabetical section silently re-sorted every other section too
-- (Justin, 2026-08-10). Sort is a per-section property; this is its home.
--
-- NULL sort_mode = inherit the event default, which is what every existing
-- section does today, so this migration changes no visible order.
alter table sections
  add column sort_mode text
    check (sort_mode in ('upload','filename','date-taken','manual','random')),
  -- Seed for sort_mode='random'. A stored seed makes the shuffle STABLE:
  -- the same order across reloads and identical for every client, until the
  -- photographer reshuffles (same contract as the mosaic cover seed).
  add column sort_seed integer;
