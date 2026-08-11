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
