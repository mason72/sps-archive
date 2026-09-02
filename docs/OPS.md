# Pixeltrunk Ops — alpha access, metering, and cost automation

Built 2026-08-10. Everything here shipped verified; history in `tasks/todo.md`
("Alpha access + ops.pixeltrunk.com" and the feedback rounds).

## Access model

- **Signup is invitation-only.** Public Supabase signups are DISABLED at the
  project level (sps-prism dashboard toggle); the ONLY door is
  `/api/auth/signup` (`admin.createUser`), and its lock is the
  **`allowed_signups`** table (migration 037). Fail-closed: no row → 403.
- **Waitlist**: pixeltrunk.com's "Request an invite" form → `POST /api/waitlist`
  (public; honeypot `company` field, per-IP rate limit scope `waitlist`,
  never reveals whether an email is known) → `waitlist` table (043) → admin
  notification email → reviewed on /ops (approve = whitelist + branded
  invite; dismiss keeps the row).
- **Invite email has ONE home**: `src/lib/emails/invite.ts` — used by the /ops
  panels and `scripts/send-invite.ts <email>` (CLI; signup link pinned to prod).
- **Admin** = `user_profiles.is_admin`, held ONLY by mason@twodudesphoto.com
  (personal). info@twodudesphoto.com is the shared TEAM login and must never
  be admin — the team is not supposed to see /ops.
- **Act-as** (`src/lib/auth/impersonation.ts`): admins assume another account
  via signed httpOnly cookie ("work as" on /ops). `getAuthUser()` returns
  `{user: effective, realUser, actingAs}`; **anything admin-gated checks
  `realUser`** (requireAdmin), content scopes to `user`. Demotion kills the
  cookie instantly. Full-width emerald top bar while acting. Known wart:
  client-side RLS reads (Cmd-K palette) can't be impersonated.

## Ops dashboard — app.pixeltrunk.com/ops (= ops.pixeltrunk.com)

- Gate: `requireAdmin()` (`src/lib/auth/admin.ts`) is the ONE is_admin check;
  `assertAdminPage()` is awaited at the top of every /ops PAGE **before any
  fetch** — a layout gate is NOT a security boundary (streaming SSR renders
  page+layout in parallel; lesson 51b). Middleware auths the ops host before
  rewriting. Verify access control with raw curl, never a browser.
- Panels: stat row, 30-day cost sparkline, cost-by-account (with "work as"),
  alpha invites, waitlist review, fixed-overhead estimates, metered activity,
  error triage (user-attributed via system_errors.user_id).

## Metering (docs also in memory: usage-metering-architecture)

- **Flows** → `usage_events` (040): Modal wall-time (ai_index/embed_text/
  selfie/video), zip bytes, cover rasters, email sends. Guest-triggered work
  bills the EVENT OWNER. `recordUsage()` is ALWAYS awaited (a void insert at
  an Inngest step boundary loses the row) and never throws.
- **Stock** → `get_user_storage(uuid)` SQL (one home) wrapped by
  `src/lib/usage/storage.ts`; `images.thumb_bytes` written at all 7
  thumbnail sites; pre-metering rows estimated (videos excluded).
- **Prices live ONLY in `src/lib/usage/costs.ts`** (real Modal/R2/Resend
  rates; R2 egress is free; `PLATFORM_OVERHEAD_MONTHLY` are estimates).
  `getUsageOverview()` (`usage/summary.ts`) is the one compute home shared by
  /ops and the weekly email — they cannot disagree.

## Automation (src/lib/inngest/ops-functions.ts)

- `usage-anomaly-daily` (8:07am PT + `ops/anomaly.run`): flags yesterday >
  multiplier × max(user 7-day avg, baseline). All flags in ONE
  reportSystemError.
  **The knobs live in the `ops_config` row keyed "anomaly" (042), and that row
  OVERRIDES `DEFAULTS` in `anomaly.ts` — changing the constant alone ships a
  commit that changes nothing.** Change both and read the row back.
  Recalibrated 2026-08-30: baseline $1 → **$5** (threshold floor $10). The $1
  seed was below normal operating cost, so every real shoot day paged — a $2.34
  day flagged for being 9x a $0.26 average when it was 18,736 photos honestly
  indexed. Measured from the whole ledger, the busiest days ever are $2.34,
  $2.19, $1.74, $1.62, $1.42; $10/day is ~80,000 photos, reachable by a runaway
  loop and not by shooting. Once a trailing average passes $5 the floor stops
  binding and the threshold tracks the average, so this needs no further upkeep
  as volume grows.
- Checking a threshold change: `npx tsx scripts/triage/anomaly-dry-run.ts` runs
  the real function against production and prints what it would flag.
  `scripts/verify-ops-crons.ts` also works but SENDS the weekly pricing email as
  its proof, so it is the wrong tool for a threshold tweak.
- `pricing-summary-weekly` (Mon 8:11am PT + `ops/pricing-summary.run`):
  shadow invoice to ADMIN_ALERT_EMAIL; tier fit + margin from
  `PLANS.monthlyPriceUsd` (stripe/config.ts — must match m/pricing page).
- First-run harness: `scripts/verify-ops-crons.ts` (pass ADMIN_ALERT_EMAIL).
- Verifying Inngest registration: unsigned GET /api/inngest is 401 since SDK
  3.54 — introspection must be HMAC-signed (the 401 is itself healthy).

## People index (/people) — added 2026-08-10

Archive-wide index of everyone the photographer has shot, with the "wall of
fame" as its podium rather than a separate page (a repeat-only page would
have shipped with ONE member: 910 named people, 1 in two events, because the
archive is only part-migrated).

- Identity: `personNameFromParts` — the SAME helper stacks/auto-sections use.
  Never re-derive names; that drift caused the "AaronCote Appfolio" bug.
- `src/lib/people/index-people.ts` is the one home. It excludes the four
  marketing galleries (TDP Website/Work/Sample Images/Samples — they
  duplicate each other's photos, and their filenames parse into venues:
  the first leaderboard's top entries were MOSCONE CENTER and Stripe BTS)
  and applies `looksLikePersonName`.
- `displayName` title-cases ONLY single-cased names; mixed case is left
  alone (McCartney, de Vries, O'Neil).
- Sorts: most events (default, = the ranking), most photos, A-Z, plus a
  "repeat only" filter. Podium shows only in rank order, unfiltered.
- Hero frame per person = highest `aesthetic_score`.
- **Clicking any face opens the SPOTLIGHT** (`PersonSpotlight.tsx`) — every
  photo of that person across the whole archive, grouped by shoot, with ← / →
  stepping to the next person in the current sort. Loaded on demand from
  `GET /api/people/detail?name=` (`buildPersonDetail`); pre-loading 910
  people's photo sets is not a thing.
- **Event appearances render as CHIPS** (thumb + event name + that person's
  count), on the podium and in the spotlight. A chip links to
  `/events/{id}?person=<name>`, which the event page resolves client-side over
  its loaded images and shows as the person filter — so it works in events
  that were never face-clustered, and the number on the chip is the number you
  land on. The chip caps at 2 on a podium card ("+N more" → the spotlight).
- **One identity helper, three surfaces**: `personKeyForImage()` decides
  membership for the index count, the spotlight payload, and the deep link.
  It is RAW identity, not a personhood test — a camera code yields a key too,
  so anything taking a name from a URL runs `looksLikePersonName` first.
  E2E: `npx tsx scripts/verify-person-spotlight.ts` asserts all three agree.
- INTERNAL ONLY. It aggregates named faces across clients, which reveals
  employment across companies — never expose publicly or client-facing.
- **A name that labels an EVENT is not a person there** (2026-09-02,
  `src/lib/people/event-labels.ts`): a name on ≥10% of an event with ≥100
  photos is dropped for that event before vouching. "Google Booth" was 287 of
  287 on a booth export and passed `looksLikePersonName`; measured, 79 such
  (event, name) pairs archive-wide, every one a label — including the two that
  read like people ("Haley Neil", "Mason, Tang": couples'/party names over
  hundreds of face clusters). Faces were tried and rejected as the test.
- **Single-word people are admitted with guardrails** (Mason, 2026-09-02):
  `looksLikeSingleName` — letters, ≥3, not all-caps, not a gallery word — plus
  ≤60 frames in any one event. 3,298 → 3,743 people; a brand word that slips
  through ("Twitch") is one "Not a person" click. Probe:
  `scripts/triage/people-labels-probe.ts`.
- Cross-event FACE matching is built (2026-08-16) — see
  `tasks/people-group-shots.md` and the identity-engine bullet in CLAUDE.md.
  (booths/festivals/weddings). 32k+ embedded faces exist. Must suggest, not
  merge — same rule as the rest of the AI suite.

## Marketing site (src/app/m)

Copy posture: **outcome-led, mechanism-silent** — no model names, no infra
nouns, no roadmap. Trial claims are gone; CTAs point at the waitlist form
(`#invite`). Pricing stays public; FAQ says the alpha is free.

## QA patterns that work here

- Throwaway admin: create via admin API + is_admin, drive the UI, demote live
  to prove fail-closed, delete after. `.env.local` is PRODUCTION — scratch
  events only, delete when done.
- Synthetic uploads: build Files in-page (canvas → DataTransfer) and set them
  on the file INPUT + dispatch `change` (synthetic drag/drop events don't
  trigger the dropzone). Noise images (~200KB) slow the pipeline enough to
  observe in-flight states.

## Gallery status on the archive (added 2026-08-10)

`src/lib/events/status.ts` — `resolveEventStatuses()` resolves a page of events
in a fixed number of queries. TWO axes, never merged:

- **Delivery ladder**: draft → published → sent → opened → downloaded, plus an
  `expired` badge (past `expires_at` while still `is_active` — silently dead).
  Evidence rule: a VIEW proves delivery, an email only proves an attempt.
  Measured 2026-08-10: 15 live shares, all opened, only 9 ever emailed from
  Pixeltrunk — six links travelled by text/Slack.
- **Readiness**: uploads landing + AI indexing. Orthogonal, because a gallery
  is routinely sent while processing is still queued.

Surfaces: `GalleryStatusBadge` on the archive card (pill + ring; the ring only
appears while there IS something to wait for), and `ProcessingBanner` at the
top of the event page — live count, ETA measured from this event's own
throughput, and an explicit "available now vs. switches on later" line.
`GET /api/events/[eventId]/processing` backs the banner and is deliberately
count-only so it can be polled.

## Upload ghosts (added 2026-08-10)

A `pending` row is presign-created before its bytes exist. Two consequences,
both bitten on HDC 2026:

1. `countPendingUploads()` now only counts rows younger than 30 minutes.
   Before that gate, 9 stale rows out of 5,787 made `ai-index` return
   `skipped: "uploads-in-flight"` on every run — permanently — which also
   meant `faces/cluster.requested` never fired. Semantic search, the Faces
   tab, selfie search and smart sections were all dark for that event.
2. **Dismiss resolves.** `DELETE /api/events/[eventId]/unfinished-uploads`
   HEADs each stale row in R2, deletes the genuinely empty ones, and leaves
   anything whose binary landed for the nightly reconciler to heal. It used to
   write a `localStorage` flag only — the rows survived, in one browser's
   opinion (lesson 67). Never blanket-delete pending rows: ~1% have their
   bytes and only missed the finalize call.

## Duplicate uploads — open (measured 2026-08-10)

There is NO duplicate detection at ingest. Every presign mints a fresh UUID
key, so re-dragging a folder creates a complete second copy: rows, R2 objects,
thumbnails, and a second pass of GPU indexing. Live counts:

| Event | Rows | Distinct files | Extra copies |
|---|---|---|---|
| Hotel Data Conference 2026 | 5,787 | 3,842 | **1,945** (34%) |
| Jessica & Koji's Big Day | 1,020 | 552 | 468 |
| TDP Website | 1,264 | 1,176 | 88 |
| COLLEGEBOARD // NASAI | 2,542 | 2,458 | 84 |

On HDC, 1,847 of those are byte-identical (same name AND size); 98 filenames
carry genuinely different bytes and are real re-edits. Fix at the source:
compare name + size (ideally a content hash) at presign, skip what's already
there, and report "N skipped as duplicates". Cleanup is a separate, destructive
job — keep the newest of each identical set, leave the re-edits alone.

## Loading animation (added 2026-08-10)

`src/components/brand/ElephantWalk.tsx` + `scripts/cut-elephant.mjs`. The logo
is sliced into seven cut-out puppet parts straight from its alpha mask (four
legs, trunk, tail, body) — original artwork, nothing redrawn — and animated on
a lateral-sequence elephant gait with a stop-motion cadence. Acacias pass at
two depths on non-dividing periods (11s / 30s) so sightings never sync.
Playground: `/dev/loading`. Currently used by `/people`'s `loading.tsx`.
NOT used in the guest gallery — those are white-labelled with the
photographer's branding, so putting our mark in a client's search wait is
Mason's call, not a default.

## Ingest service — the two launchd agents (added 2026-08-18)

The Pixieset→Pixeltrunk drain runs as two user agents, not as a session job:

| Agent | Runs | Log |
|---|---|---|
| `com.twodudes.pixieset.watch` | `scripts/pixieset/watch.mjs watch` | `~/pixieset-staging/logs/watch.log` |
| `com.twodudes.pixieset.ingest` | `scripts/pixieset/ingest-loop.sh --forever` | `~/pixieset-staging/logs/ingest.log` |

Restart either with `launchctl kickstart -k gui/$(id -u)/<label>`. The pass
counter in the log resets to 1 on restart — that is how you tell a new process
from the old one.

**Health check, and it is one line.** A drained queue must produce an `idling`
line every 5 minutes:

```
grep -c "idling" ~/pixieset-staging/logs/ingest.log
```

**Zero is a red flag, not a quiet day.** On 2026-08-18 that count was 0 across
**3,013 passes** going back to 2026-08-16 21:40. The idle guard matched on the
ingest's wording:

```bash
grep -qiE "nothing to ingest|no verified|no collection"
```

and the ingest actually prints `nothing is verified and waiting to ingest.` —
which contains none of those (`nothing to ingest` needs the words adjacent).
So the guard never fired, the loop fell through with no sleep, and it respawned
`npx tsx` every ~4 seconds for 34 hours. Node startup plus TypeScript transpile
plus module resolution, roughly 24,000 times.

**What it looked like from the outside was not a loop at all.** It presented as
`fileproviderd` pinned at 100%+, Time Machine unable to finish an hourly backup
(3.1M-file scans stacking up), 8,000–10,000 disk IOPS, load average above 60,
and Claude Code sessions timing out. Two hours went into Time Machine and
Dropbox before anything pointed here. **When this machine is inexplicably slow,
check the ingest idle count before you touch the backup or sync layers** — it is
one command and it would have been the first correct answer.

The guard now matches the real wording *and* the unrecognized-output branch
fails closed (idle + shout) instead of open (spin), so the next wording drift
costs five minutes of latency rather than a day of CPU.
