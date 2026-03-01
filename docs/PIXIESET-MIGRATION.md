# Pixieset → Pixeltrunk Migration Plan

## Context

Shutting down Pixieset account (~1000+ events, ~5TB total). Migrating 2022+ events only (~200-400 events, ~1-2TB estimated). Pixieset is the **only copy** of these images — no local backups. Need to preserve images at original resolution plus gallery names and set/category structure.

**Timeline:** No rush — plan for when Pixeltrunk launches. But Phase 1 (export) must complete before canceling the Pixieset subscription, as they delete everything on cancellation.

---

## Pixieset Limitations

- No public API
- No bulk export / "download my account" feature
- Downloads are per-collection only (ZIP files)
- Original resolution requires an active paid plan
- Account contents deleted on subscription cancellation (per ToS)

---

## Phase 1: Export from Pixieset

### Goal
Download all 2022+ events from Pixieset into a structured local folder with metadata manifests.

### Output Structure
```
pixieset-export/
├── manifest.json                    # master index of all exported galleries
├── 2024-09-15_johnson-wedding/
│   ├── gallery.json                 # gallery metadata
│   ├── Getting Ready/
│   │   ├── DSC_0001.jpg
│   │   ├── DSC_0002.jpg
│   │   └── ...
│   ├── Ceremony/
│   │   └── ...
│   └── Reception/
│       └── ...
├── 2024-08-20_smith-portraits/
│   ├── gallery.json
│   └── Favorites/
│       └── ...
└── ...
```

### `gallery.json` Schema
```json
{
  "pixieset_id": "abc123",
  "name": "Johnson Wedding",
  "date": "2024-09-15",
  "slug": "johnson-wedding",
  "sets": [
    {
      "name": "Getting Ready",
      "image_count": 45,
      "images": ["DSC_0001.jpg", "DSC_0002.jpg"]
    },
    {
      "name": "Ceremony",
      "image_count": 120,
      "images": ["DSC_0100.jpg"]
    }
  ],
  "cover_image": "DSC_0250.jpg",
  "total_images": 350,
  "exported_at": "2026-03-15T10:00:00Z"
}
```

### `manifest.json` Schema (Master Index)
```json
{
  "exported_at": "2026-03-15T10:00:00Z",
  "pixieset_account": "mfoster",
  "cutoff_date": "2022-01-01",
  "total_galleries": 250,
  "total_images": 45000,
  "total_size_bytes": 1500000000000,
  "galleries": [
    {
      "folder": "2024-09-15_johnson-wedding",
      "name": "Johnson Wedding",
      "date": "2024-09-15",
      "image_count": 350,
      "status": "complete"
    }
  ]
}
```

### Technical Approach: Playwright Browser Automation

Why Playwright over raw HTTP scraping:
- Handles Pixieset's SPA/JS-rendered UI
- Manages auth session naturally (login once, cookies persist)
- Can screenshot progress for debugging
- Handles lazy-loaded image galleries
- More resilient to Pixieset UI changes than endpoint scraping

#### Script: `scripts/pixieset-export.ts`

```
Step 1: Login
  - Navigate to pixieset.com/signin
  - Enter credentials
  - Wait for dashboard

Step 2: Catalog all collections
  - Navigate to Client Gallery collections list
  - Paginate through all collections
  - Extract: collection ID, name, date, URL, image count
  - Filter to 2022-01-01 and later
  - Save catalog to manifest.json
  - Log: "Found N collections from 2022+, M total images"

Step 3: For each collection (resumable)
  - Skip if already marked "complete" in manifest
  - Navigate to collection admin page
  - Extract set/category names
  - For each set:
    - Scroll to load all thumbnails (lazy loading)
    - Extract original image URLs (inspect network requests or DOM)
    - Download each image at original resolution
    - Save to {gallery-folder}/{set-name}/{filename}
  - Extract cover image
  - Write gallery.json
  - Update manifest.json status to "complete"
  - Log progress: "Exported {name} — {N} images, {size}"

Step 4: Verification
  - For each "complete" gallery:
    - Count files on disk vs expected count in gallery.json
    - Flag any mismatches
  - Generate verification report
```

#### Key Implementation Details

**Resumability:**
- Script reads manifest.json on start, skips completed galleries
- Can be stopped and restarted safely
- Track per-image download status if needed for very large galleries

**Rate Limiting:**
- 1-2 second delay between image downloads
- 5 second delay between galleries
- Configurable — slower is safer, faster if Pixieset doesn't throttle

**Image URL Extraction:**
- Pixieset serves images via CDN (likely `cdn.pixieset.com` or similar)
- Original resolution URLs typically follow a pattern like:
  `https://cdn.pixieset.com/collections/{id}/photos/{photo_id}/original/{filename}`
- Intercept network requests during gallery load to capture CDN URLs
- Alternatively: use the built-in download feature per collection and unzip

**Fallback Strategy:**
- If direct CDN download fails: trigger the built-in "Download All" per collection
- Pixieset sends a ZIP via email — monitor for download links
- This is slower but guaranteed to work with original files

**Error Handling:**
- Retry failed downloads 3x with exponential backoff
- Log all failures to `errors.log`
- Continue to next gallery on persistent failure (don't block the whole run)

**Storage:**
- Need ~1-2TB free disk space (or download to external drive)
- Consider downloading to a cloud storage mount (e.g., mounted S3/R2 bucket)
  to avoid local disk constraints

---

## Phase 2: Import into Pixeltrunk

### Goal
Read the exported folder structure and create events in Pixeltrunk with all images and sections.

### Prerequisites
- Pixeltrunk deployed and operational
- Upload API working (presigned URL flow)
- Sections API working
- AI processing pipeline deployed on Modal

### Script: `scripts/pixieset-import.ts`

```
Step 1: Read manifest.json
  - Load the master index
  - Filter to galleries with status "complete"

Step 2: For each gallery (resumable, batched)
  - Read gallery.json
  - Create event via POST /api/events
    - name: gallery.name
    - date: gallery.date
    - slug: auto-generated or from gallery.slug
  - For each set in gallery:
    - Create section via POST /api/sections
      - name: set.name
      - event_id: new event ID
  - For each image in each set:
    - POST /api/upload (metadata: filename, type, size)
    - PUT /api/upload/[imageId] (binary upload via presigned URL)
    - POST /api/sections/[sectionId]/images (add to section)
  - Set cover image if specified
  - Update manifest with Pixeltrunk event ID
  - Log: "Imported {name} — {N} images across {M} sections"

Step 3: Trigger AI processing
  - AI pipeline picks up new images via Inngest events (already wired)
  - CLIP embeddings, aesthetic scoring, face detection, smart stacks
  - This runs asynchronously — no need to wait per-gallery

Step 4: Verification
  - For each imported gallery:
    - Compare image count in Pixeltrunk vs gallery.json
    - Verify sections created correctly
    - Spot-check a few images visually
  - Generate import report
```

#### Batch Strategy
- Process 10-20 galleries at a time
- Wait for AI processing to catch up between batches
- Monitor R2 storage usage and Modal GPU costs
- Estimated time: 1-2TB upload at ~50Mbps = 2-4 days continuous
  (throttled batching will take longer)

#### Concurrency
- Upload images within a gallery with concurrency of 5-10
- One gallery at a time to keep things orderable
- Presigned URL upload is direct to R2, so it won't bottleneck the Next.js server

---

## Phase 3: Verify & Cancel

### Pre-Cancellation Checklist
- [ ] All 2022+ galleries appear in Pixeltrunk with correct names/dates
- [ ] Image counts match between manifest and Pixeltrunk for every gallery
- [ ] Sections/sets are correctly mapped
- [ ] AI processing complete (stacks, embeddings, scores)
- [ ] Spot-check 10-20 galleries visually — images load, quality correct
- [ ] Test search works on imported images (CLIP embeddings indexed)
- [ ] Back up the `pixieset-export/` folder to a second location (external drive or cloud)

### Cancel Pixieset
- Download any remaining data you want (website content, store orders, etc.)
- Cancel subscription via Profile Icon > Billing > Change Plan > Cancel
- Keep the local `pixieset-export/` backup for at least 6 months after

---

## Estimated Timeline

| Phase | Duration | When |
|-------|----------|------|
| Audit Pixieset account | 1 hour | Anytime |
| Build export script | 2-3 days | Before PT launch |
| Run export (2022+ events) | 3-7 days (throttled) | Before PT launch |
| Verify export completeness | 1 hour | After export |
| Build import script | 1-2 days | When PT is ready |
| Run import | 2-5 days (batched) | When PT is ready |
| AI processing catch-up | 1-3 days | Runs in background |
| Verification + spot-checks | 2-3 hours | After import |
| Cancel Pixieset | 5 minutes | After full verification |

**Total estimated effort:** ~1 week of script building, ~2 weeks of automated running.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pixieset blocks automated downloads | Export stalls | Use slower rate limits; fall back to manual ZIP downloads |
| Pixieset changes UI/structure | Script breaks | Playwright selectors may need updating; keep script modular |
| Disk space insufficient | Can't complete export | Download to external drive or cloud-mounted storage |
| Image quality loss | Degraded archive | Always download "Original Size"; verify file sizes match upload sizes |
| Network failures during export | Incomplete galleries | Resumable design — restart picks up where it left off |
| Pixieset subscription lapses early | Data loss | Complete Phase 1 well before cancellation; keep backup |

---

## Open Questions (Resolve Before Starting)

1. **Pixieset plan level** — Does current plan allow "Original Size" downloads? (Some plans limit to 3600px max)
2. **Actual 2022+ event count** — Log into Pixieset, filter collections by date, get exact number
3. **Storage destination** — Local SSD? External drive? Cloud mount? Need 1-2TB free
4. **Pixieset credentials** — Will need login for the Playwright script (store securely, not in code)
5. **Events without sets** — Some galleries may not have sets/categories — handle as single "All Photos" section
