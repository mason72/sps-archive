---
name: pt-stall-triage
description: Diagnose a stuck Pixeltrunk import, ingest or indexing run (Pixieset migration, reconciler, backfills) and classify it as livelock, backlog or hang before touching anything. Use when Mason says "check on the reconciler", "got a stuck notice", "importing X is stuck at N images", "the ingest hasn't moved", or "is it still running?".
---

# Stall triage (Pixeltrunk ingest and import)

Six stall reports in Q3 2026. The taxonomy is in `tasks/lessons.md` 112, 123, 126, 131, 157, 160, 168
and 175; this is the decision procedure. Findings before fixes; never kill a process to see what happens
(lesson 126: a silent log was a healthy run, and killing it proved nothing).

## 0. Rule out capacity first
`npx tsx scripts/capacity-check.ts` (read-only, seconds). If it reports a critical finding, that is
the stall until proven otherwise: on 2026-10-04 a gallery sat at "Queued" for a day because the
database had outgrown its memory, and an hour went into queues and job rows before one look at
`pg_settings` (lesson 175). A resize costs money, so it goes to Mason as a decision card with the
measured numbers and the monthly price.

## 1. Name the durable record, then read it
The queue file and the `images` table are the truth; the log and Inngest's dashboard are claims.
- `scripts/pixieset/` queue (`queue.json`): which collection is `in_progress`, its cursor, when it
  last advanced.
- `images` for that event: `count(*)`, `max(created_at)`, rows by status. A rising count with a quiet
  log is a BACKLOG, not a hang (lesson 157: the stall check called a backlog STUCK).
- `system_errors` for the window; the Inngest run list for the function; `ingest.log` on the Studio
  (`ingest-loop.sh` prints a run's output only on exit, so a silent log is by design).

## 2. Classify
| Reading | Class | Meaning |
|---|---|---|
| Cursor and `images` both advancing, slower than expected | **Backlog** | Leave it. Report the rate and the ETA from measured throughput, not a guess. |
| Cursor not moving, the same item re-requested or re-deferred each pass | **Livelock** (lesson 123) | A deferral that does not move the cursor. Fix the cursor logic; do not restart (it will loop again). |
| Process alive at 0% CPU, one ESTABLISHED socket, no new rows | **Hang** (lessons 112, 131) | A call with no timeout. `ps -o etime,pcpu -p <pid>`; `lsof -nP -i -a -p <pid>`. Add the timeout, then restart. |
| Inngest shows a run the app has no row for | **Phantom run** (lesson 160) | Only Inngest believed in it. Treat as not running; start fresh after confirming no partial rows. |
| Pages for finished galleries failing while a job runs | **Resource contention** (lesson 168) | Indexing starving the web tier. Throttle or pause the job; the upload path comes first. |
| Statement timeouts in several contexts at once, throughput falling for days | **Out of capacity** (lesson 175) | The database has outgrown its compute size. Step 0's check names the size and the price; do not tune queries around it. |
| A gallery shows "Queued" while others index | **Not its turn** (lesson 175) | The AI lane works a plan: live galleries first, then newest shoot (`src/lib/ai-index/plan.ts`). Check where the gallery sits in `events_needing_ai_index` before calling it stuck. |

## 3. Act, narrowly
- Backlog: nothing but a heartbeat message with the measured rate.
- Livelock or hang: fix the root cause in code (timeout, cursor), test on the stuck item alone, then
  resume from the cursor. Never re-run a whole collection to "unstick" it; that duplicates.
- Any resume: assert byte or row totals on both sides afterwards; a count guard is not a presence guard.
- Jobs run on the Studio (`multi-machine.md`); drive them over ssh, not from the laptop.

## 4. Report
Class, evidence (the two numbers that decided it), what you changed, the measured rate after, and
whether uploading was ever affected. Add a lesson only if the class is new.
