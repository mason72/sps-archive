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
