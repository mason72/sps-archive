-- 095: the delivery recap snapshot (2026-10-09).
--
-- SimplePhotoShare deletes an event about three months after it completes, and
-- the numbers a client is shown about their event (guests checked in, galleries
-- sent and opened, seconds from a guest's last frame to their inbox) are read
-- for years: in the share email, on the recap page, in next year's re-pitch.
-- So the archive keeps the only durable copy, taken when the pull finishes and
-- refreshed on demand while SPS still has the event.
--
-- Aggregates only. No guest name, email or phone is ever stored here; the
-- guest list is its own gated payload. Shape: src/lib/recap/types.ts, read
-- through normalizeRecap() and nothing else.

alter table events
  add column if not exists recap jsonb,
  add column if not exists recap_fetched_at timestamptz;

comment on column events.recap is
  'SPS delivery recap snapshot (src/lib/recap/types.ts). Aggregates only, read via normalizeRecap().';
comment on column events.recap_fetched_at is
  'When the archive last fetched events.recap from SPS.';
