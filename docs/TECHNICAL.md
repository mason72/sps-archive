# Pixeltrunk — Technical Documentation

**Last updated:** 2026-02-22

---

## 1. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js (App Router) | 15.1.0 |
| UI Library | React | 19.0.0 |
| Language | TypeScript | 5.7.0 |
| Styling | Tailwind CSS | 4.0.0 |
| CSS Processing | PostCSS + @tailwindcss/postcss | 8.4.0 |
| Class Utilities | clsx + tailwind-merge | 2.1.0 / 2.6.0 |
| Icons | lucide-react | 0.460.0 |
| Database | Supabase (PostgreSQL + pgvector) | 2.47.0 |
| Auth/SSR | @supabase/ssr | 0.5.0 |
| Object Storage | Cloudflare R2 (S3-compatible) | via @aws-sdk/client-s3 3.700.0 |
| Presigned URLs | @aws-sdk/s3-request-presigner | 3.700.0 |
| AI Processing | Modal (serverless GPU) | Python 3.11 |
| Async Workflows | Inngest | 3.27.0 |
| Image Processing | sharp | 0.33.0 |
| EXIF Extraction | exifr | 7.1.3 |
| Unique IDs | nanoid | 5.0.0 |
| File Upload UX | react-dropzone | 14.3.0 |

---

## 2. Project Structure

```
sps-archive/
├── src/
│   ├── app/                          # Next.js App Router pages
│   │   ├── layout.tsx                # Root layout (html/body, metadata)
│   │   ├── page.tsx                  # Home page (hero + feature highlights)
│   │   ├── globals.css               # Tailwind import
│   │   ├── events/
│   │   │   ├── new/page.tsx          # Create new event form
│   │   │   └── [eventId]/page.tsx    # Event detail (upload, search, gallery)
│   │   ├── search/page.tsx           # Global cross-event search
│   │   └── api/
│   │       ├── events/route.ts       # GET (list) + POST (create) events
│   │       ├── upload/
│   │       │   ├── route.ts          # POST: get presigned upload URLs
│   │       │   └── complete/route.ts # POST: finalize upload, save EXIF
│   │       └── search/route.ts       # GET: unified search (filename/semantic)
│   ├── components/
│   │   ├── ui/
│   │   │   └── button.tsx            # Button with variants (primary/secondary/ghost/danger)
│   │   ├── upload/
│   │   │   └── UploadZone.tsx        # Drag-and-drop upload with progress
│   │   ├── gallery/
│   │   │   ├── SmartStack.tsx        # Expandable image stack (collapsed/expanded)
│   │   │   └── ImageGrid.tsx         # Masonry grid with stacks + standalone images
│   │   └── search/
│   │       └── SearchBar.tsx         # Debounced search with type toggles
│   └── lib/
│       ├── utils.ts                  # cn(), formatFileSize(), formatCount(), truncate()
│       ├── supabase/
│       │   ├── client.ts             # Browser client (anon key)
│       │   ├── server.ts             # Server client (cookie-based) + service client (bypasses RLS)
│       │   └── database.types.ts     # TypeScript types for all 9 tables + 2 RPC functions
│       ├── r2/
│       │   └── client.ts             # R2 upload/download/delete, presigned URLs, key builder
│       ├── upload/
│       │   └── parse-filename.ts     # Filename parser + EXIF extractor
│       ├── ai/
│       │   ├── types.ts              # AI result types + scene categories
│       │   ├── process.ts            # Modal API client + result storage
│       │   ├── stacks.ts             # Face stack + burst stack builders
│       │   └── sections.ts           # Auto-section generator (scene-based + headshot)
│       └── sps-integration/
│           ├── types.ts              # SPS↔Archive integration contract types
│           └── import.ts             # importFromSPS() + generateEnhancements()
├── modal/
│   └── ai_pipeline.py               # Modal serverless GPU: CLIP + ArcFace + aesthetic scoring
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
└── eslint.config.mjs
```

---

## 3. Database Schema

9 tables in PostgreSQL with pgvector extension:

### events
Primary entity. One event = one photo shoot.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | "Sarah's Wedding" |
| slug | text unique | URL-safe: "sarahs-wedding-m1abc" |
| description | text? | |
| event_date | date? | |
| event_type | text? | wedding, headshot, corporate, portrait, sports, school |
| cover_image_id | uuid? FK→images | |
| settings | jsonb | Custom config, includes { spsEventId, source } for imports |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### images
Core asset table. One row per uploaded photo.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | nanoid generated |
| event_id | uuid FK→events | |
| filename | text | Generated unique: `{nanoid}.{ext}` |
| original_filename | text | Photographer's original: "SmithJohn_001.jpg" |
| r2_key | text | `events/{eventId}/originals/{filename}` |
| file_size | bigint | Bytes |
| width | int? | Pixels |
| height | int? | Pixels |
| mime_type | text | image/jpeg, etc. |
| parsed_name | text? | Extracted from filename: "Smith, John" |
| taken_at | timestamptz? | From EXIF DateTimeOriginal |
| camera_make | text? | "Canon" |
| camera_model | text? | "EOS R5" |
| lens | text? | "RF 50mm F1.2L" |
| focal_length | real? | mm |
| aperture | real? | f-number |
| shutter_speed | text? | "1/500" |
| iso | int? | |
| gps_lat | double? | |
| gps_lng | double? | |
| clip_embedding | vector(768)? | CLIP ViT-L/14 image embedding |
| aesthetic_score | real? | 0-1 composite quality |
| sharpness_score | real? | 0-1 Laplacian variance based |
| is_eyes_open | boolean? | From face detection |
| scene_tags | text[]? | ["ceremony", "outdoor"] |
| stack_id | uuid? FK→stacks | Group membership |
| stack_rank | int? | 1 = best/cover |
| processing_status | text | pending → processing → complete / failed |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Indexes:** HNSW on clip_embedding, GIN on scene_tags, composite on (stack_id, stack_rank), index on processing_status.

### faces
One row per detected face in an image.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| image_id | uuid FK→images | |
| bbox_x/y/w/h | real | Normalized 0-1 bounding box |
| embedding | vector(512)? | ArcFace identity embedding |
| person_id | uuid? FK→persons | Assigned after clustering |
| confidence | real? | Clustering confidence 0-1 |
| created_at | timestamptz | |

**Indexes:** HNSW on embedding.

### persons
Identity cluster. One person across multiple images.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| name | text? | Photographer can label |
| representative_face_id | uuid? FK→faces | Best face crop |
| face_count | int | |
| created_at | timestamptz | |

### stacks
Groups of similar/related images.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| stack_type | text | "face", "burst", "similar" |
| cover_image_id | uuid? FK→images | Best shot |
| image_count | int | |
| person_id | uuid? FK→persons | For face stacks |
| created_at | timestamptz | |

### sections
Gallery organization units (auto-generated or manual).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| name | text | "Ceremony", "A", "Reception" |
| description | text? | |
| sort_order | int | Display sequence |
| is_auto | boolean | AI-generated vs manual |
| filter_query | text? | Scene tag that defines this section |
| created_at | timestamptz | |

### section_images
Many-to-many: images can belong to multiple sections.

| Column | Type | Notes |
|---|---|---|
| section_id | uuid FK→sections | Composite PK |
| image_id | uuid FK→images | Composite PK |
| sort_order | int | |
| relevance_score | real? | How well image fits section |

### shares
Public gallery links with access control.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK→events | |
| slug | text unique | Public URL identifier |
| password_hash | text? | Optional password protection |
| pin | text? | Alternative PIN access |
| expires_at | timestamptz? | |
| is_active | boolean | Kill switch |
| share_type | text | full, section, selection, person |
| section_id | uuid? | If section share |
| person_id | uuid? | If person share |
| allow_download | boolean | |
| allow_favorites | boolean | |
| download_quality | text | original, high, web |
| custom_message | text? | |
| view_count | int | |
| last_viewed_at | timestamptz? | |
| created_at | timestamptz | |

### favorites
Client picks on shared galleries.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| share_id | uuid FK→shares | |
| image_id | uuid FK→images | |
| client_name | text? | |
| client_email | text? | |
| created_at | timestamptz | |

**Unique:** (share_id, image_id, client_email)

### Database Functions (RPC)

```sql
search_images_by_embedding(query_embedding vector(768), target_event_id uuid?, match_threshold real = 0.2, match_count int = 50)
  → RETURNS {id, event_id, filename, original_filename, r2_key, similarity}

search_faces_by_embedding(query_embedding vector(512), target_event_id uuid?, match_threshold real = 0.6, match_count int = 50)
  → RETURNS {face_id, image_id, person_id, similarity}
```

---

## 4. API Routes

### GET /api/events
List events with image counts. Params: `limit` (default 50), `offset` (default 0).

### POST /api/events
Create event. Body: `{ name, description?, eventDate?, eventType? }`. Auto-generates slug.

### POST /api/upload
Get presigned R2 upload URLs. Body: `{ eventId, files: [{ name, type, size }] }`. Creates pending image records in DB. Returns `{ uploads: [{ imageId, uploadUrl, r2Key }] }`.

### POST /api/upload/complete
Finalize after direct R2 upload. Body: `{ imageId, width?, height?, exif? }`. Updates EXIF metadata, sets status to "processing". (TODO: triggers Inngest event.)

### GET /api/search
Unified search. Params: `q` (required), `eventId?`, `type?` (auto|semantic|filename), `limit?`. Auto mode tries filename first, falls back to semantic CLIP vector search.

---

## 5. AI Pipeline (Modal)

**File:** `modal/ai_pipeline.py`
**GPU:** NVIDIA T4
**Concurrency:** 4 images per warm container
**Timeout:** 300s per image, 600s for batch

### Models

1. **CLIP ViT-L/14** (open_clip, pretrained: datacomp_xl_s13b_b90k)
   - Input: Image → 768-dim embedding
   - Also: Text → 768-dim embedding (for search)
   - Scene classification: 25 pre-tokenized scene prompts, softmax similarity, threshold 0.08

2. **ArcFace** (insightface buffalo_l)
   - Input: Image → face bounding boxes + 512-dim embeddings per face
   - Eyes-open detection via landmark-based eye aspect ratio (threshold 0.15)
   - Face quality: detection confidence × face size factor

3. **Aesthetic Scorer** (custom heuristic)
   - Sharpness: Laplacian variance, normalized to 0-1
   - Exposure: Histogram analysis, penalizes extreme under/over-exposure
   - Composite: sharpness × 0.5 + exposure × 0.3 + 0.2 base

### Endpoints

- `POST /process-image` — Process single image (returns clip + faces + aesthetic)
- `POST /embed-text` — Generate text embedding for search queries
- `process_batch()` — Batch processing via Modal .map()

### Scene Labels (25 categories)
ceremony, reception, first dance, speeches, getting ready, bridal party, cake cutting, bouquet toss, first look, group photo, candid moment, portrait, detail shot, landscape, food, venue, decoration, headshot, presentation, networking, panel discussion, outdoor, indoor, night, golden hour

---

## 6. Smart Stack Algorithm

### Face Stacks
1. Query all faces with person_id assigned for the event
2. Group by person_id
3. Deduplicate by image (one person may have multiple face detections in same image)
4. Require 2+ unique images per person
5. Rank by: `aesthetic × 0.4 + sharpness × 0.3 + eyes_open × 0.3`
6. Create stack record, assign stack_id and stack_rank to images

### Burst Stacks
1. Query images not yet in a stack, with taken_at timestamp
2. Sort by taken_at ascending
3. Sequential images within 2000ms = burst group
4. Require 3+ images per burst
5. Rank by: `aesthetic × 0.6 + sharpness × 0.4`
6. Create stack record, assign stack_id and stack_rank

---

## 7. Auto-Section Algorithm

### Scene-Based (non-headshot events)
1. Get all processed images with scene_tags, ordered by taken_at
2. Count tag frequency, track first appearance time
3. Filter: only tags with 3+ images become sections
4. Sort by first appearance time (timeline order)
5. Delete previous auto sections, create new ones
6. Link images to sections via section_images (500 per batch)

### Headshot-Based
1. Get all persons for event, ordered by name
2. Group by first letter of name
3. Create alphabetical sections (A, B, C...)
4. Link images via faces → persons → sections

---

## 8. Upload Flow

```
Client                        Server (API)              R2 (Cloudflare)        Modal (GPU)
  │                              │                          │                      │
  ├─ POST /api/upload ──────────>│                          │                      │
  │  {eventId, files[]}          │                          │                      │
  │                              ├─ Create image records ──>│                      │
  │                              │   (status: pending)      │                      │
  │<── {uploads: [{uploadUrl}]}──┤                          │                      │
  │                              │                          │                      │
  ├─ PUT uploadUrl (file body) ─────────────────────────────>│                     │
  │                              │                          │                      │
  ├─ extractExif(file) ─────┐   │                          │                      │
  │  (client-side)          │   │                          │                      │
  │<────────────────────────┘   │                          │                      │
  │                              │                          │                      │
  ├─ POST /api/upload/complete ->│                          │                      │
  │  {imageId, exif}             ├─ Update image with EXIF  │                      │
  │                              │   (status: processing)   │                      │
  │                              │                          │                      │
  │                              ├─ (TODO) Inngest event ──────────────────────────>│
  │                              │                          │   CLIP + ArcFace +   │
  │                              │                          │   Aesthetic scoring   │
  │                              │<─────────────────────────────────────────────────┤
  │                              ├─ Save results            │                      │
  │                              │   (status: complete)     │                      │
  │                              ├─ Build stacks            │                      │
  │                              ├─ Generate sections       │                      │
```

---

## 9. SPS Integration

### Integration Contract

**SPS → Archive (import):**
```typescript
interface SPSEventImport {
  spsEventId: string;
  name: string;
  date?: string;
  eventType?: string;
  images: SPSImageImport[];   // r2Key references (zero-copy)
  collections?: SPSCollection[];
}
```

**Archive → SPS (enhancements):**
```typescript
interface ArchiveEnhancements {
  eventId: string;
  spsEventId: string;
  sections: { name: string; imageIds: string[] }[];
  stacks: { coverImageId: string; imageIds: string[]; personName?: string }[];
  imageEnhancements: { spsImageId: string; sceneTags: string[]; aestheticScore: number }[];
}
```

### Key Design Decision: Shared R2 Bucket
Both SPS and Archive use the same Cloudflare R2 bucket. Images are stored once at `events/{eventId}/originals/{filename}`. When importing from SPS, Archive creates metadata records pointing to existing R2 keys — no file copying needed.

---

## 10. Design System

### Color Palette
Based on Tailwind's stone scale:
- **Primary:** stone-900 (near black) for buttons, headers, active states
- **Surface:** white, stone-50, stone-100 for backgrounds
- **Text:** stone-900 (primary), stone-600/700 (secondary), stone-400/500 (muted)
- **Borders:** stone-200 (default), stone-300 (hover/active)
- **Success:** green-600
- **Warning:** amber-500
- **Error:** red-500/600
- **Overlays:** black/50, black/70 with backdrop-blur-sm

### Button Component
Located at `src/components/ui/button.tsx`.

Variants: `primary` (stone-900), `secondary` (stone-100), `ghost` (transparent), `danger` (red-600).
Sizes: `sm` (h-8), `md` (h-10, default), `lg` (h-12).
Features: forwardRef, focus rings, disabled states, transition-all.

### Component Patterns
- **Client components:** `"use client"` directive, React hooks for state
- **Class merging:** `cn()` utility combines clsx + tailwind-merge
- **Loading states:** Loader2 icon with animate-spin
- **Status indicators:** color-coded icons (green=success, amber=processing, red=error)
- **Cards:** rounded-lg, subtle shadows, hover:scale-[1.02]
- **Masonry layout:** CSS columns (columns-2 → columns-6 responsive)

### Typography
System font stack (Tailwind default). Font weights: medium for labels/headers, regular for body. No custom fonts.

---

## 11. Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=

# Modal AI
MODAL_API_URL=
MODAL_TOKEN_ID=
MODAL_TOKEN_SECRET=

# Inngest
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

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

Camera prefixes (IMG, DSC, DSCF, DSCN, etc.) are detected and treated as unnamed.
CamelCase names (SmithJohn) are split into "Smith, John".
Keywords like "headshot", "portrait", "final" are stripped from name parts.
