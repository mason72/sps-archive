-- Favorites digest: when a client's favoriting goes quiet for 2h, email the
-- photographer a summary. digested_at high-watermarks what's been reported —
-- favorites newer than it are "new"; a later session digests again with just
-- the new picks.
alter table shares add column if not exists digested_at timestamptz;
