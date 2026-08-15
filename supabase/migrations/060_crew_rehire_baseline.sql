-- Crew: a person-level rehire baseline.
--
-- Ratings live on `event_crew` — one judgement per gig, which is the honest
-- grain and the thing the whole feature is for. But most of the roster has no
-- gig to attach one to: 89 crew against 40 event links, because the roster was
-- imported from a spreadsheet and the calendar backfill covers 23 of 45
-- galleries.
--
-- Mason, 2026-08-15: "for non regulars, we should also be able to add a rating.
-- This will let us go through and seed the current list." That is a standing
-- opinion about a person, not a judgement about a gig, and it needs somewhere
-- to live that is not a fabricated event link.
--
-- PRECEDENCE, enforced in `rehireStanding()` and nowhere else: a real per-gig
-- rating always wins. The baseline is what you know before the data exists, and
-- it steps aside the moment the data does. Same shape as every other guess in
-- this feature — it must not behave like a decision made from evidence.
--
-- Vocabulary matches event_crew.would_rebook: first_call | solid | last_resort
-- | never. Deliberately no CHECK constraint, matching that column — the API
-- (`cleanRehire`) is the one gate, and a CHECK here would make the next
-- vocabulary change a migration instead of an edit.
alter table crew add column if not exists rehire text;

comment on column crew.rehire is
  'Standing rehire opinion (first_call|solid|last_resort|never) for someone with no rated gigs yet. A real event_crew.would_rebook always outranks it — see rehireStanding().';
