-- 094: the identity engine confirms its own sure matches (2026-10-04).
--
-- Mason's decision, made on the ledger this table IS: 869 confirmed against
-- 7 rejected, every rejection between 0.55 and 0.58, nothing above 0.58 ever
-- rejected. The engine now applies a match itself when it is sure
-- (AUTO_CONFIDENCE and the runner-up margin live in
-- src/lib/people/identity-suggestions.ts), and the human reviews a strip of
-- what it did instead of pressing Confirm 400 times.
--
-- The invariant "AI suggests, humans apply" bends here deliberately and only
-- here, with two guards: every auto decision is marked (decided_by) so it can
-- be found and undone in bulk, and it stays unreviewed (reviewed_at null)
-- until a person has looked at it or waved the strip through.

alter table person_identity_suggestions
  add column if not exists decided_by text
    check (decided_by in ('human', 'auto')),
  add column if not exists reviewed_at timestamptz;

-- Every decision before today was a person's.
update person_identity_suggestions
   set decided_by = 'human'
 where decided_at is not null and decided_by is null;

-- The review strip: this user's unreviewed auto decisions, newest first.
create index if not exists person_identity_suggestions_auto_review
  on person_identity_suggestions (user_id, decided_at desc)
  where decided_by = 'auto' and reviewed_at is null;
