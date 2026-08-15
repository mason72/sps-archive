# Session handoff — start here

`CLAUDE.md` has referenced this file for a while and it did not exist. It does
now. Read `CLAUDE.md` first for the invariants; this is the orientation: what
Pixeltrunk is, what is in flight, and what the next session should pick up.

Last substantive update: **2026-08-15**.

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
| Mistakes | `tasks/lessons.md` | **Skim before touching API routes.** 81 entries and counting |
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
- **Event Intel** — `/intel` pivot (Crew · Venues · Cities · Clients · Roster),
  an Intel tab on the event page, and a confirm strip under the photos. Full
  CRUD on crew, venues and clients. See `tasks/event-intel.md` for the model.
- **Event Intel calendar backfill** — 23 of 45 galleries carry venue, crew and
  client, matched from three Google Calendars
- **Gig confirmation on the CREATE screen** (built 2026-08-15) — the event-name
  field is a calendar autocomplete; picking a gig pre-fills name, date, venue,
  crew and payer and confirms them before the event exists. `GOOGLE_CALENDAR_KEY`
  is set in Vercel production (Sensitive, so it cannot be read back — verify it
  by exercising `/api/events/suggest-gig`, not by `vercel env pull`)

## In flight — pick these up

Full detail in `tasks/todo.md`. Priority as of **2026-08-15**:

1. **Pixieset migration** — 1,371 collections, 8 ingested. The loop is proven
   end to end and unblocked: staging is on the external SSD, High Resolution is
   fixed on all 30 collections that needed it, PINs turned out not to gate the
   KEEP set. Needs Mason's Chrome for the download driver (Cloudflare).
   Two collections are quarantined as Web Size and need re-requesting once
   Pixieset's cached archives age out (7 days).
2. **Three client names** undecidable from the corpus — `episode1agency.com`,
   `typeaevents.com`, `wallandceiling.org`.
3. **AI-index timeouts under bulk import** — 8,782 photos in 24h made the
   indexer time out partway before retrying successfully. Self-healing today;
   will get louder as the bulk scales.
4. **Housekeeping:** an orphaned June 2026 service-account key to delete; the
   "SLC Recs from Cory" roster sheet never imported (no header row).

## You can SEE the app — use it

Mason's own Chrome is signed in to app.pixeltrunk.com, and the
`claude-in-chrome` tools drive it. Open a tab, navigate, screenshot, run JS in
the page. **Do this before handing any UI over.** Four separate layout/UX bugs
in the 2026-08-14/15 session were things he caught because I had verified types,
data and build but never looked at the screen.

Never ask for or type his password — he offered it and the answer is no. The
existing session makes it unnecessary anyway.

Two gotchas: the event page is heavy enough that `screenshot` sometimes times out
(use `get_page_text` or a JS probe instead), and a DOM text probe must be
CASE-INSENSITIVE because CSS `uppercase` changes what `innerText` returns.

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
