# Session Handoff Prompt

Copy everything below the line into a new Claude Code session.

---

## Context: SPS Prism Project

I'm building **SPS Prism**, an AI-powered photo archiving and organization tool for professional photographers. It's the sister product to **SimplePhotoShare (SPS/spsv2)**, which handles client gallery delivery. Prism handles the step before delivery: organizing, culling, and storing the raw shoot output.

### What's already built (at ~/sps-archive)

The project scaffold is complete with working code (not yet deployed). Here's what exists:

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (PostgreSQL + pgvector), Cloudflare R2, Modal (serverless GPU), Inngest, sharp, exifr.

**Database schema** (9 tables): events, images (with clip_embedding vector(768), scene_tags, aesthetic_score, sharpness_score), faces (with ArcFace embedding vector(512)), persons, stacks, sections, section_images, shares, favorites. Plus two RPC functions for vector similarity search.

**API routes:**
- `GET/POST /api/events` — list + create events
- `POST /api/upload` — presigned R2 URLs for direct client uploads
- `POST /api/upload/complete` — finalize upload with EXIF, trigger processing
- `GET /api/search` — unified search (filename + semantic CLIP vector search)

**AI pipeline** (`modal/ai_pipeline.py`): CLIP ViT-L/14 (768-dim embeddings + zero-shot scene classification with 25 categories), ArcFace/insightface buffalo_l (face detection + 512-dim embeddings + eyes-open detection), aesthetic scoring (sharpness + exposure + composite).

**Core algorithms:**
- Smart Stacks: face-based (grouped by person, ranked by aesthetic×0.4 + sharpness×0.3 + eyes_open×0.3) and burst-based (images within 2s, ranked by aesthetic×0.6 + sharpness×0.4)
- Auto Sections: scene-tag based (timeline-ordered, 3+ images threshold) and headshot-alphabetical (persons grouped by first letter)

**UI components:** Button (4 variants, 3 sizes), UploadZone (drag-and-drop with presigned URL upload + EXIF extraction), SmartStack (expandable card with fanned effect), ImageGrid (CSS masonry with stacks + standalone), SearchBar (debounced with auto/semantic/filename toggles)

**Pages:** Home (hero + features), Create Event (form), Event Detail (upload + search + section tabs + image grid), Global Search.

**SPS integration layer:** `src/lib/sps-integration/` with types and import function. Key design: shared R2 bucket means zero-copy imports. Archive creates metadata pointing to existing R2 keys. After AI processing, Archive sends enhancements (stacks, sections, tags) back to SPS.

**Design system:** Tailwind stone palette (stone-900 primary, white/stone-50 surfaces), minimal custom components, lucide-react icons, CSS columns masonry layout.

Full docs at `~/sps-archive/docs/PRD.md` and `~/sps-archive/docs/TECHNICAL.md`.

---

### What I need you to do in this session

**1. Review the SPS site (at ~/documents/spsv2)**

Please read the spsv2 codebase and analyze:
- Tech stack — what frameworks, libraries, styling approach does it use?
- Design system — colors, typography, component patterns, branding
- Data model — how are events/galleries/images structured?
- Authentication — how does auth work?
- Image storage — where and how are images stored?
- Any API patterns we should align with

**2. Identify integration opportunities**

Compare the two codebases and tell me:
- Which components/utilities could be shared or aligned?
- What design system changes would make them feel like the same product family?
- Are there features in Archive that SPS should also have (or vice versa)?
- What's the best approach for shared auth?
- Confirm the shared R2 bucket assumption — does SPS already use R2?

**3. Product naming brainstorm**

"SPS Prism" is the product name. I need to verify the branding:
- Connects to SimplePhotoShare without being generic
- Works as a standalone brand too
- Communicates the AI-powered organization angle
- Feels professional (target: pro photographers)

Let's brainstorm options and narrow down.

**4. Continue building**

After the review and naming, I'd like to continue building out the Archive product. Priority areas:
- Align design system with SPS findings
- Wire up real Supabase data connections
- Build out any missing critical features
- Deploy pipeline (Inngest event-driven processing)

---

### Key architectural decisions already made
- **Shared R2 bucket** between SPS and Archive (zero-copy imports)
- **Supabase with pgvector** for semantic search via CLIP embeddings
- **Modal serverless GPU** for AI processing (CLIP + ArcFace + aesthetic scoring)
- **Presigned URL uploads** (client → R2 direct, no server bottleneck)
- **Inngest** for async event-driven processing pipeline
- **CSS columns masonry** (no JS measurement)
- **Stone color palette** from Tailwind (intentionally muted/professional)
