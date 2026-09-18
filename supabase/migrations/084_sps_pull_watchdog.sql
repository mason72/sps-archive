-- The SPS pull watchdog's memory (2026-09-18).
--
-- Autodesk University 2026 stopped at 4,088 of 6,110 photos for 4h20m: the
-- continuation run sat in Inngest as "Running" with nothing executing it, and
-- because sps-pull allows one run per job, it also blocked every retry. No
-- error row, no alert — it was found by a person watching a number not move.
--
-- The watchdog (`spsPullWatchdog`, src/lib/inngest/sps-pull.ts) restarts a
-- stalled job at most WATCHDOG_MAX_RESTARTS times, then alerts once. These
-- columns are how it remembers what it already did. `watchdog_mark` is the
-- progress count at its last intervention: progress past the mark means the
-- restart worked, which resets the budget for any later stall.
--
-- All nullable or defaulted and written ONLY by the watchdog, so no existing
-- insert path needs to name them (the NOT NULL DEFAULT trap is for curated
-- columns; 0 restarts is the true value for every new job).

alter table sps_pull_jobs
  add column watchdog_restarts   integer not null default 0,
  add column watchdog_mark       integer,
  add column watchdog_at         timestamptz,
  add column watchdog_alerted_at timestamptz;
