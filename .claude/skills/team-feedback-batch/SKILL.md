---
name: team-feedback-batch
description: Collect and triage a batch of Pixeltrunk feedback from the team (Justin, Joey, Jerrick, Melinna), reproduce each item, group by root cause, fix behind the live-upload gate, and reply. Use when Mason says "from Justin:", "Joey says", "notes from the team", "I'm going to paste in sections, wait until I'm done", or "check on these items from Justin".
---

# Team feedback batch (Pixeltrunk)

Six explicit batches in Q3 2026; spsv2's `client-feedback` covers customers of SPS, this covers the
TDP team using Pixeltrunk, who report in bursts and expect fixes, not replies.

## Collect
- When he says he will paste in sections, acknowledge in one line and do nothing until "that's
  everything". Number the items as they arrive; keep his inline verdicts as constraints.
- Dedupe against open items in `tasks/todo.md` and recent lessons; say which are already known.

## Triage each item (findings before fixes)
1. **Reproduce** on production as that user ("work as" from /ops) or on the exact URL/gallery they named.
   A report that cannot be reproduced gets the question that would settle it, not a guess.
2. **Classify**: bug / as-designed (explain the workflow) / feature idea (opinion plus effort) / data
   (a bad name, a duplicate event, a mis-stacked face) that needs a data fix, not code.
3. **Group by root cause.** Three symptoms are often one bug; say so.
4. **Check the upload path.** Any fix that touches ingest, indexing or background jobs must not touch
   uploading; "MUST NOT fuck with uploading" was said five times. Load the change against an upload in
   flight on a scratch event before pushing.

## Fix and ship
One push for the batch. The live-upload gate is a measurement, not a question: run the repo's check
(`scripts/git-hooks/pre-push` runs it; also `scripts/triage/` has probes) and read a real number of
active uploads; a `null` is a broken probe, not a green light (lesson 169). Verify on production as
the reporter, through the UI they used.

## Reply
A short message to the team in Mason's voice, item by item: fixed (what they will see), as designed
(why), coming (when), need more info (what). Plain text he can paste into the team thread. Anything
that becomes real work lands in `tasks/todo.md` with his priority.
