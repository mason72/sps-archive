-- 075 — index the one FK to `persons` that had none.
--
-- Found 2026-09-01 while diagnosing the face-cluster timeouts. Every other FK
-- referencing persons has a leading index; person_identity_suggestions
-- .matched_person_id did not. Its constraint is ON DELETE NO ACTION, so every
-- `DELETE FROM persons` must prove no suggestion references the row — an
-- unindexed check means a full scan of that table, per deleted person, and the
-- clustering prune deletes persons ONE AT A TIME.
--
-- Not today's bug: the table holds 396 rows / 376 kB, so the scan is
-- microseconds and there were zero memberless persons to prune. It is a fuse
-- rather than a fire — suggestions accrue with every import, and the cost
-- lands on a code path that already runs in a loop. One line now beats a
-- repeat of today's investigation later.
CREATE INDEX IF NOT EXISTS idx_person_identity_suggestions_matched_person
  ON public.person_identity_suggestions (matched_person_id);
