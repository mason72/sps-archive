-- Pinned galleries: keep workspace galleries (e.g. TDP Work, TDP Website) at the
-- top of the dashboard instead of slipping down as new events are created.
-- NULL = not pinned; among pinned events the most recent pin sorts first.
alter table events add column if not exists pinned_at timestamptz;
