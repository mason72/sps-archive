-- An SPS pull that finishes says what it left behind, and can go back for it.
--
-- Until now a pull with per-photo failures was marked `completed`, and
-- `startSpsPull` answers "already imported" for a completed job forever, so
-- the failed photos could never be fetched. Found 2026-10-04 on AAOMS 2026:
-- 7,104 of 7,109 landed, and the job's `failures` list named nine photos, four
-- of which were in the gallery (they failed AFTER their row was written, during
-- a run of statement timeouts). The list is an event log, not a record of what
-- is missing.
--
-- `missing` is that record. The run ends with a closing sweep: each photo the
-- job logged a failure for gets one more try, is then looked up in the event's
-- rows, and what is still absent is stored here. NULL = never swept (every job
-- before this migration); '[]' = swept, nothing left behind.
--
-- Two records, two jobs. The failure log NOMINATES (which photos is this
-- import responsible for), the rows DECIDE (is it actually missing). Neither
-- works alone: the log over-reports (the four AAOMS photos), and a bare
-- manifest-versus-rows comparison calls every deliberate removal a failed
-- import (eBay RCG MiniCon is 95 photos under its manifest because they were
-- moved to private galleries). A retry fetches this stored list and nothing
-- else.
--
-- `walked_at` marks the manifest walk as finished, so a retry (or a restart
-- during the closing sweep) does not walk again. `next_offset` cannot say it:
-- it stays on the last page.

alter table sps_pull_jobs
  add column if not exists walked_at timestamptz,
  add column if not exists missing jsonb
    constraint sps_pull_jobs_missing_is_array
      check (missing is null or jsonb_typeof(missing) = 'array');

-- The list page needs the COUNT for every job and must not ship every list.
alter table sps_pull_jobs
  add column if not exists missing_count integer
    generated always as (jsonb_array_length(missing)) stored;

comment on column sps_pull_jobs.missing is
  'Photos on the SPS manifest (minus deselected) with no row in the event when the run finished: [{spsImageId, filename, reason, gone?}]. NULL = never checked. Written by the lane''s closing sweep, and a retry fetches only this list.';
comment on column sps_pull_jobs.walked_at is
  'When the manifest walk reached its last page. Set = a re-queued job goes straight to the closing sweep.';

-- Every job that completed before this migration finished its walk.
update sps_pull_jobs
   set walked_at = coalesce(finished_at, updated_at)
 where status = 'completed'
   and walked_at is null;
