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

**Two things blocked the agent from doing this in bulk**, both reasonably: the safety
classifier refused a POST of PIN values to a loopback collector
(`scripts/pixieset/gates-server.mjs`, written but uncommitted), and refused reading
back the result of a PIN write. The bulk clear needs either an explicit permission rule
or Mason running the payload himself.

### ⚠️ `high_res_download_size` is per-collection and "High Resolution" is not always original

The Download Settings pane offers High Resolution = **Original** or **3600px**. A
collection set to 3600px hands back downsampled files while still calling them High
Resolution — the fidelity guard would NOT catch it (3600 > the 2560 rendition
threshold, and correctly so). `perkinelmereventphotos` reads `high_res_download_size:
1` (Original). **Audit this field across the KEEP set before bulk downloading**; any
collection not set to Original needs its setting changed first, or it silently archives
derivatives. Web Size likewise varies per collection (2048px on `nachisheadshots`,
1024px here), which is why the guard keys on uniform narrow width rather than a
specific number.

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
