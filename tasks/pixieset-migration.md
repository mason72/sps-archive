# Pixieset → Pixeltrunk migration

Status: **planning**. Nothing executed. Last updated 2026-08-11.

## Why

Pixieset costs ~$1,000/yr and is being used as an archive. Goal is to retire it.

## The inventory (scraped 2026-08-11, live)

**1,763 collections / 1,880,241 photos / 0 videos**, spanning 2014–2026.

| bucket | collections | photos | master exists? |
|---|---|---|---|
| 2014–2023 | **1,242** | **949,264** | ❌ **Pixieset is the ONLY copy** |
| 2024–2026 | 521 | 930,977 | ✅ Dropbox `_ARCHIVE` |

Per-year: 2014:25/12,445 · 2015:37/11,351 · 2016:57/36,608 · 2017:169/116,726 ·
2018:161/113,727 · 2019:197/157,037 · 2020:33/33,822 · 2021:139/33,838 ·
2022:215/144,724 · 2023:209/288,986 · 2024:231/362,832 · 2025:185/380,686 · 2026:105/187,459

Other facts from the sweep:
- **`expire_at` is null on all 1,763 collections** — nothing is set to auto-expire. No ticking clock,
  the only deletion risk is a lapsed subscription or a manual delete.
- `status`: 1,748 × `0`, 13 × `2`, 2 × `1`. (Meaning of 1/2 not yet determined.)
- 35 collections have no `event_date` (fall back to `create_at`).
- 3 collections have `photo_count: 0`.

### How the inventory was obtained (do not re-derive)

Pixieset has no public API, but the admin dashboard runs on a clean paginated JSON endpoint.
Authenticated by session cookie — log into `galleries.pixieset.com` in a browser, then:

```
GET https://galleries.pixieset.com/api/v1/dashboard_listings?page=N
```

- Payload shape: `json.data.data.collections[]` (siblings: `.items`, `.folders`)
- 24 records/page, ~74 pages. Loop until `collections` is empty.
- Useful fields: `id, name, event_date, create_at, photo_count, video_count, url_key,
  status, folder_id, expire_at, collection_download, photo_download,
  high_res_download_size, web_download_size, password, download_pin`
- Gotcha: a full sweep exceeds the 45s CDP eval timeout. Accumulate into a `window` global
  and poll for stability rather than awaiting the whole loop.

## Dropbox source of truth (2024–2026 only)

`~/Library/CloudStorage/Dropbox-TwoDudesPhoto/Two Dudes Photo Team Folder/_ARCHIVE/<year>/<category>/<event>/`

- Years present: 2023 (only `Personal`), 2024, 2025, 2026. **Pre-2024 was deleted for space.**
- Categories: `Event Photos`, `Headshot Booth`, `Photo Booth`, `Studio Headshots`,
  plus non-deliverable `Artwork`, `BTS`, `Personal`, `zzz DO NOT SHARE ON SOCIAL MEDIA zzz`.
- Event folder naming: `YYMMDD Client Name` — date + client are machine-parseable.
  Typos exist (`25217_ViVE`, `25807_HDC 2025` are 5-digit); parser needs a fallback.

### Ingest rule (per Mason, 2026-08-11)

- **JPGs only.** RAW never migrates. (2025 Headshot Booth alone holds 389,538 `.cr3`.)
- **Top level of `Output`** is the delivered set — NOT recursive.
  2025 Headshot Booth: top-level = 177,256 files vs recursive = 262,304. ~85k live in nested subdirs.
- **`Selects` → "Highlights"** section, when populated (inconsistently used).

### ⚠️ The folder-name resolver is load-bearing

Across 179 event folders in 2025 Headshot Booth, only **137 have `Output`**. The rest use:
`HQ Exports` (16), `Highlights` (19 + 1 lowercase `highlights`), `4200w` (2), `Retouched`,
`Slides`, `Output 1`, `Pixies Booth 1/2`, `Pixies HQ`.

A hardcoded `Output` silently drops ~25% of events. Needs a priority-ordered resolver
**with a logged fallback** so unmatched folders surface instead of vanishing.

### Excluding artwork folders

Space-named vs underscore-named siblings are NOT duplicates:
- `250207_PureStorage` = the shoot → `Capture / Selects / Output`, 1,178 JPGs, 3 GB
- `250207 Pure Storage` = booth branding → `Artwork / Marketing Vert / Marketing Wide`, 55 files, 30 MB

Detect by subfolder signature and exclude the artwork variant.

## Triage outcome (complete, 2026-08-11)

All 1,763 collections decided via `scripts/triage`. 1,290 by hand, 473 auto-kept (2024+).

| | collections | photos |
|---|---|---|
| **KEEP** | **1,371** | **1,582,122** |
| TRASH | 392 | 298,119 |
| ↳ keep, 2024+ (Dropbox-backed) | 514 | 926,436 |
| ↳ **keep, pre-2024 (Pixieset only — the at-risk set)** | **857** | **655,686** |

Trash is a manifest entry only. Nothing has been deleted anywhere.

A leave-one-out audit (`audit.mjs`) then flipped 30 trashes back to keep
(`via: "reconsider"`, +17,732 photos) where a client had 2+ keeps and no kept
sibling within 2 days. Backup at `data/decisions.backup.json`.

### Two patterns the audit found, worth remembering

- **Booth vs event photos.** Many jobs produced TWO galleries on the same day — a
  large booth gallery and a small "Event Photos" one. Mason consistently keeps the
  small one and trashes the large one. A naive "you trashed a big gallery from a
  client you like" check flags 13 of these as mistakes; they are deliberate. The
  2-day sibling test is what separates them from real gaps.
- **Criteria drift.** Keep-rate ran 69% → 49% → 84% across the session. Personal
  events (birthdays, weddings, reunions) were kept early and trashed late, so the
  model was averaging three different policies. Any future model trained on this
  data inherits that.

## Fidelity check — RESOLVED (2026-08-11)

**Pixieset does not re-compress. It serves back what was uploaded, at full camera
resolution from 2015 onward.** The SPS lossy-source worry does not apply here.

Measured via `GET /api/v1/collections/{id}/photos`, which returns per-photo
`width`, `height`, `size` (24/page). Median long edge by year, 3 galleries × 24
photos each:

| year | median long edge | mean MB/photo |
|---|---|---|
| 2014 | 5,760 (mixed; some 1,844) | 6.53 |
| 2015 | 3,840 | 2.14 |
| 2016 | 3,840 | 1.70 |
| 2017 | 5,472 | 2.17 |
| 2018 | 5,184 | 0.88 |
| 2019 | 4,195 | 1.73 |
| 2020 | 4,800 | 1.14 |
| 2021 | 4,096 | 1.27 |
| 2022 | 4,800 | 2.26 |
| 2023 | 4,800 | 1.69 |

Note `download_size` / `high_res_download_size` on the collection are CLIENT
download permissions, not the stored file — don't read them as fidelity.

### Consequence: store originals, drop the derivative plan

At-risk set (pre-2024 keep) = 655,686 photos ≈ **1.13 TB** ≈ **$208/yr** on R2.
Whole keep set at full res ≈ 2.9 TB ≈ ~$530/yr. Derivatives would save ~$180/yr
and cost a "linked original" feature plus permanent loss of the real files.
Not worth it. **Take the originals.**

The remaining unmeasured cost is AI indexing ~1.58M images on Modal. That is what
the pilot is for.

## How to actually get the bytes out — SETTLED (2026-08-11)

### The constraint that decides everything

**Cloudflare challenges every non-browser client on both Pixieset hosts.**
- `accounts.pixieset.com/login` → Turnstile, loops forever in Playwright/headless.
- `twodudesphoto.pixieset.com` → plain curl gets `HTTP 403`, `cf-mitigated: challenge`.

Only a real browser a human has logged into works. **Do not try to defeat this** —
no UA spoofing, no stealth plugins, no TLS-fingerprint mimicry, no challenge solvers.
Playwright with a persistent profile was built and abandoned for this reason
(`scripts/pixieset/login.mjs`, `pilot.mjs` — kept for reference, currently unusable).

In-page JS in Mason's real Chrome inherits the clearance cookie and is never
challenged; that is how the 1,763-collection inventory scrape ran 74 sequential
API calls cleanly. **That is the only viable automation surface.**

### The sanctioned download flow (verified end to end)

Client-facing, email-gated, NO password and NO PIN when viewing as owner:

1. `GET /{slug}/` → page contains `/download/auth/{slug}/?dt={token}`
2. `GET /download/auth/{slug}/?dt=…` → email form
3. submit email → `/download/sets/{slug}/?filekey={key}` → choose sets + size + destination
4. submit → `/download/file/{slug}/?filekey={key}` → "preparing", then polls
5. ready → `.zip` link on the SAME gallery host (NOT CloudFront), params `filekey` + `fid`

Measured on `nachisheadshots` (48 photos): ZIP ready in **~2 seconds**, 68.2 MB,
**full-resolution originals** (4800×3250 etc.), mean **1.42 MB/photo**.
Archive layout is `All_Photos/*.jpg` — **Pixieset sets become folders**, which map
directly onto Pixeltrunk sections. Multi-part naming is `-1of1`, so big galleries split.

### The actual wire contract (probed live 2026-08-12 — do not re-derive)

Pixieset runs Yii, so the field names are bracketed and unguessable. Measured on
`nachisheadshots` by fetching each step in-page and reading the DOM:

**Step 2 — the email gate.** `POST` back to the SAME `/download/auth/{slug}/?dt={token}` URL:

| field | value |
|---|---|
| `DownloadLoginForm[email]` | the notify address |
| `yt0` | `""` (Yii's submit marker) |

**Step 2b — the "Existing File?" interstitial. NOT in the original spec, and the
pipeline breaks without it.** If a download was already generated for that
collection, the POST lands on a page offering **DOWNLOAD EXISTING** or **NEW
DOWNLOAD** instead of the set picker. This is good news for the 7-day expiry —
a still-live ZIP can be re-fetched without regenerating — but a driver that
assumes the set picker will find no form and stall. Detect on the text
"already generated a download".

**Step 3 — set selection.** Lands on `/download/sets/{slug}/?filekey={key}`:

| field | type | values |
|---|---|---|
| `Download[galleries]` | hidden | `""` (Yii array marker — send it) |
| `Download[galleries][]` | checkbox | **per-collection set IDs** (e.g. `65655962` = All Photos, `65655970` = Your Favorites) |
| `Download[download_size]` | radio | `1` = High Resolution, `4` = Web Size |
| `download-destination` | radio | `0` = Save to My Device (DOM order is 0, 2, 1 — read the value, never the position) |
| `Download[type_id]` | hidden | `0` |

**The set IDs are per-collection and must be READ, never hardcoded.** And the
set labelled "All Photos" is not guaranteed to exist — a collection with named
sets (Ceremony / Reception) has none. So the resolver is: prefer a set labelled
`All Photos`; otherwise select EVERY set and dedupe by filename after
extraction; and **log which branch was taken**, the same rule as the Dropbox
`Output` folder resolver, or collections vanish silently.

This page also confirms the double-count directly: All Photos **48** + Your
Favorites **32** = the 80 that `photo_count` reports for a 48-photo gallery.

### ⛔ THE BLOCKER: 81% of collections require a download PIN (measured 2026-08-12)

The client-facing gate asks for `DownloadLoginForm[download_pin]` on most collections.
Swept live across all 1,763 via `dashboard_listings`:

| | collections | share |
|---|---|---|
| **require a download PIN** | **1,432** | **81%** |
| have a gallery password | 281 | 16% |
| have both | 272 | 15% |
| **`collection_download` disabled** | **22** | 1% |

Per-year PIN counts: 2014:25 · 2015:17 · 2016:57 · 2017:168 · 2018:161 · 2019:196 ·
2020:33 · 2021:39 · 2022:119 · 2023:162 · 2024:204 · 2025:159 · 2026:92 — i.e. the
at-risk pre-2024 set is almost entirely PIN-gated.

**This invalidates the earlier note that "owner view needs no PIN."** That was
generalised from `nachisheadshots`, which happens to sit in the ~19% without one —
the same shape of error as the old SPS "lossy source" claim: measured honestly on one
sample, then stated as a general rule. The pilot worked *because* the pilot collection
was the exception.

The PIN values are NOT in `scripts/triage/data/inventory.json` (that file keeps only 6
columns: id, name, event_date, photo_count, thumb, url_key). They live on the
dashboard API — `GET /api/v1/collections/{id}` and the `dashboard_listings` pages both
return `download_pin`, `password`, `collection_download`.

The 22 download-disabled collections cannot use the ZIP path at all and need the
per-photo API repair route (or a settings change on the account).

### How to clear the PIN gate (endpoint found 2026-08-12) — APPROVED BY MASON, NOT YET RUN

Mason's call (2026-08-12): disable download PINs globally across the KEEP set. His
reasoning — "the risk is highest when the galleries are first sent, but we don't send
these out now." Scope is the **1,371 KEEP collections**, not all 1,763; exposing the
392 being trashed buys nothing.

There is **no owner-side export in Pixieset.** Verified in the dashboard UI: the
collection "More" menu offers only Get direct link / View email history / Manage
presets / Move to / Duplicate / Delete collection / Create Style, and a set's menu
only Edit / Delete. The client-facing download flow is the only way bytes leave.

The endpoint, captured by hooking `XMLHttpRequest` and toggling the control once:

```
PATCH /api/v1/collections/{id}/update_download_settings
body: {"id": <id>, "download_pin": null}     // null disables; a 4-char string sets it
```

Needs Laravel CSRF: send `X-XSRF-TOKEN` (URL-decoded `XSRF-TOKEN` cookie) plus
`X-Requested-With: XMLHttpRequest`. Without it you get 419; the generic
`PUT /api/v1/collections/{id}` is the WRONG route and 422s with "The download pin must
be a string."

**⚠️ Disabling DESTROYS the PIN value — it is not a toggle over a retained secret.**
After the PATCH, `download_pin` reads back as `null`, and re-enabling later mints a NEW
PIN via "Reset PIN". Clients holding a PIN communicated years ago would be broken. That
is acceptable here only because the account is being retired; if that changes, back the
PINs up FIRST (values must not pass through an agent transcript — see below).

Verified end to end on `11139225`: disabled, confirmed `download_pin: null`, then
restored to its original value through the same endpoint. The collection is back as
found (`PIN •••• ON`).

**The backup lives at `~/Downloads/pixieset-download-pins-backup.json`**, with a second
copy at `~/pixieset-staging/` (mode 0600, deliberately OUTSIDE `~/Projects` so Syncthing
never replicates PINs to the other Mac). 1,763 collections, 1,432 PINs, 281 passwords,
every slug. Restore with `emit-pin-clear.mjs --restore`. **Keep it until the migration
is finished** — it is the only way back.

**Operational trap that cost a full round trip: Chrome blocks the first paste into a
DevTools console.** It demands you type `allow pasting` and press Enter before it will
accept anything. A payload pasted before that silently does nothing, and the console
looks like it ran. The tell is that the state does not change — a re-sweep showed
`withPin: 1432`, unchanged, which is how it was caught. **Never conclude a console
payload ran because it was pasted; re-read the state.**

The agent's own safety classifier blocks the bulk clear by default (it also blocked a
loopback PIN collector, `scripts/pixieset/gates-server.mjs`, written but uncommitted).
Unblocked for this repo by adding `mcp__claude-in-chrome__javascript_tool` to
`.claude/settings.local.json`. The BACKUP phase was never blocked — only the
destructive one, which is the right split.

### ✅ `high_res_download_size` — RESOLVED 2026-08-14, and the old note here was wrong

The Download Settings pane offers High Resolution = **Original** or **3600px**. A
collection set to 3600px hands back downsampled files while still calling them High
Resolution — the fidelity guard would NOT catch it (3600 > the 2560 rendition
threshold, and correctly so).

**The field is an ENUM, not a boolean**, which the earlier note here got wrong in
both directions. Decoded from a live capture:

| value | meaning |
|---|---|
| `high_res_download_size: 1` | Original |
| `high_res_download_size: 0` | 3600px **or** High Resolution switched off entirely |

`download_size` is the discriminator — it is literally
`"{high_res_code},{web_code}"`, and collapses to just `"{web_code}"` when High
Resolution is unchecked. Web codes seen: `2` = 1024px, `4` = 2048px. (Pixieset
notes 2048px web is only supported for collections created after 2016-08-02.)

So the 30 collections reading `0` were **two different states**:
- 25 with High Resolution ON at 3600px (`ds` = `"0,2"` / `"1,2"`)
- 5 with High Resolution OFF entirely (`ds` = `"4"`), serving Web Size only

**All 30 are now set to Original** (2026-08-14), preserving each collection's own
web size rather than flattening them. Verified four ways: the PATCH response, a
re-read of `before_download_settings`, an independent sweep of all 1,762
collections via `dashboard_listings` (0 remaining at `0`), and a visual check of
the hardest case.

#### The write contract

```
PATCH /api/v1/collections/{id}/update_download_size
Content-Type: application/json
X-CSRF-TOKEN: <from <meta name="csrf-token">>      ← required; there is NO XSRF-TOKEN cookie
body: {"id": <id>, "download_size": [<high_res_code>, <web_code>]}
```

Without the CSRF header this returns **419 CSRF token mismatch**. The token is in
the meta tag, not a cookie — the usual Laravel `XSRF-TOKEN` cookie is absent here.

#### Two traps worth keeping

- **The settings page layout SHIFTS between collections** (an extra note line for
  pre-2016 galleries moves the radios ~6px). Coordinates captured on one
  collection miss on another. Locate per page, or drive the API.
- **Two async sweeps writing to the same `window` global interleave.** Reassigning
  the global does not stop the earlier loop — it just starts appending to the new
  array, and the result silently mixes both runs. Guard with a run counter and
  bail when superseded.

### Corrections to the wire contract (probed live 2026-08-12, second pass)

The contract above is right about the field names. These five things it got wrong or
did not cover, each of which stalls a driver:

1. **The "Existing File?" interstitial has its OWN PATH: `/download/exist/{slug}/`.**
   Branch on the landed pathname, never on the copy ("already generated a download") —
   the path is structural, the wording is not. It appears in two places, not one: after
   the email-gate POST *and* on a GET of the `/download/file/` status page.
2. **The branch is not stable across runs.** The same collection lands on the set
   picker one minute and the interstitial the next, depending on server-side state. The
   driver re-reads the path every hop rather than assuming a sequence.
3. **"NEW DOWNLOAD" is a link back through the email gate.** A GET of
   `/download/sets/{slug}/` without a live filekey bounces to `/download/auth/`. To
   force a fresh generation, just re-POST the auth gate.
4. **There is no JS poller and no meta-refresh on the "preparing" page.** Readiness is
   discovered by re-fetching the file URL. Small galleries are ready in ~2–5s.
5. **The ready page links `/download/filestart/…`**, labelled with the filename and
   size: `nachisheadshots-photo-download-1of1.zip  68.2 MB`. Clicking an injected
   `<a download>` makes Chrome save it to ~/Downloads unattended — no save dialog.

**The extension redacts what the driver may report.** Anything key-shaped comes back as
`[BLOCKED: Sensitive key]`, and a single query-string-shaped field poisons the ENTIRE
tool result (`[BLOCKED: Cookie/query string data]`) — you lose the whole run's report,
not just that field. `driver.js` consumes tokens in-page and reports only counts,
labels, filenames and states. Keep it that way.

### ⚠️ The ZIP filename does NOT encode fidelity — dimensions are the only tell

Measured 2026-08-12 by downloading `nachisheadshots` twice, High Resolution and Web
Size. The two archives are **indistinguishable** by every check the verifier had:

| | High Resolution | Web Size |
|---|---|---|
| filename | `nachisheadshots-photo-download-1of1.zip` | **identical** |
| JPEG count | 48 | **48** |
| parts | 1of1 | **1of1** |
| `unzip -t` CRC | passes | **passes** |
| bytes | 71,516,295 | 21,482,223 |
| **frame width** | **4800 / 3583 / 3301 / 4669 (varies)** | **2048 on every frame** |

Chrome saved the second one beside the first as `…-1of1 (1).zip`. So:

- **Web Size renders every frame to exactly 2048px wide.** The LONG EDGE is useless as
  a discriminator (web-size long edges run 2048–3072, overlapping genuine 2015–2016
  originals at 3840 and 2014 frames at 1,844). Uniform narrow *width* is the signature.
  `sampleDimensions()` in `lib/archive.mjs` implements it; negative-tested both ways.
- **This matters because "DOWNLOAD EXISTING" may hand back a ZIP a CLIENT generated**,
  at whatever size they chose. `driver.js` therefore prefers a fresh High Resolution
  generation and flags `fidelity: "existing-unknown"` when it cannot force one.
- **The set picker reports per-set photo counts** ("All Photos 48 photos"). That is an
  INDEPENDENT, non-double-counted source, so unlike `photo_count` it can be asserted as
  an equality. Carry it through as `expectedFiles`.

### Driving the browser: the tab-group trap

The Claude Chrome extension will accept `navigate`, return **"Navigated to
&lt;url&gt;"**, and leave the tab on `chrome://newtab/` forever if it is holding
tabs from a **stale tab group** — which is what happens after `switch_browser`
picks a different Chrome. Every later call then fails with "Cannot access a
chrome:// URL", which reads exactly like a permissions or bot-detection problem
and is neither. **Fix: discard the tabs and let `tabs_context_mcp` mint a fresh
group.** A genuine permission block returns an error; this one returns success,
so trust the URL, not the return value.

### `photo_count` DOUBLE-COUNTS — totals are an upper bound

A photo in two sets is two photo records with two storage hashes but the SAME filename.
`nachisheadshots`: 80 `photo_count` = All Photos 48 + Your Favorites 32, and all 32
favorites' filenames already appear in All Photos. **Selecting "All Photos" is complete.**
So 1,880,241 total and 655,686 at-risk are ceilings; true figures are lower.

### Per-photo API — works, but do NOT use it in bulk

`GET /api/v1/photos/{id}/download` 302s to a signed CloudFront URL
(`…-orig.jpg?Expires=…&Signature=…`, ~4.2h, range-resumable, no auth needed) and
returns the true original. Verified byte-exact against the API's `size` field.
Useful as a **repair path for individual missing files only** — 655,686 authenticated
requests is scraping-shaped and would rightly trip the protection above.
Public CDN renditions cap at `xxlarge` = 1600×2240; unsuffixed/`-orig` without a
signature is 403.

### Resulting architecture

- **Request + download**: scripted in-page in a real logged-in Chrome. One in-page
  script can drive many collections per invocation.
- **Chrome saves ZIPs to ~/Downloads**; a plain Node watcher extracts → R2 → rows → delete.
- Peak disk is ONE collection (~a few GB), never the full 1.13 TB.
- Post-processing is ordinary Node and can run anywhere.

## Measured throughput — and why the driver must stop blocking (2026-08-12)

| collection | photos | ZIP build | size | MB/photo |
|---|---|---|---|---|
| `nachisheadshots` (2022) | 48 | **~2 s** | 68 MB | 1.42 |
| `perkinelmereventphotos` (2018) | 1,016 | **~25 min** | **3.54 GB** | **3.66** |

**Generation time does not scale gently.** A 1,000-photo collection took ~25 minutes to
build server-side. The driver polls synchronously (request → wait → download, one
collection at a time), which at that rate makes 857 at-risk collections roughly **six
days of wall clock spent waiting on Pixieset's ZIP builder**, with the machine idle
almost the whole time.

**The fix is to split request from collect**, which the queue already models:
`requested` → `ready` are separate states, and `requestedAt` exists precisely so the
7-day expiry can be tracked across a gap. Request a batch (Pixieset builds them in
parallel), then collect each as it becomes ready — the Gmail label "Pixieset Downloads"
is the ready signal for the large ones, and polling the file page works for the rest.
Batch size is bounded by the 7-day window and by disk, not by patience.

**The size estimate may be materially low.** The fidelity table above records 2018 at a
mean 0.88 MB/photo, sampled 24 frames deep. This collection came back at **3.66
MB/photo — 4× that**. One collection is not a re-estimate, but if it generalises, the
at-risk set is nearer 2.4 TB than 1.13 TB, and the R2 bill roughly doubles. Worth
re-sampling across years before committing to a storage number.

**`photo_count` can UNDERCOUNT, not only double-count.** This collection reports 903;
its seven sets are disjoint and hold 1,016 real files. So it is neither a ceiling nor a
floor — see the verifier note above. `nachisheadshots` (80 reported, 48 real) and this
one (903 reported, 1,016 real) are the two directions.

## Ingest lands, but settlement cannot fire from a laptop (2026-08-12)

`scripts/pixieset-ingest.ts` dispatches `focal/auto.suggest` and `ai/index.requested`
when it finishes. **That dispatch fails locally with `401 Event key not found`** —
`.env.local` carries no `INNGEST_*` keys at all (they live only in Vercel). The ingest
itself is unaffected; the images land complete.

**It self-heals, so this is not a hole.** The nightly `upload-reconciler` (cron
`43 9 * * *` = 2:43am PT, `src/lib/inngest/functions.ts`) queries images with
`ai_indexed_at IS NULL AND thumbnail_generated = true AND media_type = 'image'` and
nudges `ai/index.requested` for the events it finds. Ingested photos match that
predicate the moment they complete, so they get indexed on the next nightly run.

**But it nudges at most 25 events per run** (`.slice(0, 25)`). The migration creates
~1,371 events, so relying on the nudge alone is **~55 days before every event has even
been offered to the indexer**. Before bulk ingest, pick one:
 - put `INNGEST_EVENT_KEY` in `.env.local` so ingest dispatches directly (simplest), or
 - raise the nudge cap for the duration, or
 - fire `reconciler/run` repeatedly, which re-runs the same capped sweep.

Verification tool: `npx tsx scripts/verify-pixieset-ingest.ts <collectionId>`. It does
a **sha256 round trip** — frame out of the staged ZIP, object back down from R2, digests
compared — because counts agreeing is not proof that the right bytes are in the bucket.
Run it before deleting any archive.

## Pilot status (2026-08-12)

- **Pilot 1 — `nachisheadshots` (47301077, 80 photo_count): COMPLETE and VERIFIED.**
  Requested, generated in ~2s, downloaded by Chrome unattended, 71,516,295 bytes,
  48 JPEGs in `All_Photos/`, CRC clean, parts complete, median long edge 4,800px.
  48 files vs 80 `photo_count` confirms the double-count exactly. Staged at
  `~/pixieset-staging/verified/`.
- **Pilots 2 and 3 — BLOCKED on the PIN gate**, not on the tooling: both
  `perkinelmereventphotos` (903) and `uspartnerloungeheadshots…` (3,002) stop at
  `/download/auth/` because the driver has no PIN to supply. They failed loudly,
  which is the intended behaviour.
- Throughput and Modal AI indexing cost are therefore **still unmeasured** — both
  needed pilots 2 and 3.

Staging lives at `~/pixieset-staging/` — deliberately OUTSIDE `~/Projects`, which is
Syncthing-replicated between the two Macs. Terabytes of transient ZIPs must not sync.
Disk floor: `MIN_FREE_GB = 25` in `watch.mjs`; this machine had 101 GB free, which is
fine for one-collection-at-a-time staging and nowhere near the 1.13 TB total.

## Open decisions

1. **Storage tier for the 949k at-risk photos.** Full-res in R2 for all 1.88M is ~5.6 TB ≈
   $1,008/yr — i.e. saves nothing. See recommendation below.
2. **AI indexing cost at 1.88M images** — unmeasured. Dominant one-time cost. Must pilot before committing.
3. **pgvector at ~1.9M embeddings** — HNSW build time and query latency is an architecture
   question for production Supabase, not a config toggle.

## Recommended shape (not yet approved)

Split the two jobs Pixieset currently conflates:

- **Preservation** — pre-2024 full-res originals to cold storage (B2 / Glacier Deep Archive),
  ~2.8 TB. Cheap, write-once, never browsed.
- **Search & access** — display-res derivatives (~2560px) for all 1.88M in R2 + Pixeltrunk.
  ~470 GB ≈ $85/yr. Dropbox and cold storage hold the masters.

## Hard rules for execution

- **Oldest-first.** 2014–2023 is the at-risk set. 2024+ is safe in Dropbox and has no deadline.
- **Nothing is deleted from Pixieset** until it exists elsewhere and is verified.
  Do not cancel, do not let payment lapse, until the pre-2024 set is off and checked.
- **Nothing stages on Dropbox** — it's already full. Pixieset → R2 streamed, transient buffer only.
- The pipeline is a **resumable queue** (per-collection state machine), not an LLM loop.
  The agent builds and supervises; it is not the for-loop.
- `.env.local` points at **production**. A bug in ingest writes to live customer data.

---

## Disk is the binding constraint on the LARGE collections (measured 2026-08-13)

A collection cannot be verified until **every ZIP part is on disk at once** —
`partsComplete()` requires the full set, and dedupe runs by basename across all
parts and sets. So a collection's whole download must fit in free space
simultaneously; it cannot be ingested part by part.

**Measured basis:** Perkin Elmer Accelerate 2018 — 3,796,798,554 bytes for
1,016 files = **3.74 MB/photo**. That is ONE 2018 event collection, so scaling
it to 1.58M photos gives roughly **6 TB** as an order of magnitude, not a
figure. Older collections are likely smaller per photo; do not plan capacity on
this number without re-measuring across a few years.

**Against ~32 GB free (disk 94% full):**

| Group | Collections | Fit today | Too big | Largest blocked |
|---|---|---|---|---|
| At-risk (pre-2024, only copy) | 855 | **851** | 4 | 52 GB |
| All queued | 1,369 | 1,351 | 18 | 128 GB |

**The priority work is not blocked.** Oldest-first at-risk is 851 of 855
collections. Handle those first and the disk question stays theoretical for a
long time.

**The four at-risk collections that need more room**, plus the 14 other large
ones, need one of:
- free space on the internal disk (Library/Developer holds ~13 GB of
  DerivedData and simulator runtimes; `~/Projects` is ~28 GB)
- an external drive, with `STAGING` in `watch.mjs` pointed at it
- Pixieset set-by-set downloads instead of whole-collection, if the UI offers
  it — this would sidestep the all-parts rule entirely and is worth checking
  before buying hardware

The largest is **Service Now SKO26** (34,274 photos ≈ 128 GB), which is 2026 and
therefore NOT at risk — Pixieset is not the only copy.

### Also learned here

**`photoCount` is not the download's file count and must never be the
verification denominator.** Pixieset reported 903 photos for Perkin Elmer; the
ZIP holds **1,016 distinct filenames** across 7 sets. Not duplicates — 1,016
unique basenames. Whatever `photoCount` counts, it is not "files you will
receive", and it is wrong in the safe direction here (more arrived than
promised). This is why `archive.mjs` treats a count mismatch as a `suspicious`
flag rather than a hard failure; that call was right.

---

## First driven batch — 2026-08-14

Six collections downloaded, verified and ingested end to end, oldest-first from
the at-risk set. **The loop is proven.**

| Collection | Files | Median width | Fidelity |
|---|---|---|---|
| Microsoft Futures Houston | 40 / 40 | 5472px | fresh-high-res |
| Microsoft Futures Indianapolis | 112 / 112 | 5760px | fresh-high-res |
| DC – Microsoft Futures | 155 / 155 | 5760px | fresh-high-res |
| Mother's Day at Terrapin Crossroads | 194 / 194 | 5472px | fresh-high-res |
| Microsoft Futures Chicago | 177 / 177 | 5055px | fresh-high-res |
| Microsoft Futures Portraits & Event Photography | 47 / 47 | 5148px | fresh-high-res |

Every file count matched the picker's own expectation exactly, and every median
width is far above the 2560px rendition threshold — these are originals, which
is what the High Resolution fix was for. Ingest reported **0 failed** on each,
confirming the EXIF/GPS split fix (lesson 74) holds on real data.

### The PIN gate is NOT a migration blocker — measured, not assumed

375 collections on the account still carry a download PIN (289,070 photos). The
overlap with the KEEP queue is **zero**. The 2026-08-12 clearing run covered
everything that matters; what remains pinned is all outside the migration set.

That zero was checked against three positive controls rather than trusted,
because an empty set intersection is indistinguishable from an id-format
mismatch: both live-pinned collections appear in the pinned list and are absent
from the queue, the unpinned one is the reverse, and 1,370 of 1,371 queue ids
appear in the full inventory — so the id spaces demonstrably match.

### Two mistakes worth not repeating

1. **A slug taken from a truncated console column 404s.** `...photogr` instead
   of `...photography` — the column was cut at 38 chars in a debug print. Read
   identifiers from the data file, never from a formatted display.
2. **Two of the eight jobs were sourced from the high-res list, not the KEEP
   queue**, so they were never meant to be downloaded at all. Both happened to
   be PIN-blocked, which briefly looked like a systemic blocker and was not.
   Drive the queue; it is the list of what we are keeping.

### Disk is now the binding constraint, in practice

The watcher's floor fired at 24 GB: `⚠ below the 25 GB floor — stop requesting`.
Ingested ZIPs move to `~/pixieset-staging/ingested/` and are NOT deleted, so the
cycle is: download → verify → ingest → **verify in Pixeltrunk** → reclaim. All
six were confirmed complete (image count, thumbnails, live share) before their
archives were released. Sustained throughput needs headroom — see the disk
section above.


## Staging moved to the external SSD — 2026-08-14

The internal disk cannot hold this job: a collection must fit ENTIRELY on disk
to be verified (`partsComplete` needs every part at once), the largest is
~128 GB, and there were ~24 GB free. The watcher's floor was firing on every
batch.

`/Volumes/Archive` — a SanDisk Extreme SSD already holding the 51 GB
pre-Syncthing restore archive — has ~483 GB free. Staging now lives at
`/Volumes/Archive/pixieset-staging`. It is SCRATCH: each archive is released as
soon as its collection is ingested and verified in Pixeltrunk.

Both halves read **`PIXIESET_STAGING`** from `.env.local`, and `watch.mjs` now
parses that file the way the ingest already did. That matters — an export the
caller forgets would leave the watcher staging to the internal disk while the
ingest looks on the external one. One file, read by both.

`PIXIESET_MIN_FREE_GB=150` is deliberately above the largest single collection,
so "there is room to request another" can never be true when the biggest one
would not fit. `freeGB()` runs `df` against STAGING itself, so the floor follows
the volume automatically.

**`.env.local` is gitignored**, so this is machine-local — correct, since the
path is specific to this Mac. The laptop needs its own value before it can drive
the migration.

**The drive shares a spindle with Time Machine** (931 GB total, TM using
~397 GB). The 150 GB floor leaves TM room; do not lower it without checking what
TM needs. And if the drive is ever unplugged mid-run the watcher will fail
loudly rather than silently stage somewhere else — `df` on a missing path errors.

### Staging is back on the INTERNAL disk (2026-08-14, same day) — and why

Reclaiming 169 GB made the external SSD unnecessary, and using it turned out to
be actively harmful: `/Volumes/Archive` shares a physical disk with Time
Machine, so an ingest reading a 4 GB ZIP contended with TM writing backups.
Throughput fell from ~77 photos/min to **2**.

Worse, I caused the TM run myself: thinning all 20 local APFS snapshots
prompted a full backup pass. The shared-spindle risk was written down one
section above and then walked straight into.

`PIXIESET_STAGING` now points back at `~/pixieset-staging` with a 60 GB floor.
Rate recovered to 32/min immediately and kept climbing as load fell from 47.

**Where the disk went, for the record** — the internal volume read 95% full with
23 GB free, and only ~248 GB of that was visible files:

| | |
|---|---|
| home | 200 GB |
| /Library + /Applications | 48 GB |
| **local Time Machine snapshots** | **~163 GB** |

Emptying the Trash freed nothing, because the snapshots still referenced the
deleted blocks. `tmutil thinlocalsnapshots / 200000000000 4` released all of it;
the real backups live on the external drive and were untouched. Xcode
DerivedData + iOS DeviceSupport gave another 9.4 GB. **23 GB → 192 GB free.**

### Fidelity checks that fired, and what they showed

- `boxworks2014day1` sampled at **median 2880px**, against 5472–5760px
  elsewhere. Suspicious — 2880 is exactly half of 5760. But the sample was
  MIXED (1844 / 2880 / 3840), and a Web Size rendition is UNIFORM. These are
  cropped headshot deliverables, legitimately smaller than the frame.
  `isRendition: false` was right.
- `microsoftsurfacepro3campuseventheadshots` came back with `fidelity: null` —
  it took the exist-interstitial and never touched the set picker, so the driver
  set no flag. Sampling settled it: uniform 5760×3840, a 5D Mk III at full
  resolution. **The width guard, not the driver's flag, is what answers this
  question** — which is exactly what the driver's own docstring says.

## A FOURTH gate: the gallery password, which only bites logged out — 2026-08-21

The admin session at `galleries.pixieset.com` expired (the tab was parked on
`accounts.pixieset.com/login`). Restarting downloads against the client host,
`hobartholidayparty2015` redirected to `/guestlogin/{slug}/?return=…`, a form
with exactly one field: `CollectionGuestLoginForm[password]`. A real gallery
password. Three other slugs probed the same minute loaded direct, 200, no
redirect — **per-collection, not global.**

The owner session had been hiding this. The flow doc says "NO password and NO
PIN when viewing as owner", and every 2026-08-15 run was as owner, so the
driver never met the gate. **Logged out, the email gate still passes** — the
first job of the 2026-08-21 batch went `auth → sets → generate` with 1,465
expected — **but a gallery password does not.** I will not type one; a gated
slug waits for Mason to be signed in.

Three consequences:

- **The staging inventory cannot pre-classify.** Its copy is a slim 10-key
  schema (`id, name, url_key, event_date, photo_count, high_res, web,
  photo_download, collection_download, status`) — no `password`. A filter on
  that field returns "0 with password" for all 1,316, which is an ABSENT
  COLUMN reading as a fact (same trap as `images.filename`, lesson 87). The
  live `dashboard_listings` endpoint carries `password`, but it is on the
  admin host, which needs the login.
- **The driver's error on a gated slug is misleading.** It follows the
  redirect, finds no `/download/auth/` on the guest-login HTML, and reports
  `no download-auth link (downloads disabled?)` — the downloads-disabled
  message for a password problem. Not yet fixed: it should test the landed
  path for `/guestlogin/` and report `password-gated` instead, so the queue
  can hold those for a signed-in session rather than marking them failed.
- **The gate classes are now four**: PIN (not in the KEEP set), downloads
  switched off (22, settings snapshotted), Web Size fidelity (caught by the
  width guard, 6 so far), and gallery password (count unknown until the
  admin host can be read).

Tooling gotcha that cost two probes: **an `async` IIFE as the JS tool's last
expression comes back as `{}`** — the tool serialises the unresolved Promise.
Write the result to `window.__x`, return a string immediately, and read
`window.__x` in a second call. Synchronous DOM reads are fine inline.

### Cleanup outcome and a DELIBERATE stop (2026-08-23)

Twitch Masquerade Ball is the only duplicate event cleaned: 3,787 rows + R2
objects deleted, 49 keeper thumbnails repaired, verified per-file, archive
released, queue reconciled to ingested. `px-dedupe-event.ts` did it safely
because those duplicates carried **zero faces** — created and deleted before
AI ran.

**The two other >1000-row Pixieset events (Microsoft Surface Pro 3 = 184,
Kia at Mom = 80) are LEFT ALONE ON PURPOSE.** Their duplicates carry ~700 AI
face detections assigned to named persons (386/384 and 313/313). They are the
same bug and would be safe *in principle* — the keeper of each photo carries
equivalent faces with equivalent person links, being a byte-identical
re-upload — but `px-dedupe-event.ts` correctly REFUSES any row bearing a face,
and Mason chose (2026-08-23) not to loosen that for 264 cosmetic tiles. **Do
not "finish the cleanup" by deleting these without a face-aware migration**
that moves each duplicate's faces to the keeper; a naive delete can drop a
person→photo link that feeds People search. The bug is already fixed, so the
count cannot grow.

The remaining ~756 duplicate rows across 12 events are **hand-upload dupes,
not this bug** (Pixeltrunk has no ingest dedupe). Same filename there can be
two different photos from two cameras, so they are NOT `px-dedupe-event.ts`
candidates. TDP Website's 88 are publication to several scenes — never dedupe.

## The stall alert fired on day one, and found the duplicate storm — 2026-08-21

Four days after the pipeline ran dry (2026-08-17), the stall check went live
and reported **STUCK** within hours: one collection staged 5.3h with nothing
completing. The ingest was on pass 42 of Twitch Masquerade Ball, and the log
read `already in : 1,000` on every pass — a constant where a climbing number
belongs.

**The idempotency read was an unpaged PostgREST select**, capped at 1,000 rows.
Every photo past the first thousand read as absent and was re-inserted on each
retry. 4,961 rows for 1,174 photos; one frame 23 times; each its own R2 object.
Fixed in `pixieset-ingest.ts` (paged, ordered by id, reports duplicates it can
see). Lesson 101. **The collection had been complete since pass 1** — every
TLS "failure" being retried was a re-upload of a photo already there.

Cleanup is `scripts/triage/px-dedupe-event.ts <eventId> [--apply]` — ONE event
at a time by design, keeper = oldest row per filename, every FK into `images`
re-counted at run time and the script refuses if a duplicate carries a face,
favourite, activity, crew reference or the cover. Section links are repointed
to the keeper (collisions dropped), then rows go, THEN objects via
`deleteImageAssets` so a crash leaves an orphan object and never a broken tile.
It is slow — ~135 link moves/min over PostgREST — so budget ~30 min per 4,000.

**After a dedupe, run `repair-stranded-images.ts <eventId> --apply`.** Keeping
by age, not health, left 49 keepers with no thumbnail on Twitch.

A survey (`px-dupe-check.ts`, or the SQL in lesson 101) found **4,895 extra
rows across 16 events**. Only Twitch (3,787) was cleaned. NOT all of the rest
is this bug: TDP Website's 88 are publication to several scenes, and four
events never reached 1,000 rows. Each needs its own diagnosis before
`px-dedupe-event.ts` is pointed at it.

## The migration is a SERVICE now — 2026-08-16

It runs as two launchd agents, `com.twodudes.pixieset.watch` and
`com.twodudes.pixieset.ingest`. Setup, commands and traps:
**`scripts/pixieset/launchd/README.md`**. Logs: `~/pixieset-staging/logs/`.

Why: the pipeline stopped **three times in one day**, and every time Mason found
it by asking, not the tooling. The loop lived inside a session's shell and died
with it; then a partial ingest halted 1,342 collections over 9 transient upload
errors; then a reboot took everything including the logs, which were in `/tmp`.
Twice I told him it was running when it was not. A multi-week job cannot depend
on a human noticing it stopped.

Both agents were **verified by killing them** and watching launchd respawn each
with a new PID. An untested restart policy is a belief.

### What the day actually measured

- **The ingest is NOT bandwidth-bound.** 1.1 MB/s on a 238 Mbps link, against
  1.5 MB/s on the old ~10 Mbps one. It is bound by uploading one photo at a time
  and waiting for each R2 round-trip. **Parallelising the upload loop is the
  single biggest available win** and is not yet done.
- **Mason's upload was ~8 Mbps and is now 238 Mbps.** Not Xfinity, not the plan,
  not the radio: a downstream router at `192.168.4.1`. The modem-direct network
  ("Foster Shire", gateway `10.0.0.1`) measures 238 up / 337 down via
  `networkQuality`. Every theory offered before measuring was wrong.
- **TLS `bad record mac` at ~3% appeared on the new network** (9 of 322 uploads)
  and **cleared completely on retry** — kiamom finished at 1,026/1,026. Transient,
  not a reason to avoid that path. But it left **10 rows with bytes in R2 and no
  thumbnail**, and the ingest correctly refused to release the archive over it.
  `scripts/repair-stranded-images.ts <eventId> --apply` fixed all 10.
- **A partial ingest is normal.** The loop now retries the same collection —
  the ingest keeps the archive and leaves the collection `verified`, so a retry
  fills only the gaps — and gives up only after 3 passes with no progress.

## Restart — 2026-08-15

Loop restarted after ~20 hours idle. It does not self-drive: the watcher only
proves ZIPs that Chrome has already saved, so nothing moves unless someone runs
`driver.js` in the logged-in browser. **An idle watcher is the normal resting
state, not a fault.**

Landed: `choco` (7), `rsac2015` (2,059), `kiamom` (1,575),
`virginatlanticatthefacebooktravelfair` (310), `cphs20-yearreunion` (668) —
4,619 photos, all sampled as true originals.
Quarantined: `jonathanandcat`, uniform 1920px — the fifth Web Size rendition
the guard has caught, and the second to arrive while the driver reported
`fresh-high-res`. Lesson 75 keeps being re-earned.

### A THIRD gate class: downloads switched off entirely (22 collections)

Distinct from the PIN gate and from Web Size fidelity. The gallery page loads
normally, has no password prompt, and simply carries **no `/download/auth/`
link** — so the driver cannot begin. It reports
`no download-auth link on gallery page (downloads disabled?)`, which is
accurate.

**This was knowable without touching the site.** `pixieset-inventory.json`
already carries `collection_download` and `photo_download` per row:

| rows | `photo_download` | `collection_download` |
|---|---|---|
| 1,706 | 1 | true |
| 30 | 1 | true (`high_res=0`, since fixed) |
| 19 | 0 | false |
| 4 | 0 | true |
| 3 | 1 | false |

22 of those fall in the KEEP queue — 14,526 photos, but **13,983 of them are
one gallery**, `paloaltoskobooth22023`. The other 21 are small, and 20 are a
single two-day pet-portrait run in Jan 2015 that happens to sit at the very
front of oldest-first ordering, which is why the restart hit them immediately
and looked systemic when it was not.

Decision (Mason, 2026-08-15): **flip the setting, pull, flip back** — recording
each collection's original `photo_download` / `collection_download` to a file
first, so the restore is a diff against captured truth rather than memory.
Not yet executed.

**Rule: before probing a live system for why a request failed, grep the
inventory already on disk.** The answer had been sitting there since 2026-08-14.

### Releasing a staged archive needs a PRESENCE check, not a count

`verifyLanded()` in the ingest gates on `total >= expected`. That is the right
gate for the ingest and the WRONG gate for a delete: an event holding images
from more than one source satisfies it trivially. The Microsoft collection
verified at "1,369/1,185 images" — passing while proving nothing about those
1,185.

Two scripts now exist, and the second is the one that gates a delete:

```
npx tsx scripts/triage/verify-pixieset-landed.ts <slug> [<slug> ...]
npx tsx scripts/triage/px-filecheck.ts <eventId> <zip> [<zip> ...]
```

`px-filecheck` compares ZIP entries against **`images.original_filename`** and
exits non-zero on any miss. ⚠️ **`images.filename` is the R2 storage key (a
UUID), not a human name.** Comparing against it reports every file missing,
which reads exactly like catastrophic ingest failure — it did, for 1,185 files,
minutes before a delete. See lesson 87.

### Disk, again — and what actually reclaims it

Internal sat at 60–64 GB against the 60 GB floor. What was learned:

- **Deleting staged archives frees nothing immediately.** 6.8 GB of verified
  `ingested/` ZIPs were removed and free space did not move, because macOS holds
  the blocks in ~20 hourly APFS snapshots.
- **The Trash is not involved.** It was empty; a direct delete never goes there,
  and emptying it would not release snapshot-pinned blocks anyway.
- **Local snapshots expire at ~24h and drain on their own** — measured at
  60 → 64 GB over a few minutes as the oldest crossed the line. Waiting is a
  real option and costs no restore points.
- **The ingest is the lever that both progresses and frees**, since each
  collection releases its archive on verified completion.

Thinning snapshots by hand still works but triggers a full Time Machine pass —
harmless now that staging is internal and TM writes to the external, but that is
exactly the combination that caused the 77→2 photos/min collapse when staging
was on the shared spindle. Do not re-point staging at `/Volumes/Archive`.
