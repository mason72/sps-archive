# SPS Archive — Product Requirements Document

**Status:** Early development (scaffold complete, not yet deployed)
**Last updated:** 2026-02-22

---

## 1. Vision

SPS Archive is an AI-powered photo archiving and organization tool for professional photographers. It is the sister product to **SimplePhotoShare (SPS/spsv2)** — SPS handles the live gallery delivery experience; Archive handles the post-shoot organization, culling, and long-term storage layer.

**One-line pitch:** Drop 3,000 photos from a wedding shoot and get back an organized, searchable, client-ready archive in minutes — not hours.

---

## 2. Target Users

- **Professional event photographers** (weddings, corporate, schools, sports)
- **Portrait/headshot studios** processing high volumes
- **Photography businesses** that need to archive and retrieve past shoots

Users already use SPS for client gallery delivery. Archive solves the step *before* delivery: organizing and culling the raw shoot output.

---

## 3. Core Problems

| Problem | How Archive solves it |
|---|---|
| Photographers spend hours manually culling thousands of photos | AI-powered Smart Stacks surface the best shot from each grouping automatically |
| Finding specific photos in large event shoots is tedious | Semantic search ("first dance", "speeches") and filename search find images instantly |
| Headshot workflows require matching names to faces across many images | Filename parsing + face clustering auto-group by person |
| Organizing photos into gallery sections is manual and repetitive | Auto-sections generated from AI scene classification |
| No easy bridge between raw archive and client delivery gallery | One-click SPS integration: Archive enhances, SPS delivers |

---

## 4. Key Features

### 4.1 Smart Stacks
Group similar images and surface the best shot on top.

- **Face Stacks:** Multiple shots of the same person grouped together. Ranked by composite quality score (aesthetic 40% + sharpness 30% + eyes-open 30%).
- **Burst Stacks:** Sequential shots taken within 2 seconds grouped as a burst. Best shot ranked by aesthetic (60%) + sharpness (40%).
- **Similar Stacks:** (Planned) Visually similar images grouped by CLIP embedding distance.

The photographer sees one card per stack. Click to expand and compare. Click "Set as best" to override AI's pick.

### 4.2 AI Search
Three search modes:
- **Filename search:** Fast, exact matching on original filenames and parsed names ("Smith", "IMG_4532")
- **Semantic search:** CLIP-powered vector search using natural language descriptions ("first dance", "people laughing", "outdoor group photo")
- **Face search:** (Planned) Upload a selfie to find all photos of that person

Search works within a single event or across the entire archive.

### 4.3 Auto-Sections
AI classifies images into scene categories and generates gallery sections automatically.

**Wedding events:** Getting Ready, Ceremony, Portraits, Reception, Speeches, First Dance, etc.
**Headshot events:** Alphabetical sections by person name (A, B, C...)

Sections only appear when 3+ images match a tag. Images can belong to multiple sections (overlapping). Sections are ordered by first appearance time.

### 4.4 Upload & Processing Pipeline
1. Photographer creates an event (name, type, date)
2. Drag-and-drop upload zone accepts JPEG, PNG, TIFF, WebP, HEIC (up to 100MB each)
3. Client uploads directly to Cloudflare R2 via presigned URLs (no server bottleneck)
4. Client-side EXIF extraction captures camera metadata
5. AI pipeline processes each image on Modal GPUs:
   - CLIP ViT-L/14 generates 768-dim embeddings + scene tags
   - ArcFace (insightface buffalo_l) detects faces + 512-dim face embeddings
   - Aesthetic scoring (sharpness, exposure, composite quality)
6. Smart stacks and auto-sections are built from AI results

### 4.5 SPS Integration
Bidirectional sync between SPS and Archive:

**SPS → Archive:**
- "Archive this event" button in SPS sends event metadata + image references
- Zero-copy: both share the same R2 bucket, so no re-upload needed
- Archive runs AI pipeline on the imported images

**Archive → SPS:**
- Archive sends back enhanced metadata: stacks, sections, scene tags, quality scores
- SPS can display AI-generated sections and best-shot selections

### 4.6 Client Sharing
(Schema defined, UI planned)
- Shareable gallery links with optional password/PIN protection
- Share types: full event, single section, person's photos, curated selection
- Configurable download quality (original, high, web)
- Client favoriting with name/email tracking
- View analytics (count, last viewed)

---

## 5. Non-Goals (for v1)

- Real-time collaboration between multiple photographers
- Video processing
- Direct print ordering
- Mobile-native app (web-first, responsive)
- Social features or public galleries

---

## 6. User Flows

### Flow 1: New Event Upload
```
Create Event → Set name + type + date
  → Upload zone appears → Drag & drop images
  → Files upload directly to R2 → EXIF extracted client-side
  → AI pipeline processes in background
  → Gallery populates with Smart Stacks + Auto Sections
```

### Flow 2: Import from SPS
```
SPS "Archive Event" button → Sends event + image metadata
  → Archive creates records pointing to same R2 keys (zero-copy)
  → AI pipeline runs → Stacks + sections generated
  → Archive sends enhancements back to SPS
```

### Flow 3: Search & Retrieve
```
Global search bar → Type query
  → Auto mode: tries filename match first, falls back to semantic
  → Results displayed as grid with relevance scores
  → Click to view full image or navigate to parent event
```

### Flow 4: Client Delivery
```
Select event/section/person → Create share link
  → Set permissions (download, favorites, quality)
  → Optional password/PIN protection
  → Client views gallery, picks favorites
  → Photographer sees favorite selections
```

---

## 7. Success Metrics

| Metric | Target |
|---|---|
| Time to organize 3,000 photo wedding shoot | < 10 minutes (down from 2-4 hours) |
| Smart Stack accuracy (correct best shot) | > 80% of the time |
| Scene classification accuracy | > 70% correct primary tag |
| Face clustering precision | > 90% same-person grouping |
| Search relevance (semantic) | Top-5 results contain target > 75% |

---

## 8. Open Questions

1. **Product naming:** "SPS Archive" is a working title. Need a real product name that connects to SimplePhotoShare without being generic. Brainstorming session planned.
2. **Pricing model:** Per-event? Per-image? Monthly subscription? Bundled with SPS?
3. **Storage quotas:** How much R2 storage included? Tiered by plan?
4. **AI processing costs:** Modal GPU costs per image (~$0.002-0.005). Pass through? Absorb?
5. **Authentication:** Share Supabase project with SPS? Separate project with SSO?

---

## 9. Competitive Landscape

| Product | What it does | Where Archive differs |
|---|---|---|
| Adobe Lightroom | Photo editing + basic organization | Archive is AI-first organization, no editing |
| Narrative Select | Culling tool with AI rating | Archive integrates with SPS delivery pipeline |
| AfterShoot | AI culling standalone | Archive provides full archive + search + sharing |
| ShootProof / Pixieset | Gallery delivery | Archive is the pre-delivery organization layer |
| Google Photos | Consumer photo organization | Archive is professional-grade with business features |

---

## 10. Roadmap

### Phase 1: Foundation (current)
- [x] Project scaffold (Next.js 15, React 19, TypeScript)
- [x] Database schema (9 tables with pgvector)
- [x] Upload pipeline (presigned URLs, EXIF extraction)
- [x] AI pipeline (Modal: CLIP, ArcFace, aesthetic scoring)
- [x] Smart Stacks (face + burst)
- [x] Auto Sections (scene-based + headshot alphabetical)
- [x] Search (filename + semantic)
- [x] SPS integration layer (import + enhancements)
- [x] Core UI components (Button, UploadZone, SmartStack, ImageGrid, SearchBar)

### Phase 2: Wire Up & Polish
- [ ] Connect Supabase (deploy schema, wire up real data)
- [ ] Deploy Modal AI pipeline
- [ ] Wire Inngest event-driven processing
- [ ] Lightbox/full-image viewer
- [ ] Share link creation UI
- [ ] Client gallery viewer (public share pages)
- [ ] Event list/dashboard page (with real data)
- [ ] Thumbnail generation pipeline

### Phase 3: SPS Integration
- [ ] "Archive Event" button in SPS
- [ ] API endpoint for SPS → Archive import
- [ ] Enhancements feedback loop (Archive → SPS)
- [ ] Shared authentication
- [ ] Consistent branding between products

### Phase 4: Advanced Features
- [ ] Face search (selfie upload)
- [ ] Similar-image stacks (CLIP distance)
- [ ] Batch operations (select, download, move)
- [ ] Custom sections (manual curation)
- [ ] Client comments/annotations
- [ ] Analytics dashboard
