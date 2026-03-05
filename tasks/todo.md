# Pixeltrunk - Build Plan

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
- [x] Filename search (real-time, 100ms debounce)
- [x] Search UI with mode switching (auto/semantic/filename/selfie)
- [x] SmartStack component (expandable, best-on-top, "set as best")
- [x] ImageGrid (masonry layout, JS round-robin for L→R reading order)
- [x] Section tabs (AI-generated, overlapping sections)
- [x] Event creation page
- [x] Global search page (cross-event archive search with real images)

## Phase 5: Design System [DONE]
- [x] Editorial design system (Playfair Display + Inter, stone palette, emerald accent)
- [x] All 11 component files rewritten with editorial styling
- [x] Pricing strategy defined (docs/PRICING.md)

## Phase 6: Data Wiring + Processing Pipeline [DONE]
- [x] GET /api/events/[eventId] — single event with images/stacks/sections
- [x] Event detail page fetches real data (replaced stubbed loadEvent)
- [x] Search results include presigned thumbnailUrls
- [x] Inngest client with typed event schemas
- [x] Inngest functions: processUploadedImage, buildEventStacks, processImportedEvent
- [x] Inngest API route (serve endpoint)
- [x] Upload/complete triggers Inngest pipeline
- [x] SPS import triggers Inngest pipeline
- [x] Thumbnail generation utility (sharp, 3 sizes)
- [x] Set as Cover endpoint (PUT /api/stacks/[stackId]/cover)
- [x] Homepage event list dashboard
- [x] 0 TypeScript errors, all routes 200

## Phase 7: Auth + Shares + Polish [DONE]
- [x] Auth flow (login/signup with Supabase)
- [x] Middleware route protection + session refresh
- [x] Share link generation + client-facing gallery
- [x] Password-protected galleries
- [x] Favorites/proofing workflow (localStorage + server)
- [x] Lightbox / image viewer with metadata panel
- [x] Image detail API with EXIF + download URLs

## Phase 8: Thumbnail Pipeline + Fixes [DONE]
- [x] Fix processing_status check constraint ("uploaded" → "complete")
- [x] Fix 446 images stuck at "pending" status
- [x] Thumbnail generation wired into upload/complete (fire-and-forget)
- [x] All API endpoints serve thumbnailUrl (thumb-md) + originalUrl (original)
- [x] Grid images use thumbnail with onError fallback to original
- [x] Lightbox uses originalUrl for full-res viewing
- [x] Search page renders actual image thumbnails (was text placeholders)
- [x] Events API scoped to authenticated user (service client RLS bypass fixed)
- [x] Homepage force-dynamic to prevent caching stale auth state
- [x] Upload concurrency increased to 12 workers
- [x] EXIF extraction made non-blocking (fire-and-forget)
- [x] Search debounce optimized (100ms filename, 400ms semantic)
- [x] Semantic search graceful fallback when Modal not configured
- [x] .env.example updated with MODAL_API_URL
- [x] Migration 003 ready (thumbnail_generated column)

## Phase 8.5: Rebrand — Prism → Pixeltrunk [DONE]
- [x] Elephant pixel-mosaic logo (trunk2 clean, trunk1 artistic)
- [x] Libre Baskerville wordmark (font-brand)
- [x] Elephant favicon (icon.png)
- [x] All ~40 files updated from "Prism" to "pixeltrunk"
- [x] Style playground with 15 typography variations

---

## Phase 9: QA + Polish Sprint [TODO]

### 🔴 Bugs to Fix
- [ ] Remove `|| true` debug artifact on event detail section tabs (always renders even when no sections)
- [ ] Add error state when event fetch fails (currently shows blank "Event" heading forever)
- [ ] Add Suspense boundary around login page `useSearchParams()` (Next.js 15 requirement)
- [ ] Fix `selection` object in useEffect dependency array causing re-renders on every render

### 🟡 Architecture Cleanup
- [ ] Extract shared `<Nav />` — 9 pages duplicate nav bar with subtle spacing inconsistencies (gap-2 vs gap-2.5, gap-6 vs gap-10)
- [ ] Extract shared `<Footer />` — 6 pages duplicate footer, some with truncated tagline
- [ ] Consolidate event detail page state — 20+ useState hooks → custom hooks (useUploadState, useModalState, useImageFilter)
- [ ] Remove 5 console.log statements from production code
- [ ] Remove unused `Palette` import from account page
- [ ] Replace inline SVGs with lucide-react equivalents (AlertTriangle, X, Grid3X3)

### 🟢 Elegance & Delight
- [ ] Add `loading.tsx` files for instant visual feedback during server component rendering
- [ ] Add keyboard navigation to gallery lightbox (arrow keys, Escape)
- [ ] Animate upload zone toggle (slide-down/fade instead of abrupt show/hide)
- [ ] Make search results grid responsive (currently hardcoded 5 columns)
- [ ] Add meaningful alt text to images using parsedName/originalFilename
- [ ] Add aria-labels to 8+ icon buttons (upload toggle, share, settings, lightbox nav)
- [ ] Add `role="dialog"` + focus trap to gallery lightbox
- [ ] More inviting empty state for event detail (illustration + CTA button)
- [ ] Per-page `<title>` tags ("Johnson Wedding — Pixeltrunk" instead of generic)
- [ ] Add image width/height attributes to prevent layout shift (CLS)

### 💡 Nice-to-Haves
- [ ] Personalized dashboard greeting ("Good morning, [Name]")
- [ ] Batch download via zip endpoint (current approach creates N simultaneous downloads)
- [ ] Memoize search results column distribution with useMemo
- [ ] Footer on login/signup/search pages for visual consistency

---

## Phase 10: Production Readiness [IN PROGRESS]

### Code (Done)
- [x] Migration 003 — thumbnail_generated column (file exists, needs applying to prod DB)
- [x] Migrations 004–008 — user_profiles, email_templates, share_image_ids, download_pin, event_templates
- [x] database.types.ts manually maintained matching all 8 migrations
- [x] Batch thumbnail endpoint: `POST /api/admin/batch-thumbnails` (processes in chunks with concurrency)
- [x] Batch thumbnail status: `GET /api/admin/batch-thumbnails` (check progress)
- [x] Fixed upload/complete + Inngest to set `thumbnail_generated = true`
- [x] Security headers in next.config.ts (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- [x] Gallery routes allow SAMEORIGIN framing (for portfolio embeds)
- [x] Vercel project linked (.vercel/project.json)
- [x] next.config.ts R2 remote patterns + 100mb server action limit

### Infrastructure (Needs Manual Action)
- [ ] Apply all migrations to production Supabase (run SQL files in order)
- [ ] Run batch thumbnail backfill: `POST /api/admin/batch-thumbnails` (call repeatedly until remaining = 0)
- [ ] Deploy Modal AI pipeline: `modal deploy modal/ai_pipeline.py`
- [ ] Configure R2 custom domain (Cloudflare dashboard → R2 → Custom Domain)
- [ ] Set all env vars in Vercel project settings
- [ ] Deploy to Vercel: `vercel --prod`

## Phase 11: SPS Integration [DONE]
- [x] Wire up API endpoint for SPS → Archive transfer (`POST /api/sps/import`)
- [x] Wire up API endpoint for Archive → SPS enhancements push (`GET /api/sps/enhancements/[eventId]`)
- [x] Shared auth — dual auth strategy (Supabase JWT for user actions, API key for service-to-service)
- [x] SPS auth helper (`src/lib/sps-integration/auth.ts`) with JWT validation + `X-SPS-Key` support
- [x] Fixed `importFromSPS()` to accept userId param (service client can't call `getUser()`)
- [x] Middleware updated — `/api/sps/*` routes bypass cookie auth (handled by route-level auth)
- [x] `SPS_INTEGRATION_KEY` added to `.env.example`
- [x] Input validation on import endpoint (required fields, per-image validation)
- [x] Enhancements endpoint returns processing progress (202) or complete results (200)
- [x] 0 TypeScript errors

## Phase 12: Future Enhancements [TODO]
- [ ] Face clustering pipeline (DBSCAN on ArcFace embeddings)
- [ ] ClientIdentityModal for guest favorites
- [ ] Bulk download (zip generation)
- [ ] Image comparison view
- [ ] Activity log / analytics dashboard
