# Auto-Highlights — design notes (opened 2026-08-11)

Automatically propose a Highlights section by picking the best images from an
event. Experiment event: **Jordan x Kids Foot Locker // Back to School // NYC**
(`e8459f76-1212-461e-9078-cdc6e945e68c`), uploaded by Joey 2026-08-11 for this
exact purpose — he has picked his own favorites behind the scenes as a
comparison set.

## Ground facts measured on the experiment event (2026-08-11)

- **679 files, 397 moments.** `All Star Vertical (Branded)` and
  `She's Got Game Vertical (Branded)` are 282 images each and their `taken_at`
  sets overlap **282/282** — the same capture rendered with two brand
  treatments. Plus 115 `Landscape (Clean)`. A file-level top-N would show every
  moment twice.
- **Burst shoot:** 433 of 678 consecutive `taken_at` gaps are ≤2s; 358 unique
  timestamps across 679 rows.
- **No filename signal.** Every filename is a bare UUID (SPS-style), so the
  filename-derived stack logic finds nothing here and the faces consensus
  auto-namer stays blank. Near-duplicate grouping must come from embeddings +
  capture time, never filenames.
- **`aesthetic_score` is a weak solo ranker.** Archive-wide the middle 80% sits
  in 0.53–0.65 (full range 0.38–0.72, n=1000 non-random sample). Ranking
  hundreds of frames on a 0.12-wide band feels arbitrary.
- **`faces.is_eyes_open` and `faces.quality` are populated on all 33,160 face
  rows.** Closed eyes is the top cull reason in event work and we already have
  it for free.
- `favorites` is only 22 rows archive-wide — too sparse to use as signal today,
  but the obvious long-run feedback loop.
- This event's `events.settings` is **NULL**, not `{}` — anything reading
  settings defaults must survive null, not just empty object.

## Decisions made

| Decision | Choice |
| --- | --- |
| Entry point | The **empty Highlights section**'s own CTA. Every event already ships a Highlights section, so the output's home is the front door. Secondary entry as a mode beside "By scene" / "Smart section". |
| Scope | **Event-wide, moment-aware.** Identical-`taken_at` branded twins collapse into one moment. |
| Selection | **Coverage-balanced.** Spread across timeline and people, then take the best within each slice. 40 gorgeous frames of the same three kids is a bad reel. |
| Config | Near-zero: one count, one coverage toggle. No weight sliders. |
| Durability | Highlights is a manual section (`is_auto: false`) — a rebuild must never silently eat the photographer's edits. Re-running proposes into the same review with kept picks pre-marked. |
| Apply | Writes memberships only, same as smart sections. Never file copies. |
| Ranking | **Learn a "highlight direction" from the 742 existing human picks** in SigLIP space. No GPU, no new infra. Must be validated by leave-one-event-out cross-validation *before* any UI is built. |
| Default count | **40**, capped so it never exceeds ~25% of an event's moments (Mason, 2026-08-11). Slider 5–100, step 5. All four numbers live in `src/lib/highlights/limits.ts` — one home, or the front door starts recommending a count the review cannot reach. |
| After Accept | Saved, never locked. Highlights is `is_auto: false`, so no automatic rebuild can touch it; only the photographer re-running. A re-run proposes into the review and replaces **on Accept**, never before. |

## The scalar signals do NOT predict human picks (measured 2026-08-11)

12 events already carry hand-picked Highlights sections — **742 human picks**
across 15,330 indexed images. Comparing picked vs unpicked
(`scripts/triage/probe-hl-truth.ts`):

- **`aesthetic_score` has no predictive power.** In 4 of 12 events the human
  picks scored *lower* than the rejects; the rest are within ~0.005 (noise).
  eBay HEADSHOTS is the starkest: picks 0.5031 vs rejects 0.5973.
- **`is_eyes_open` is a dead signal — it is `true` for all 33,406 face rows and
  `false` for zero.** It is effectively hardcoded. This is a pipeline bug, not a
  weak feature (see Open below).
- **`sharpness_score` saturates.** Normalized 0–1 with p90 = 1.0, so ~20% of the
  archive ties at exactly the top — precisely the range highlights live in. No
  separation between picked and unpicked in any event.
- **`faces.quality` is the one scalar with real spread** (0.001–0.915, p50 0.20)
  and has not yet been tested against the picks.

A score-and-rank design built on these would have produced near-random picks
with a confident UI wrapped around them.

**Selection ratio evidence:** median ~5% of the event, **range 2.4–17.9%**, plus
one 80% outlier at eBay National Interns Day. The default landed at 40 (≈11%
here), which sits inside the observed spread. The empty state therefore quotes
the *spread* ("anywhere from 9 to 64 on an event this size"), not the median —
an earlier version cited "about 5%" while defaulting to 40, so the copy and the
control disagreed, which reads as the product not believing itself.

## Eval result: a learned direction beats random, weakly but really (2026-08-11)

`scripts/triage/eval-highlight-ranker.ts` — leave-one-event-out over the 13
events with hand-picked Highlights (782 picks). Train a "highlight direction"
in SigLIP space on 12 events (mean picked minus mean unpicked), score the
held-out event, measure precision@k where k is that photographer's real pick
count.

**Embeddings are centered per event before anything is learned.** Uncentered,
the model learns *which event is this* — SigLIP encodes the scene — and scores
well for entirely the wrong reason.

Excluding two special cases (eBay National Interns Day, where 108 of 135 images
are "highlights" so the base rate is 80% and nothing can be measured; and Foot
Locker, whose picks are Claude's not a photographer's), across the remaining 11:

| Ranker | Mean precision@k | vs random |
| --- | --- | --- |
| Random | 9.6% | 1.00x |
| `aesthetic_score` | ~10% | ~1.0x |
| Learned direction | **16.8%** | **1.74x** |

Beats random on 10 of 13 events, up to 2.7x (Hotel Data Conference). Aesthetic
score stays at chance, confirming the earlier finding.

**Two caveats that matter more than the number:**

1. **17% precision is not "solved".** A top-40 would contain ~7 of the
   photographer's actual 40.
2. **Exact-match may be the wrong bar.** Many defensible reels exist in one
   event — pressing Refresh already produces a different-feeling set from the
   same 358 moments. "Not the same 40" is not "a bad 40". A preference test
   (would you rather deliver reel A or reel B) would measure the thing we
   actually care about; precision@k measures agreement with one person's one
   pass.

**The interesting failure:** on Foot Locker the direction scores **0.42x — worse
than random** against Claude's 40 picks. A model trained on 12 photographers'
taste actively disagrees with them. Either the picks are idiosyncratic, or a
photobooth activation is a different kind of event from headshots and
conferences (11 of the 12 training events are one or the other). Joey's picks
for the same event will separate those two explanations.

This is a floor, not a ceiling: a centroid difference is the simplest model
available. Logistic regression, per-photographer training, or a VLM judge all
have room above it.

## Algorithm shape

Mirrors an actual cull, not a leaderboard:

1. **Group into moments** — embedding similarity + capture-time proximity.
   Collapses both the burst frames and the branded twins.
2. **Rank moments** — the open question, given the scalars don't work. Leading
   candidate: learn a "highlight direction" in SigLIP space from the 742
   existing human picks (cheap — embeddings exist, no GPU, testable offline by
   leave-one-event-out cross-validation before any UI is built).
3. **Select across moments** for coverage (timeline + persons).

## Review UX

Contact sheet, not a list. Per tile:
- **Reason chip** (`sharp · eyes open · solo`) — an unexplained pick is
  unarguable, and photographers argue with picks.
- **Frame count** where the moment has siblings; click to fan out the burst and
  swap in one click. "Right moment, wrong frame" is the most common
  disagreement and must cost one click.
- **Dismiss backfills** from the next-best moment, so the requested count is the
  delivered count.

Count slider re-thresholds client-side — score once, filter locally.

## Blocking prerequisite: indexing latency (found 2026-08-11)

The experiment event sat at 0/679 indexed and Joey reported the "queuing for AI
processing" state looked stuck. Three real problems:

1. **The debounce is 15m trailing-edge**, keyed per event
   (`functions.ts` `aiIndex`) — every completed upload re-arms it, so the clock
   starts at the *last* photo. (It is 15m, not 30m; the 30 is
   `PENDING_UPLOAD_STALE_MINUTES`, an unrelated guard.)
2. **The skip path never re-arms.** If the job fires and finds pending rows it
   returns `skipped: "uploads-in-flight"` and nothing reschedules it — the next
   trigger is the *nightly* reconciler, so one slow file can cost an event its
   AI for up to 24 hours. Same failure shape as the HDC incident, different
   cause.
3. **The UI says "Queuing for AI processing" with no ETA.** A progress state
   that doesn't move for 10 minutes is indistinguishable from a hang. This is
   literally what Joey reported.

Proposed: drop the debounce to ~2m (the runtime `countPendingUploads()` check is
the real protection for uploads — the timer is a belt over suspenders), make the
skip path re-arm itself, and make the copy say what it's waiting for and when it
will start.

**This matters more once Highlights ships:** indexing latency is invisible today,
but the moment there's a generate button gated on it, every photographer feels it.

## Wired end to end (2026-08-11)

- **`src/lib/highlights/direction.ts`** — fits the highlight direction from the
  photographer's OWN past Highlights sections, excluding the target event
  (training on the event being ranked would leak the answer). Centers per event
  before differencing; scores raw, because measuring both ways showed raw is
  marginally better (22.2% vs 20.8%) — which means the existing
  `score_images_by_embedding` RPC serves it with **no migration**.
  `countTrainablePicks()` answers "is a direction available" from counts alone:
  fitting one just to answer that cost 17s cold, counting costs one round trip.
- **`src/lib/highlights/moments.ts`** — grouping (exact capture time) and
  `selectMoments()`, which buckets the timeline into `count` slices and caps any
  one person at `max(2, count/12)` so a reel can't become a portfolio of one kid.
  `coverage: false` degrades to plain top-N.
- **`src/lib/highlights/propose.ts`** — plan + propose. Every read owner-scoped;
  the `images`↔`events` join must name its constraint
  (`events!images_event_id_fkey`) because `cover_image_id` makes it ambiguous.
- **Routes**: `GET .../highlights/plan`, `POST .../highlights/propose`,
  `POST .../highlights/apply`. Apply is the one write path: it replaces
  membership, refuses ids that aren't in the event, respects `locked`, and
  invalidates the direction cache so the next event learns from this accept.
- **`HighlightsPanel.tsx`** owns the whole flow; the editor page only decides
  *when* to show it (`isHighlightsEmpty`).

Verified on the live event: plan 3.1s (679 photos → 358 moments → 272 collapsed
→ 87 people), propose 783ms warm, `ranker: "learned"`, trained on 742 picks.
Cross-tenant probe: a foreign user id returns 0 photos and 0 proposals from both
entry points. Unauthenticated requests 307 to /login.

**Known gap:** the only entry point is an EMPTY Highlights section, so once a
set is accepted the generator disappears. The re-run affordance (a mode beside
"By scene" / "Smart section", or an action on a populated Highlights section)
is not built.

## Built so far (2026-08-11)

Both surfaces are presentational components with dev playgrounds; neither is
wired into the editor yet and no API exists behind them.

- **`src/components/events/HighlightsEmptyState.tsx`** — the front door.
  Three states: reading, indexing-incomplete (blocks generation, names the
  count, shows an ETA), and ready. The ready state leads with the moment count
  as a large Playfair numeral, explains the gap to the photo count on the fact
  line, and cites the evidence behind its recommended count. Config is one
  slider and one toggle. Playground: `/dev/highlights`.
- **`src/components/events/HighlightsReview.tsx`** — the review, rendered
  **in place through the section's own `ImageGrid`**, not a bespoke contact
  sheet. Sticky proposal toolbar — **Cancel / Refresh / Accept N**, with Accept
  the only filled button — plus the count slider and a subordinate
  restore-cuts line. The bar is tinted (`stone-100`), not white, so the section
  reads as a *mode*: an in-place preview otherwise looks identical to a saved
  section, and "nothing is saved until you accept" has to be legible from the
  page rather than only from copy. Then the event's real masonry: natural
  aspect ratios, no crop, `focal_x/y` honoured where a crop does happen.
  Per-tile cut backfills from the ranked pool; the burst-swap panel overlays
  the tile so the masonry never reflows. Playground:
  `/dev/highlights/review`, driven by real frames.
  - Reuse is via one new prop on the shared grid,
    `tileOverlay?: (image) => ReactNode` — rendered as a **sibling** of the
    tile `<button>` inside a `group relative` wrapper (a nested `<button>` is
    invalid HTML and hydration-errors), with the overlay layer
    `pointer-events-none` so it never steals clicks. See lesson 82: the first
    version forked the grid, re-introduced a 2:3 crop the app never imposes,
    and dropped the focal point — cropping faces in the one surface built to
    judge photographs.

Verified end to end against real data: swap changes the badge to "3 of 4" and
propagates into the apply payload; cutting a tile keeps the count at 20 and
surfaces "restore 1 cut"; apply emits 20 `moment → imageId` pairs. `tsc` and
eslint clean.

Two deliberate honesty constraints in the UI:

- The button says **"Preview N highlights"**, never "find the best photos" —
  there is no ranker yet that could justify the stronger claim.
- Tile notes are **facts, not reasons** ("2 people"), and must never restate the
  frame badge. A chip explaining *why* a photo was chosen would be inventing a
  rationale. The `note` field is where a real ranker's explanation lands later.

**Security note:** `/dev` is on the middleware's PUBLIC list, so the review
playground's real-photo fetch is gated on `process.env.NODE_ENV === "development"`
explicitly. Gating on "is the data missing" would be true in production too and
would fail open — the same shape as the fabricated-success fallback trap.

**Refresh semantics:** a refresh is a *new proposal*, not an edit to the current
one, so the component resets cuts, frame swaps and the open panel whenever the
`proposals` array identity changes. Keeping them would silently apply last
round's edits to this round's photographs. The parent owns re-running the
generator and passes `refreshing` for the spinner.

### Polish backlog
- Cut/backfill is instant with no motion; a fade-out would make the backfill
  legible instead of a silent reshuffle.
- Tile facts (people count) were dropped in the in-place rewrite — the grid has
  no caption row. If they earn their place, they belong in the overlay.
- Refresh currently has no notion of "don't show me these again". If a
  photographer refreshes twice, the second set should probably exclude what the
  first one offered rather than re-proposing it.

## Open

- Get **Joey's favorites list** — a labeled ground-truth set from a working pro
  on this exact event turns "does this feel right" into measurable
  precision/recall, and is the only honest way to calibrate the weights.
- Default count: absolute N vs percentage of moments.
- Which coverage dimensions count — timeline, persons, scene, or some mix.
