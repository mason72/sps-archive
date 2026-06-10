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

## Manual (drag-to-reorder) sort [BUILT — pending editor hands-on QA]
Plan: `~/.claude/plans/curried-snacking-feather.md`
- [x] Migration `012` — backfill `section_images.sort_order` to gapless/unique per section (was AI relevance buckets, 747 dup groups → 0) + `idx_section_images_section_sort`. Applied + verified on remote DB.
- [x] `order-manual.ts` (+8 tests): `orderBySectionManual`, `orderByPrimarySection` (All Images). `GallerySortMode = SortBy | "manual"` (comparator untouched).
- [x] `PUT /api/sections/[sectionId]/images/reorder` — full-list batched upsert, section→event→user auth, membership-safe.
- [x] Editor API returns ordered `imageIds` per section; public API orders by `sort_order, image_id`.
- [x] Editor: "Manual" sort + dnd-kit reorder in `ImageGrid` (single SortableContext over masonry, closestCenter, 8px activation, DragOverlay + multi-select block move, stacks expanded). Optimistic save + toast. Drag gated to manual+real-section+no-filters. All Images read-only.
- [x] Public: "Featured" (manual) default; dropdown keeps Latest/Filename/Date taken.
- [x] Auto-switch: dragging in ANY sort within a real section reorders + switches to Manual (seed-from-view, WYSIWYG) with an Undo toast that restores prior sort + saved order.
- [x] Cover fix: cover uploads pass `skipSection` (no section membership); editor flags `isCover` + strips legacy cover from sections; derive-display excludes cover from the grid. Public already filtered.
- [x] Verified: 39/39 tests, tsc clean, `next build` green. Public gallery E2E (real share) — render matches stored order, re-sort + restore works. Auth guards 307 unauth.
- [ ] Editor E2E (auth-gated — needs logged-in browser): drag (single + multi-select), auto-switch + Undo, click/dbl-click/drag coexistence, reload persistence, cover upload not in grid.

Decisions: public label "Featured" vs editor "Manual"; stacks expand when drag is live (0 stacks today; unit-drag is a fast-follow); drag = reorder, so cross-section moves use the SelectionToolbar (drag-to-sidebar superseded — unified drag is a possible follow-up).

Follow-up fix: masonry columns were uneven (one column "way too tall") in small sections — round-robin balances item COUNT not HEIGHT, very visible with few rows. Added `distributeBalanced` (shortest-column-first, ties→leftmost so row 1 still reads L-to-R) in grid-layout.ts; both editor (ImageGrid, incl. dnd path) and public (GalleryGrid) now use it. Verified public Light Painting (10 imgs/5 cols): column-height spread 11% (was lopsided). Compatible with dnd reorder (sequence is layout-independent). +5 unit tests.

## Phase: Public Marketing Lane (Two Dudes Photo website) [BUILT + INFRA VERIFIED — pending commit/deploy]
Separate PUBLIC R2 lane for curated marketing imagery. Private client galleries
(sps-prism + presigning) stay completely unchanged.
- Decisions: sps-public bucket; r2.dev public URL for now (pixeltrunk.com is NOT a CF zone, so no
  custom domain without a nameserver move — `R2_PUBLIC_LANE_URL` swap later, zero code change);
  existing R2 token broadened to sps-prism+sps-public (same key pair) → server-side CopyObject;
  city on events; site_scene/service/featured/display_order on images; service auto-derives from service/* scene keys.
- [x] Migration (events.city; images scene fields + partial idx) — applied to live DB via Supabase MCP
      (recorded as timestamped `site_scenes`; local file renamed 013→`019_site_scenes.sql` because the
      remote history already had 013–018 that aren't in the repo — repo migrations dir is out of sync, see follow-up)
- [x] r2/public-lane.ts (getPublicLaneUrl, copyToPublicLane, deleteFromPublicLane)
- [x] site/scenes.ts (registry + deriveServiceFromScene) · site/publish.ts (thumb-md + display only, never raw originals)
- [x] set_scene action in /api/images/batch · SelectionToolbar globe picker · events page wiring
- [x] GET /api/site/scene/[...key] (catch-all for service/* keys; X-SPS-Key; non-expiring URLs)
- [x] verifySharedSecret in sps-integration/auth.ts
- [x] docs/SITE-INTEGRATION.md (.env.example is hook-protected — env lines live in the doc)
- [x] tests 55/55 · lint warnings-only · next build green (route registered)
- [x] INFRA: sps-public bucket created · r2.dev public URL enabled
      (https://pub-d26e68845d7742259c52f68cbb95e72e.r2.dev) · token broadened · Vercel env vars set
      (R2_PUBLIC_BUCKET_NAME, R2_PUBLIC_LANE_URL → Production+Preview, via REST API; CLI env add loops on a prompt bug)
- [x] E2E STORAGE PROOF: CopyObject sps-prism→sps-public OK with app creds; public URL curl → 200 image/jpeg
      no-auth no-expiry; delete → 404 (unpublish path proven). Test object cleaned up.
- [ ] Commit + push (auto-deploys Vercel) — awaiting user OK
- [ ] Post-deploy E2E: tag real images via UI → curl /api/site/scene/... → 200 with public URLs
- [ ] Follow-up: reconcile supabase/migrations/ with remote history (remote has 013_subscriptions…018_section_atomicity not in repo)
- [ ] Follow-up: .env.local — user attempted to add the 2 public-lane vars but parser shows them absent (local dev only)
- [ ] Later: custom domain cdn.pixeltrunk.com (add zone to CF → connect on bucket → update env var)

## Phase: Website Content Model v2 — "TDP Website" gallery [SHIPPED + LIVE E2E VERIFIED 2026-06-09]
Spec: ~/Documents/Projects/TDP/tdp-website/tasks/pixeltrunk-content-model-v2.md
Client rejected per-image site_scene tags ("impossible to backtrace"); the site is now
ONE gallery whose sections ARE the content slots (pool = rotating grid, slot = explicit
single-image position, first by sort_order wins).

Design decisions:
- Membership, not duplication: website sections hold section_images rows pointing at
  ORIGINAL images in their source events (cross-event membership). images.r2_key is
  UNIQUE so row-copying was never possible; the source pointer (event_id → name/city)
  keeps Featured Work captions on the same join v1 used.
- sections.site_scene_key (nullable, unique) marks website sections; registry stays in
  code (scenes.ts v2 with kind: pool|slot); gallery + sections scaffold lazily.
- Publication = membership: idempotent syncSitePublication(ids) reconciles desired
  state (any website-section membership) → copy/delete public variants + maintain
  site_published_at. Hooked into every membership mutation path; image DELETE
  unpublishes directly (v1 leaked public copies on delete — fixed).
- Ordering moves to section_images.sort_order (drag order in the gallery UI).
- Focal point: images.focal_x/focal_y (0–100, null), toolbar action on slot sections,
  API gains focalX/focalY. Contract otherwise byte-compatible with v1.

- [x] Migration 020_website_gallery.sql (site_scene_key + partial unique idx, focal_x/y,
      scaffold gallery + 28 sections, migrate v1 tags → membership preserving order;
      idempotent, leaves deprecated images.site_scene as audit trail)
- [x] scenes.ts v2 registry (28 scenes, kind pool|slot) + gallery.ts lazy scaffold +
      membership.ts syncSitePublication (desired-state, idempotent, per-image failure
      isolation, R2-success-before-DB-marker so failures self-heal on next sync)
- [x] Scene API: membership-backed query, slot first-wins (count ≤ 1), focalX/focalY,
      read-time service fallback; auth + response fields + Cache-Control byte-stable;
      extra site_published_at gate so a failed R2 copy can't serve a broken URL
- [x] POST/DELETE/GET /api/site/gallery (globe gesture v2 backend, getAuthUser +
      ownership filters)
- [x] Sync hooks: sections images POST/DELETE, section DELETE (after orphan rescue),
      batch add/remove_from_section, batch DELETE (fixes v1 leak: deleting a published
      image left public copies), upload/[imageId] + upload/complete + inngest
      thumbnail-complete (direct uploads into website sections publish when thumbs exist)
- [x] events/[eventId]: cross-event member images fetched into the payload (website
      gallery renders curated images from source events) + sections.siteSceneKey +
      focalX/Y; new PATCH /api/images/[imageId] {focalX, focalY} (0-100 or null)
- [x] UI: globe v2 grouped Pools/Slots picker → /api/site/gallery; FocalPointModal
      (click-to-set, display-res image, marker, clear); crosshair toolbar action when
      1 selected in a slot section; "first image wins" hint on multi-image slots;
      set_scene action + handler retired
- [x] database.types.ts hand-updated; tests 74/74 (scenes v2, route contract incl.
      slot semantics + cache regression, membership sync matrix); lint warnings-only
      (pre-existing); next build green; docs/SITE-INTEGRATION.md rewritten for v2
- [x] Migration applied by user (verified via Supabase MCP: columns present, gallery +
      28 sections scaffolded; prod had 0 v1-tagged images so the data migration was a
      no-op as expected)
- [x] Pushed 1ce61cc → Vercel production deploy (probed live by slot/slice-1 404→200)
- [x] LIVE E2E (scripts/verify-site-v2.ts drives the real syncSitePublication + R2 lane
      against prod DB; deployed API curled in between):
      · pool add → API 200 with source-event caption, auto-filled service, public URLs
      · slot with 2 images → API returns ONLY first-by-drag-order, extras ignored,
        focalX/focalY served (33.3/25)
      · public thumb URL → 200 image/jpeg, no auth, no expiry
      · no key → 401; unknown scene → 404 (cache headers unchanged)
      · remove → API count 0, all 4 public copies 404, site_published_at cleared
      · test images fully restored (service/focal/memberships reset)
- [ ] Website repo follow-ups: consume focalX/focalY (object-position); UI gesture
      spot-check (globe → add → remove) next time someone is logged into the app
- [ ] Later: drop deprecated images.site_scene + v1 partial index once v2 soaks

## Phase 13: Website curation editor (toolbar panel + face auto-focal)
Scope agreed 2026-06-09. Focal picker already shipped in v2 — this adds the
metadata editor, defaults, and face-based auto-focal.
- [x] scenes.ts: export canonical SITE_SERVICES list (derived from registry)
- [x] lib/site/focal.ts (new): computeAutoFocal(faces) — exactly one face above
      quality bar → eye-level point (bbox top + 35% h), else null; + unit tests
- [x] PATCH /api/images/[imageId]: accept service (canonical slug|null) +
      featured (boolean); GET returns service/featured/suggestedFocalX/Y
- [x] PATCH /api/events/[eventId]: accept city
- [x] GET /api/events/[eventId]: image payload + service/featured/eventId/
      eventName/eventCity (join source event)
- [x] membership.ts syncSitePublication: auto-fill focal for slot-scene images
      with focal unset (writes into null only, never overwrites)
- [x] types/image.ts: extend ImageData
- [x] SelectionToolbar: onEditWebsiteDetails action (website context only)
- [x] CurationModal (new): event name+city (event-level, multi-event → city-
      only bulk), service select, featured tri-state toggle
- [x] events/[eventId]/page.tsx: wire action + modal + local state update
- [x] ImageGrid: focal-point corner dot on slot-section tiles (prop-gated)
- [x] FocalPointModal: pre-place suggested focal from faces, with hint
- [x] lint + vitest + next build (build before commit — main auto-deploys)
- [x] Live E2E: edit via API → curl /api/site/scene/featured-work with
      X-SPS-Key → fields reflect; slot auto-focal verified
- [x] Commit atomically; confirm with Mason before push

### Phase 13 review (2026-06-09)
- Shipped: CurationModal (toolbar "Edit website details" — event name/city at
  event level, service, featured; multi-select bulk incl. multi-event city),
  PATCH images service/featured (validated vs SITE_SERVICES), PATCH events
  city, event GET payload + ImageData carry service/featured/eventId/
  eventName/eventCity, slot auto-focal in syncSitePublication via new
  lib/site/focal.ts (one confident face → eye-level point, writes into null
  only), FocalPointModal pre-places the face suggestion, crosshair badge on
  slot tiles. Docs updated (SITE-INTEGRATION.md workflow steps 3–4).
- Tests 91/91 (was 74): focal unit tests, membership auto-focal matrix,
  images PATCH route tests. Lint warnings-only (pre-existing); build green.
- LIVE E2E (scripts/verify-curation-e2e.ts, local dev API + prod DB,
  self-restoring): hero pool city/service/featured edits reflected in
  /api/site/scene + restored; slot add → real sync auto-filled focal 50/25.3,
  slot winner untouched, fully restored.
- FINDING: prod faces table is EMPTY and 0/4468 images have clip_embedding
  despite status "complete" — AI pipeline results never persisted. Auto-focal
  is dormant (degrades to no-op) until that's fixed; spawned a follow-up task.
  Slot E2E used a seeded synthetic face row (removed in teardown).
- UI gesture spot-check (toolbar → modal → save) still needs a logged-in
  session, same as the v2 handoff note.

## Phase 14: Retire "Add to website" + auto-revalidate the TDP site
Per Mason 2026-06-09 + tdp-website/tasks/pt-auto-revalidate-brief.md.
- [x] SelectionToolbar: globe "Add to website…" picker removed (page handler +
      POST call gone; POST /api/site/gallery kept for programmatic use).
      "Remove from website" promoted to a standalone globe button, gated to
      website context. NOTE: the picker was functional, not dead — removing it
      means no UI path publishes images from a CLIENT event anymore; the
      workflow is now upload/curate inside the TDP Website gallery.
- [x] lib/site/revalidate.ts: scheduleSiteRevalidate() — env-gated
      (TDP_SITE_REVALIDATE_URL/SECRET, silent skip when unset), trailing 4s
      per-process debounce (later calls supersede), next/server after() keeps
      the serverless fn alive (detached-promise fallback outside request
      scope), warns on failure, never blocks the user action. Optional
      TDP_SITE_REVALIDATE_BYPASS → x-vercel-protection-bypass header.
- [x] Call sites (all gated to website content at the source):
      syncSitePublication (only when publish/unpublish work happened — after
      the R2 public-lane copy, per the brief's ordering rule), images PATCH
      (only when site_published_at set), events PATCH (name/city, only when
      the event has published images), section reorder (only site_scene_key
      sections). Client-gallery mutations never ping.
- [x] Tests 96/96 (revalidate: env-gating, trailing debounce, burst-collapse,
      bypass header, warn-not-throw); lint clean; build green.
- [x] LIVE: found REVALIDATE_SECRET was NEVER set in the tdp-website Vercel
      project (deployed webhook always 401'd — the brief assumed it existed).
      Added it via vercel CLI (production), redeployed tdp-website → webhook
      now 200 {ok:true} w/ key, 401 w/o. Added TDP_SITE_REVALIDATE_URL/SECRET
      to pixeltrunk production env (applies on next deploy). Live demo: 5
      rapid schedules → exactly 1 ping → HTTP 200. E2E driver re-run: ALL PASS.
- [x] Caveat: tdp-website intermittently served a Vercel bot-challenge (403)
      to non-browser requests earlier in the session. If prod pings start
      logging 403, enable "Protection Bypass for Automation" on tdp-website
      and set TDP_SITE_REVALIDATE_BYPASS in pixeltrunk — code already sends
      the header.
