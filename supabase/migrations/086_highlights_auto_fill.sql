-- Highlights auto-fill (2026-09-24, Mason: "I don't want to have to run a
-- Claude session every time I add a highlights section").
--
-- "Sort into sections" can now ask for a Highlights section of N picks. The
-- picks usually cannot be chosen yet (AI indexing runs after the upload), so
-- the request is stored on the section and a job fills it once indexing
-- settles.
--
--   highlights_auto_count     the requested N. NOT NULL = the MACHINE owns this
--                             section's membership. A human Accept in the
--                             review clears it back to NULL.
--   highlights_auto_filled_at when the machine filled it. NULL with a count set
--                             = still waiting for indexing.
--
-- The count doubles as the training exclusion: the generator learns a
-- photographer's taste from their Highlights sections, and a machine-filled
-- one would teach it its own output. direction.ts skips any section with a
-- count set.
alter table public.sections
  add column if not exists highlights_auto_count smallint
    check (highlights_auto_count is null or highlights_auto_count between 1 and 500),
  add column if not exists highlights_auto_filled_at timestamptz;

-- The sweep's safety net reads "waiting" sections; keep that read tiny.
create index if not exists sections_highlights_pending_idx
  on public.sections (event_id)
  where highlights_auto_count is not null and highlights_auto_filled_at is null;
