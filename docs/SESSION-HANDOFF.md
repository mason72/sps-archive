# Session handoff — start here

`CLAUDE.md` has referenced this file for a while and it did not exist. It does
now. Read `CLAUDE.md` first for the invariants; this is the orientation: what
Pixeltrunk is, what is in flight, and what the next session should pick up.

Last substantive update: **2026-08-30**.

> **Pixieset migration, current truth (2026-08-30).** 79 of 1,371 ingested.
> Downloads run as in-page JS in Mason's real Chrome — the nightly autopilot is
> written but **Cloudflare-blocked at the collection page** and must not be
> worked around. Order is **NEWEST FIRST** (recent clients ask for galleries).
> **Do not assume 2024+ is safe because Dropbox has it** — 172 of 513 have no
> Dropbox folder. The local Dropbox file provider is dead (0.21 Mbps, measured).
> Ingest/watcher/stall-check run as launchd agents and are healthy.

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
| Mistakes | `tasks/lessons.md` | **Skim before touching API routes.** 90 entries and counting |
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
  crew and payer and confirms them before the event exists. Already-claimed gigs
  are greyed and sunk, never hidden. `GOOGLE_CALENDAR_KEY` is set in Vercel
  production (Sensitive, so it cannot be read back — verify it by exercising
  `/api/events/suggest-gig`, not by `vercel env pull`)
- **The rehire ladder** — `first_call | solid | last_resort | never`, rated on
  the create card at upload time by the lead who just worked with them. Standing
  is most-recent-not-average, hidden on the event being rated (anti-anchoring),
  and a hard no sinks in every picker. `crew.rehire` (migration 060) seeds people
  with no rated gig. Full model in `tasks/event-intel.md`
- **Intel crew panel is editable** — stars, regular toggle, name/email/location,
  discipline, the rating, last-hired and alumni. This is the tool for seeding
  the 61-person roster. (`can_lead` and `travels` were DROPPED 2026-08-15 —
  columns dormant, nothing reads them)
- **Gig confirmation on the SPS IMPORT screen too** (2026-08-15) — the review
  step asks "Which job was this?", seeded with the SPS event name; shares
  `GigIntelStep`/`GigConfirmCard` with the create screen. Intel is applied
  after the event exists, never able to fail the import, skipped on resume
- **Event Intel is GATED per account** (2026-08-15, lesson 85) —
  `EVENT_INTEL_USER_IDS` env var, `hasIntelAccess()` /`getIntelUser()` in
  `src/lib/event-intel/`. The calendar behind suggest-gig is ONE studio's
  service account and was leaking to any signed-in user; measured ownership
  first (everything belongs to info@, `is_admin` is mason@'s only). SPS import
  stays open to all accounts by design
- **The radius search** (2026-08-15) — "Near [city]" + drivable / short flight
  / anywhere on the Intel Crew axis. GROUPS, not a filter: within-reach,
  further out, can't-place — nobody silently dropped. Client-side over
  `geo.ts` (24-metro coordinate table, tests against known distances)
- **Live SPS events are importable, flagged** (2026-08-15) — SPS's archive list
  now includes `status: 'live'` events with `live: true` (spsv2 commit
  04da08b); the import screen badges them (pulsing red LIVE, "photos so far"),
  warns in review, and confirms before pulling. An event still imports ONCE;
  "check for updates on a pulled event" is spec'd backlog. Hand-uploaded
  events get "Already in the archive?" → link to the existing PT event
  (`POST /api/sps/pull/events/[id]/link`, source manual-link, Unlink undo);
  KFL LA + NYC linked and verified 2026-08-15
- **Crew faces** (2026-08-15, `tasks/crew-faces.md`) — reference sets in
  `crew_faces` (migration 061), avatars beside every crew name (initials when
  empty), upload/tag/star/delete on the Intel panel, "Find them in the
  archive" via the selfie-match engine, "crew…" tagging from any gallery's
  People view, and the Your Crew wall on `/people` (regulars default). Crew
  names never touch `persons.name`. ⚠️ any embed through `images`↔`events`
  needs the FK hint (`events!images_event_id_fkey`) — lesson 86
- **Last hired** (2026-08-15, migration 062) — `Aug 2024 (2 yrs)`, `(Recent)`
  inside a year, non-regulars only. DERIVED on read as `max(hand-entered seed,
  newest linked event)`, so it self-updates when a gig is confirmed and has no
  stored copy to rot. `scripts/backfill-last-hired.ts` seeded 77 of 87 from
  twelve years of calendar. Memory: `last-hired-is-derived`
- **Alumni** (2026-08-15) — archived crew read as "Alumni" in every UI
  (`archived` in the data). Band filters — All · Regulars · Non-regulars ·
  Alumni — sit under the search on the Crew axis, the Roster and the /people
  wall; they default to All and NARROW the search. Mark/restore works from the
  Crew panel and the Roster
- **`components/ui/segmented.tsx`** — the one control for "pick exactly one".
  Selection is the brand accent; groups whose VALUES carry meaning (the rehire
  ladder's severity ramp) keep their own markup and do NOT use it. Also
  `MonthPicker` in `components/ui/date-picker.tsx` — branded month/year picker
  with a scrollable year rail, replacing the native `<input type="month">`

## In flight — pick these up

Full detail in `tasks/todo.md`. Priority as of **2026-08-16**:

0. **The /people identity engine is LIVE end to end** (2026-08-16, full doc
   `tasks/people-group-shots.md`, invariants in CLAUDE.md): group-shot
   membership, face rings, the identity merge (Sami merged via the real UI),
   rejected-names durability, the NAMING ENGINE (measured 0.55 floor; Mason
   confirmed 51 in one sitting), and CREW-FIRST matching (37 crew suggestions,
   Justin's Staff Photos cluster at 341 photos; a crew confirm LINKS via
   crew_persons, never names). Wall of fame: top 6, crew excluded, crew sink
   to the bottom of ranked Everyone. Open: **~39 tray cards await Mason**
   (mostly crew), and the Inngest `identity-scan` lane needs its first
   organic firing verified on the next import.
   **The crew spotlight is BUILT** (2026-08-16 evening): the crew card on
   /people carries "In the archive" — every linked cluster's photos grouped by
   shoot, 80/event cap with true counts, ?face= deep links
   (`/api/crew/[crewId]/photos`, intel-gated). Crew-linked clusters are
   labeled on event walls ("Christie Jones · crew") and SILENCE all
   filename-derived suggestions (splits/mislabels/merges/refinements) — a
   human's identity outranks filename guessing (lesson 94 family).
   Next builds: **(a) archive-wide conflation cards** — 17 shared-name pairs
   measured, all same-event; `person_split_dismissals` (068) ready.
   **(b) cross-event tile fan-out** — zero real cases today; deferred.

1. **Pixieset migration — READ THIS FIRST.** 27 of 1,371 ingested. It runs
   as three launchd agents (watch / ingest / stallcheck) — see
   `scripts/pixieset/launchd/README.md`. On 2026-08-21 the stall alert caught
   a duplicate storm: an unpaged idempotency read capped at 1,000 rows
   re-inserted every photo past the first thousand on each retry (lesson 101).
   Fixed and pushed (`d2a839d`). Twitch Masquerade Ball deduped
   (`px-dedupe-event.ts`); **15 other events still carry ~1,100 duplicate
   rows and each needs its own diagnosis** — TDP Website's are deliberate
   publication, do NOT dedupe it. The ingest agent is BOOTED OUT and must be
   re-bootstrapped after the cleanup is verified. Downloads need Mason's
   Chrome on Pixieset; 22 download-disabled collections have their settings
   snapshotted in `~/pixieset-staging/pixieset-download-settings-backup.json`
   awaiting flip-pull-restore.
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
