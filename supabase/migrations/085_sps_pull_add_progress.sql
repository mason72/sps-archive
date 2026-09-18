-- SPS pull progress is folded with ONE atomic increment.
--
-- `applySliceResult` used to read the job row, add in JavaScript, and write the
-- sum back. Its comment called that safe because "a job runs with one worker" —
-- true across Inngest runs, false inside a slice: `importSlice` runs six
-- downloads at once and flushes progress every five photos, so two flushes can
-- overlap. Both read the same row, and the second write erases the first.
-- Measured 2026-09-18: "Everpure GSO Onboarding Headshots" landed 1,090 rows
-- with 0 failed and 0 skipped, and the job reported 1,080 (two lost flushes of
-- five); Autodesk University 2026 lost one. No flush error was logged, and 5
-- photos landed inside 300 ms three times in that import.
--
-- An increment in the UPDATE itself has no window to lose: Postgres serialises
-- concurrent updates of one row on the row lock, and each re-reads the
-- committed value. `next_offset` is a SET, not an add, and only when given.

create or replace function sps_pull_add_progress(
  p_job_id uuid,
  p_done integer,
  p_failed integer,
  p_skipped integer,
  p_bytes bigint,
  p_confirmed integer,
  p_next_offset integer default null
)
returns boolean
language sql
volatile
set search_path = public
as $$
  update sps_pull_jobs
     set images_done    = images_done    + p_done,
         images_failed  = images_failed  + p_failed,
         images_skipped = images_skipped + p_skipped,
         bytes_copied   = bytes_copied   + p_bytes,
         confirmed      = confirmed      + p_confirmed,
         next_offset    = coalesce(p_next_offset, next_offset),
         updated_at     = now()
   where id = p_job_id
  returning true;
$$;

comment on function sps_pull_add_progress(uuid, integer, integer, integer, bigint, integer, integer) is
  'Atomically add a slice''s (or a progress flush''s) counters to an SPS pull job. Returns true, or NULL when the job row does not exist.';

revoke all on function sps_pull_add_progress(uuid, integer, integer, integer, bigint, integer, integer) from public, anon, authenticated;
grant execute on function sps_pull_add_progress(uuid, integer, integer, integer, bigint, integer, integer) to service_role;
