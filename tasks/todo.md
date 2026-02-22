# SPS Archive - Build Plan

## Phase 1: Project Foundation [DONE]
- [x] Initialize Next.js project (TypeScript, Tailwind, App Router)
- [x] Database schema (Supabase + pgvector)
- [x] R2 storage client
- [x] Supabase client setup

## Phase 2: Upload Pipeline [DONE]
- [x] Upload API route (presigned URLs → direct R2 upload)
- [x] Upload UI (drag-and-drop with react-dropzone)
- [x] EXIF extraction + filename parsing (SmithJohn_001.jpg → "Smith, John")
- [x] Upload completion endpoint (triggers AI processing)

## Phase 3: AI Pipeline [DONE]
- [x] Modal serverless GPU functions (CLIP + ArcFace + aesthetic scoring)
- [x] CLIP embedding generation (768-dim, semantic search)
- [x] ArcFace face detection + embedding (512-dim, face clustering)
- [x] Aesthetic scoring (sharpness, exposure, eyes-open)
- [x] Zero-shot scene classification (25 scene categories)
- [x] Smart stack grouping logic (face stacks + burst stacks)
- [x] Auto-generated sections (scene-based for events, alphabetical for headshots)

## Phase 4: Gallery + Search [DONE]
- [x] Semantic search API (text → CLIP embedding → vector search)
- [x] Filename search
- [x] Search UI with mode switching (auto/semantic/filename/selfie)
- [x] SmartStack component (expandable, best-on-top, "set as best")
- [x] ImageGrid (masonry layout with stacks + standalone images)
- [x] Section tabs (AI-generated, overlapping sections)
- [x] Event creation page
- [x] Global search page (cross-event archive search)

## Phase 5: SPS Integration [IN PROGRESS]
- [x] Define SPS↔Archive contract types
- [x] Import from SPS (shared R2 bucket, no re-upload needed)
- [x] Enhancement export (send AI results back to SPS)
- [ ] Wire up API endpoint for SPS → Archive transfer
- [ ] Wire up API endpoint for Archive → SPS enhancements push
- [ ] Shared auth (same Supabase project)

## Phase 6: Polish + Production [TODO]
- [ ] Connect spsv2 branding (need access to repo for colors/fonts/components)
- [ ] Inngest event orchestration (upload → AI → stacks → sections)
- [ ] Face clustering pipeline (DBSCAN on ArcFace embeddings)
- [ ] Lightbox/image viewer
- [ ] Share link generation + client-facing gallery
- [ ] Favorites/proofing
- [ ] Auth flow (login/signup)
- [ ] Vercel deployment config
- [ ] Modal deployment
