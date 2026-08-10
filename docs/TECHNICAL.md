# Pixeltrunk — Technical Documentation

**Last updated:** 2026-05-30

> What actually runs today: Next.js app on Vercel, Supabase (Postgres + pgvector) for metadata, Cloudflare R2 for file binaries, Stripe for billing, Resend for email. The Modal AI pipeline and Inngest processing exist in the codebase but are **not configured / not active** (see §5).

---

## 1. Architecture in one paragraph

There is **one database and one object store**. Supabase (Postgres) holds all *metadata* — events, sections, image rows (filename, size, dimensions, EXIF, `r2_key`, `processing_status`), shares, favorites, users. Cloudflare R2 holds the *file binaries* (the actual JPEGs/PNGs). An `images` row points at its binary via `r2_key`. The browser displays photos using short-lived **presigned GET URLs** to R2. This is the standard "DB for metadata + object store for blobs" split — not two databases.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| UI | React 19, TypeScript |
| Styling | Tailwind CSS 4 (PostCSS) |
| Icons | lucide-react |
| Metadata DB | Supabase (PostgreSQL + pgvector), `@supabase/ssr` |
| Object storage | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` + `s3-request-presigner` |
| Billing | Stripe |
| Transactional email | Resend |
| Image processing | sharp (thumbnails) |
| EXIF extraction | exifr (client-side) |
| AI processing *(dormant)* | Modal serverless GPU — not configured |
| Async workflows *(dormant)* | Inngest — not configured |

---

## 3. Database Schema

PostgreSQL with the pgvector extension. Core tables below (vector columns are populated only when the dormant AI pipeline is active).

### events
One event = one photo shoot. Owned by a user.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | Owner (RLS scoped) |
| name | text | "Sarah's Wedding" |
| slug | text unique | URL-safe |
| description | text? | |
| event_date | date? | |
| event_type | text? | wedding, headshot, corporate, portrait, sports, school |
| cover_image_id | uuid? FK→images | |
| settings | jsonb | Custom config; includes `{ spsEventId, source }` for SPS imports |
| created_at / updated_at | timestamptz | |

### images
One row per uploaded photo. Binary lives in R2 at `r2_key`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| filename | text | Generated unique: `{uuid}.{ext}` |
| original_filename | text | Photographer's original |
| r2_key | text | `events/{eventId}/originals/{filename}` |
| file_size | bigint | Bytes |
| width / height | int? | Pixels |
| mime_type | text | image/jpeg, etc. |
| parsed_name | text? | Extracted from filename |
| taken_at | timestamptz? | From EXIF |
| camera_make / camera_model / lens | text? | EXIF |
| focal_length / aperture | real? | EXIF |
| shutter_speed | text? | EXIF |
| iso | int? | EXIF |
| gps_lat / gps_lng | double? | EXIF |
| thumbnail_generated | boolean | Set once sharp thumbnails exist |
| processing_status | text | pending -> complete (or failed); see §4 upload flow |
| clip_embedding | vector(768)? | *AI: populated only when Modal active* |
| aesthetic_score / sharpness_score | real? | *AI: dormant* |
| is_eyes_open | boolean? | *AI: dormant* |
| scene_tags | text[]? | *AI: dormant* |
| stack_id | uuid? FK→stacks | *AI: dormant* |
| stack_rank | int? | *AI: dormant* |
| created_at / updated_at | timestamptz | |

### sections
Gallery organization units. **Every event has at least one; the seed section is "Highlights".** See §6 for the section invariants.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| name | text | "Ceremony", "Highlights" |
| description | text? | |
| sort_order | int | Display sequence |
| is_auto | boolean | AI-generated vs manual (manual only, today) |
| filter_query | text? | Scene tag for auto sections (*AI: dormant*) |
| created_at | timestamptz | |

### section_images
Many-to-many link. **Every image has at least one row here** — no orphaned images.

| Column | Type | Notes |
|---|---|---|
| section_id | uuid FK→sections | Composite PK |
| image_id | uuid FK→images | Composite PK |
| sort_order | int | |
| relevance_score | real? | *AI: dormant* |

### shares
Public gallery links with access control.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| slug | text unique | Public URL identifier |
| password_hash / pin | text? | Optional access control |
| expires_at | timestamptz? | |
| is_active | boolean | Kill switch |
| share_type | text | full, section, selection, person |
| section_id / person_id | uuid? | If scoped share |
| allow_download / allow_favorites | boolean | |
| download_quality | text | original, high, web |
| custom_message | text? | |
| view_count | int | |
| last_viewed_at | timestamptz? | |
| created_at | timestamptz | |

### favorites
Client picks on a shared gallery. Unique on (share_id, image_id, client_email).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| share_id | uuid FK→shares | |
| image_id | uuid FK→images | |
| client_name / client_email | text? | |
| created_at | timestamptz | |

### faces / persons / stacks — *AI: dormant*
Defined for face clustering and Smart Stacks. Populated only when the Modal pipeline is active. `faces` holds per-face bounding boxes + ArcFace `vector(512)` embeddings; `persons` are identity clusters; `stacks` group related images by type (face/burst/similar).

### Database Functions (RPC) — *used by semantic/face search, dormant*
```sql
search_images_by_embedding(query_embedding vector(768), target_event_id uuid?, match_threshold real = 0.2, match_count int = 50)
search_faces_by_embedding(query_embedding vector(512), target_event_id uuid?, match_threshold real = 0.6, match_count int = 50)
```

---

## 4. Upload Flow (the most fundamental function)

Upload is **two steps**, with a **hybrid transport** for the binary.

**Step 1 — create rows + get presigned URLs.** `POST /api/upload` with `{ eventId, sectionId?, files: [{ name, type, size }] }`:
- Verifies the event exists.
- Resolves the target section: uses `sectionId` if given; otherwise the event's first (default) section; if the event somehow has none, it creates a "Highlights" section. (Uploads always land in a real section — never the "All Images" derived view.)
- Inserts `images` rows (`processing_status: pending`) and links each to the section via `section_images`. If the link insert fails, the image rows are rolled back so nothing is orphaned.
- Returns `{ uploads: [{ imageId, uploadUrl, r2Key, ... }], sectionId }` with presigned R2 PUT URLs.

**Step 2 — send the bytes (hybrid).** The browser chooses transport by file size (`PROXY_MAX_BYTES = 4 MB` in `src/components/upload/UploadZone.tsx`):
- **Files ≤ 4 MB → server proxy:** `PUT /api/upload/[imageId]` streams the binary through the Next.js server, which writes it to R2. No CORS configuration needed. (Stays under Vercel's ~4.5 MB request-body limit.)
- **Files > 4 MB → direct browser→R2:** the browser PUTs straight to the presigned URL, bypassing the server body limit. **This path requires R2 bucket CORS to be configured once, manually, in the Cloudflare dashboard** — the R2 API token used by the app cannot set bucket CORS. A direct-upload `TypeError("Failed to fetch")` almost always means CORS is missing.

**Step 3 — finalize.** `POST /api/upload/complete` with `{ imageId, width?, height?, exif? }`:
- Saves dimensions + client-extracted EXIF, sets `processing_status: complete`.
- Fires sharp thumbnail generation (fire-and-forget; grid falls back to the original URL if it fails).
- **Only if `INNGEST_EVENT_KEY` is set**, sends an `image/uploaded` Inngest event to kick off AI processing. In production this is unset, so the AI step is skipped silently.

```
Browser                     Next.js API                R2                 (Inngest/Modal)
  | POST /api/upload --------> create rows + links
  |                           presigned URLs
  | <-- {uploads, sectionId} --
  |
  | -- <=4MB: PUT /api/upload/[id] --> proxy --> R2
  | -- >4MB:  PUT presignedUrl ---------------> R2  (needs bucket CORS)
  |
  | extractExif (client-side)
  | POST /api/upload/complete -> save EXIF, status=complete, thumbnails
  |                              if INNGEST_EVENT_KEY: emit image/uploaded ----> (dormant)
```

---

## 5. AI Pipeline (Modal) — NOT ACTIVE

**File:** `modal/ai_pipeline.py`. This is a complete design that is **not deployed or configured** in production. Kept for future activation. When stood up, it would run on Modal GPU and provide:

1. **CLIP ViT-L/14** — image -> 768-dim embedding + scene tags (25 pre-tokenized scene prompts); text -> 768-dim embedding for semantic search.
2. **ArcFace (insightface buffalo_l)** — face boxes + 512-dim embeddings, eyes-open detection, face quality.
3. **Aesthetic scorer (heuristic)** — sharpness (Laplacian variance) + exposure + composite.

Endpoints (when deployed): `POST /process-image`, `POST /embed-text`, `process_batch()`.

Scene labels (25): ceremony, reception, first dance, speeches, getting ready, bridal party, cake cutting, bouquet toss, first look, group photo, candid moment, portrait, detail shot, landscape, food, venue, decoration, headshot, presentation, networking, panel discussion, outdoor, indoor, night, golden hour.

---

## 6. Section Invariants

Enforced across `/api/upload`, `/api/sections`, and `/api/sections/[sectionId]`:

- **≥1 section per event, always.** Deleting the last section is rejected (`Cannot delete the last section`).
- **≥1 real section per image, always.** Deleting a section first rescues any photo that lived only in it by reassigning it to the next section — no orphans.
- **"All Images" is a derived view** (union of all sections). Never stored, never writable, never deletable.
- **Seed section is "Highlights"** — fully renamable, deletable once others exist, not otherwise special.
- New manual sections are created at the top (`sort_order = 0`; existing sections shift down).

---

## 7. Auto-Section & Smart Stack Algorithms — *AI: dormant*

These run only when the Modal pipeline is active.

**Auto-Sections (scene-based):** group processed images by `scene_tags`, only tags with 3+ images become sections, ordered by first appearance time. **Headshot variant:** alphabetical sections by person name via faces -> persons.

**Smart Stacks — Face:** group faces by `person_id` (2+ unique images), rank `aesthetic*0.4 + sharpness*0.3 + eyes_open*0.3`. **Burst:** sequential images within 2000ms (3+), rank `aesthetic*0.6 + sharpness*0.4`.

---

## 8. API Routes (live)

Auth, account, and billing:
- `POST /api/auth/signup`, `POST /api/auth/forgot-password`
- `GET/PATCH /api/account`, `POST /api/account/logo`, `/api/account/subscription`
- `/api/stripe/checkout`, `/api/stripe/portal`, `/api/stripe/webhook`

Events & images:
- `GET/POST /api/events`, `GET/PATCH/DELETE /api/events/[eventId]`
- `/api/events/[eventId]/duplicate`, `/processing-status`, `/retry-processing`, `/share-readiness`, `/favorites`, `/emails`
- `GET/PATCH/DELETE /api/images/[imageId]`, `POST /api/images/batch`

Upload (see §4):
- `POST /api/upload`, `PUT /api/upload/[imageId]`, `POST /api/upload/complete`

Sections (see §6):
- `GET/POST /api/sections`, `PATCH/DELETE /api/sections/[sectionId]`, `POST /api/sections/[sectionId]/images`, `POST /api/sections/reorder`
- `POST /api/events/[eventId]/auto-sections` *(depends on dormant AI)*

Sharing & public galleries:
- `GET/POST /api/shares`, `PATCH/DELETE /api/shares/[shareId]`, `GET/POST /api/events/[eventId]/shares`
- Public: `GET /api/gallery/[slug]`, `/verify`, `/verify-pin`, `/favorites`, `/download`, `/track`, `GET /api/gallery/preview/[eventId]`
- `/download` streams one ZIP; scope params (all optional, bulk-PIN-gated as a group):
  `?favorites=true` (this share's favorites), `?section=<id>` (one section, validated
  against the share's event), `?images=<id,id,...>&name=<label>` (explicit set — used by
  gallery Smart Stacks "download all N"; foreign ids simply don't match). Scoped ZIPs are
  flat; the full-gallery ZIP folders by section. When `require_pin_bulk` is on, the
  verified PIN must be re-sent as `?pin=` on EVERY bulk request (server re-checks each).
  **Two-tier delivery** (both platform failure modes hit live on a 1553-photo gallery:
  300s timeout kill, then an OOM kill — Vercel's response transport buffers
  producer-vs-client speed differences in lambda memory without backpressure):
  - Clients call `POST /download/prepare` (same scope params in the body, `dt` token
    for PIN shares). ≤300 images AND ≤750MB → `{mode:"direct"}` and the client streams
    from `/download` synchronously (under the cap, even a fully buffered ZIP fits in
    function memory). Larger → `{mode:"job", jobId}`: an Inngest `zip-build` function
    streams archiver → R2 multipart (`uploadStreamToR2`, ~100MB bounded memory), the
    client polls `GET /download/status?job=` and receives a presigned R2 URL —
    resumable, no lambda in the download path. Jobs dedupe by `scope_key` (content
    hash of the exact image set — gallery/favorites changes rebuild naturally), live
    24h, and `zip-cleanup` (daily cron) reclaims expired objects + rows.
  - Shared core: `lib/gallery/download-core.ts` (share auth incl. PIN token, image
    selection) and `lib/zip/append-images.ts` (8-wide prefetch producer, 64MB
    high-water gate) — sync route, prepare, and the builder use the same code.
  - Sync route internals: `maxDuration = 800`, `store: true` (JPEGs don't deflate),
    `Readable.toWeb(archive)`, 413 `{useJob:true}` above the caps (defense — prepare
    routes clients before they hit it), client-abort detection.
  - PIN shares: verify-pin returns an HMAC download token (4h, share-scoped); bulk
    URLs carry `?dt=<token>` so the PIN never lands in access logs.
- `POST /api/gallery/[slug]/image-download` — one original, for the **per-image** PIN
  (`require_pin_individual`). Body `{imageId, dt?, pin?}`; it runs the same
  `authorizeShareDownload` as the ZIP with `kind:"individual"`, resolves the image
  through the same share-membership predicate, and returns a 10-minute presigned URL.

**Originals in the guest payload — two separate questions.** `GET /api/gallery/[slug]`
computes both, and they are deliberately NOT one flag:
- `downloadWithheld = !allow_download || require_pin_individual` → omit `downloadUrl`.
- `displayWithheld = require_pin_individual` → `originalUrl` and `settings.coverImageUrl`
  drop to the 800px rendition via `getWithheldDisplayKey()`.

Only the PIN forces the display step-down. A plain no-download share keeps its full-res
lightbox: dropping every proofing gallery to 800px is a visible quality regression, and
the presign is the real gate either way. But when a PIN *is* set, `originalUrl` must be
gated too — for a JPEG the display key **is** the original key, so a full-res lightbox
serves the identical bytes through a field that isn't named "download".

`getWithheldDisplayKey()` returns **null for video**, and the caller omits the asset:
an `.mp4` original passes through `getVideoDisplayKey` untouched and a `.mov`'s
rendition is a lossless `-c copy` remux, so neither is a safe stand-in. A PIN-gated
video therefore shows its poster frame in the lightbox (which is what the guest
`<img>` rendered anyway — there is no `<video>` element on that page) and the file
itself comes through the PIN endpoint.

The per-image PIN used to be enforced only in the browser while every original sat
presigned in the JSON, so a guest past the password gate could read them out of the
Network tab (pre-alpha audit 2026-08-10, lesson #55).

**Both PIN gates fail CLOSED.** `authorizeShareDownload` refuses with 403 when a
`require_pin_*` flag is set but `download_pin` is null — a reachable state, since the
sidebar's auto-generated PIN can be cleared afterwards. The previous
`pinRequired && download_pin` read silently handed the asset to everyone.

**Gallery Smart Stacks (live, filename-based — distinct from the dormant AI stacks):**
`grid.smartStacks` in event settings (Design → Grid) groups same-person photos in the
*shared gallery* into rotating stack cards, keyed on `parsedName`/`extractPersonName`
(`src/lib/gallery/stacks.ts`). Guest-side: a per-visitor "Stacks" toggle in the section
toolbar (persisted in `localStorage` as `stacks_<shareId>`, never global), stack cards
hover-offer "⬇ N" (single ZIP via `?images=`), clicking a stack opens a full-screen mini
gallery (`StackModal`), and the lightbox shows a member filmstrip with navigation
constrained to the stack. Preview mirrors all of it with downloads stubbed.

Email templates, analytics, stats, search, SPS, stacks, Inngest:
- `/api/emails/send`, `/api/emails/templates`, `/api/templates`
- `/api/analytics/overview`, `/api/analytics/engagement`, `/api/stats`
- `GET /api/search` — `q`, `eventId?`, `type?` (auto|semantic|filename). **Filename search works today; semantic falls back / no-ops without Modal.**
- `/api/sps/import`, `/api/sps/enhancements/[eventId]` *(enhancements depend on dormant AI)*
- `POST /api/stacks/[stackId]/cover` *(dormant AI)*, `/api/inngest` *(dormant)*, `/api/admin/batch-thumbnails`

---

## 9. SPS Integration

> **Corrected 2026-08-10 — the shared-bucket premise below is false.** SPS v2 serves from its own public lane (`pub-7363d57d….r2.dev`); the archive stores in `sps-prism`. A `ListObjectsV2` against `sps-prism` with an SPS key prefix returns 0 objects. `/api/sps/import` as written would therefore create rows pointing at keys the archive cannot read — ghost tiles. A real import must copy bytes; SPS additionally re-compresses on ingest (~⅓ the bytes at identical pixel dimensions), so it is a lossy source. See `scripts/backfill-sps-fou26.ts` for a working byte-moving import and `tasks/sps-fou26-backfill.md` for the measurements.

Binaries are stored at `events/{eventId}/originals/{filename}`. Importing from SPS (`/api/sps/import`) creates metadata rows pointing at existing R2 keys — which was intended to be zero-copy, no re-upload. The enhancements export (`/api/sps/enhancements/[eventId]`) returns AI-derived sections/stacks/scene tags and therefore only produces meaningful output once the Modal pipeline is active.

---

## 10. Design System

- **Fonts:** `font-brand` (Libre Baskerville — wordmark only), `font-editorial` (Playfair Display — headlines), `font-sans` (Inter — body).
- **Palette:** Tailwind stone scale — stone-900 primary, white/stone-50 surfaces, stone-200/300 borders, **emerald accent**. Success green-600, warning amber-500, error red-500/600.
- **Buttons:** `src/components/ui/button.tsx` — variants primary/secondary/ghost/danger; sizes sm/md/lg; plus animated BrandButton.
- **Layout:** CSS-columns masonry; `cn()` utility (clsx + tailwind-merge); lucide-react icons.

---

## 11. Environment Variables

```env
# Supabase (metadata DB)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2 (file binaries)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=          # fallback only; app uses presigned URLs

# Stripe (billing)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
# (plus publishable key + price IDs as used by the app)

# Resend (email)
RESEND_API_KEY=

# Modal AI — leave unset to keep AI dormant
MODAL_API_URL=
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=

# Inngest — leave unset to keep AI/processing dormant
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

> Verify the exact Stripe/Resend variable names against `.env.example` and the code in `src/lib/stripe` and `src/lib/email` before relying on this list — the AI/Supabase/R2 vars are confirmed in code.

---

## 12. Filename Parsing

`src/lib/upload/parse-filename.ts` handles common photographer naming conventions:

| Input | Parsed Name | Sequence |
|---|---|---|
| SmithJohn_001.jpg | Smith, John | 1 |
| Smith_John_001.jpg | Smith John | 1 |
| John Smith-001.jpg | John Smith | 1 |
| IMG_4532.jpg | null | 4532 |
| DSC_0012.RAW | null | 12 |

Camera prefixes (IMG, DSC, DSCF, DSCN, etc.) are treated as unnamed. CamelCase names are split. Keywords like "headshot", "portrait", "final" are stripped from name parts.
