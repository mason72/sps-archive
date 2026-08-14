# Session handoff — start here

`CLAUDE.md` has referenced this file for a while and it did not exist. It does
now. Read `CLAUDE.md` first for the invariants; this is the orientation: what
Pixeltrunk is, what is in flight, and what the next session should pick up.

Last substantive update: **2026-08-13**.

---

## What this is

**Pixeltrunk** — an AI-powered photo archive for professional photographers.
Sister product to **SimplePhotoShare** (`spsv2`), which is the live event feed;
Pixeltrunk is the curated, permanent archive. A photo on SPS but not in the
archive is usually a deliberate omission, not a loss.

The only real user today is **Two Dudes Photo** (Mason's business): event
photography, photo booths, and in-studio headshots. Alpha access is table-gated
(`allowed_signups`); public Supabase signups are disabled at the project level.

Production is **app.pixeltrunk.com**, Vercel project `pixeltrunk`, Supabase
project **sps-prism** (`hfusdrtrizabzzcdhnyy`). `main` auto-deploys — `next build`
must pass before every push.

## The map

| Area | Doc | One-line |
|---|---|---|
| Product | `docs/PRD.md` | What it is for and who it serves |
| Technical | `docs/TECHNICAL.md` | Stack, data model, upload and AI pipelines |
| AI suite | `docs/AI.md` | **Read before touching anything AI.** Search, faces, sections |
| Ops | `docs/OPS.md` | Alpha access, metering, `/ops`, crons |
| Pixieset migration | `docs/PIXIESET-MIGRATION.md`, `tasks/pixieset-migration.md` | The 1,371-collection move |
| Event Intel | `tasks/event-intel.md` | Venues, crew, clients, and the `/intel` pivot |
| SPS pull | `tasks/sps-archive-pull-spec.md` | The wire contract; `tasks/sps-pull-build-plan.md` for build notes |
| Mistakes | `tasks/lessons.md` | **Skim before touching API routes.** 73 entries and counting |
| Queue | `tasks/todo.md` | What is next and why |

Project memory (`MEMORY.md` in the memory namespace) carries the facts that are
not derivable from the code — business context, past incidents, Mason's
conventions. It is the other entry point.

## What is live and stable

- Upload → R2 + Supabase, presign-ahead, reconciler, section-scoped dedupe
- Guest galleries, shares, passwords, download PINs, email composer
- AI: SigLIP-2 semantic search over binary-quantized fingerprints, face
  clustering, People index, scene sections
- `/ops` admin — cost, usage, invites, errors
- **SPS → Pixeltrunk pull import** (built 2026-08-11) — moves bytes, not
  pointers
- **Event Intel `/intel`** (built 2026-08-13) — the back-office pivot
- **Event Intel calendar backfill** — 23 of 27 galleries carry venue, crew and
  client, matched from three Google Calendars

## In flight — pick these up

Full detail in `tasks/todo.md`. In priority order as of 2026-08-13:

1. **Pixieset migration.** The big one. 1,371 KEEP collections / ~1.58M photos
   before the subscription is cancelled; 857 of them are pre-2024 where
   **Pixieset is the only copy in existence.** Oldest first. Nothing is deleted
   from Pixieset until it is verified elsewhere. Perkin Elmer (1,016 photos) is
   staged and verified and is the next ingest.
   - Blocking work first: the AI-index nudge cap (25 events/night) will not
     keep up with a bulk import; and 30 collections have
     `high_res_download_size: 0` and need High Resolution turned on before they
     can be pulled at full fidelity.
2. **Event Intel roles.** All 42 crew links are pre-filled but marked
   `roles_source = 'inferred'`. Mason confirms them in `/intel`; confirmed
   roles are the only ones that count toward any statistic.
3. **Three client names** are undecidable from the corpus —
   `episode1agency.com`, `typeaevents.com`, `wallandceiling.org`. Needs Mason.
4. **Confirm card at upload time** — the calendar parser already runs over one
   gig; wiring it into the upload flow is the "suggest and confirm" Mason asked
   for. Needs `GOOGLE_CALENDAR_KEY` in Vercel.
5. **Housekeeping:** an orphaned June 2026 service-account key to delete; the
   "SLC Recs from Cory" roster sheet never imported (no header row).

## How to work here

Generic rules are global (`~/.claude/CLAUDE.md` + `~/.claude/rules/`). The ones
this repo bites people on:

- **Never `npm run build` while a dev server runs in the same working
  directory** — they share `.next`. Check *before every build*, not once per
  session; that is how it went wrong on 2026-08-13. A git worktree has its own
  `.next` and is safe.
- **`getAuthUser()` returns the SERVICE client, which bypasses RLS.** Every
  query it feeds needs an ownership filter. This has shipped as an IDOR twice.
- **A Supabase error is a return value, not a throw.** `data || []` turns a 400
  into a believable empty result.
- **Check for live events and recent uploads before pushing.**
  `scripts/triage/live-activity.ts`.
- **Run every heuristic over the real corpus before shipping it.** Green unit
  tests encode your assumptions faithfully, including the wrong ones — lesson 73.

## Two machines

`~/Projects` is Syncthing-synced between the Mac mini and the work laptop, but
**`.git` is excluded**, so the other machine's commits arrive only via
`git fetch`. Working files arrive by Syncthing; history arrives by GitHub. Both
steps are needed before starting work.
