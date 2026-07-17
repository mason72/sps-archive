# Pixeltrunk - Build Plan

## Cover System v2 — focal point + auto-mosaic covers [BUILT 2026-07-16, verified locally]
All 7 phases done in one pass; 227 tests green, build green, E2E on live data.
- **Model:** `cover.type: image | mosaic | solid | crossfade` in events.settings JSONB (no migration). `normalizeCoverSettings()` in event-settings.ts is the ONLY parse point — gallery API, preview API, OG, email cover, raster job all go through it. Legacy rows normalize to `image`.
- **Focal point** `{x,y}` 0–1: drag-pin in CoverLayoutTab, `object-position` in CoverSection, feeds the OG crop. Fixes the face-cropping complaint.
- **Mosaic engine** `src/lib/cover/mosaic.ts` (pure, 14 tests): stack-dedupe via buildStacks (one tile per person), mulberry32 seeded shuffle (stored seed + Shuffle button), rows 2–4 with column-squeeze-before-row-shed for small pools, insert-hole geometry (row-snapped, parity-centered, logo-relative padding; full-height 2-row holes drop logo frac to 0.35 or wide logos swallow the band).
- **Renderers:** CoverSection.tsx switches all 4 types live (client tiles from payload images+sections — no extra presigns); raster.ts composes 1600×900 JPEG via sharp for email/OG. Solid = spsv2-style gradient (colors[] + angle), satori renders it natively in OG even before the raster lands.
- **Raster pipeline:** Inngest `cover-raster` (debounced 15s/event, fired from events PATCH + serve-time staleness probes). Fixed key `events/{id}/covers/cover-raster.jpg`, inputs-hash in R2 metadata, stale-while-revalidate in pool.ts. Sharp NEVER inline in a request. pool.ts is deliberately sharp-free for route imports.
- **Per-event client logo** (≠ photographer branding): `/api/events/[eventId]/cover-logo` POST presign + GET view, fixed key `events/{id}/branding/cover-logo.{ext}`, prefix-pinned against the IDOR class.
- **Title interplay:** client logo present ⇒ event title auto-hidden (`coverShowsTitle`), overridable via hideTitle toggle.
- **Verified:** `scripts/verify-cover-v2.ts` (self-restoring, ran on "Two Dudes Sample Images"): all 3 raster looks composed + hash-checked + eyeballed; live browser QA of overlay/insert/crossfade/solid + mobile 375px + OG route. NOT yet verified: editor CoverLayoutTab UI in a real session (needs login — co-drive after deploy), email render in a real client.
- **Review round (zero-context diff review, commit a091b14):** critical logoKey JSONB-IDOR pinned at both sinks (lesson 30); OG focal crop reimplemented — satori ignores objectPosition (lesson 31); raster pool re-gated to thumbnail_generated + videos excluded BOTH renderers (lesson 32); selection shares never serve the whole-section raster; debounce timeout 2m; stale imageId no longer hides grid photos; cover-only change detection on PATCH; crossfade mounts 3 frames; strict #RRGGBB; 15MB logo read cap. 236 tests green, E2E re-run green.
- Backlog: marquee scrolling cover; photomosaic-logo-from-dominant-colors (playground prototype first); mini live mosaic preview inside the settings tab.

## (original plan) Cover System v2 [2026-07-16]
Fix the cover-crop problem (faces cut off — no focal control) and add auto-generated
mosaic covers built from a section, in the style of the old TDP gallery covers
(eBay/Uber/Pure Storage looks: photo wall + client logo overlay or insert).

**Decided (interview 2026-07-16):**
- Cover becomes typed: `image` (existing) · `mosaic` (new) · `solid` (color+logo preset) · `crossfade` (hero cycles top highlights). Back-compat: untyped existing covers = `image`.
- **Focal point** `{x,y}` normalized 0–1 on image covers; drag-pin UI on the settings preview; renders as `object-position`; ALSO feeds the OG 1200×630 crop (social shares crop too).
- **Mosaic:** source section picker · rows 2–4 (columns auto from viewport at ~3:4 portrait tiles; band stays 50–60vh) · tiles **stack-deduped via buildStacks** (one per person — no repeated faces) · top-biased tile crop (never crop into faces) · stored **seed + Shuffle button** (deterministic between visits) · too-few-images ⇒ drop rows, never repeat tiles · videos excluded.
- **Logo modes:** none / overlay (logo + color wash: color, opacity, optional backdrop-blur — the eBay look) / insert (center hole: padding, fill color — the Uber look). Per-EVENT logo upload (client's logo, R2, distinct from photographer branding logo). Logo present ⇒ event title defaults hidden/below (overridable).
- **Solid cover (upgraded per Mason 2026-07-16):** settings = logo upload, logo padding, `colors: string[]` + `angle` — 1 color = solid, 2+ = linear-gradient at the chosen angle (same behavior as spsv2's header/gallery gradient: `linear-gradient(angle, stops)`, default 135°). No longer just an overlay preset — its own cover type.
- **Raster pipeline (mosaic everywhere incl. email — Mason's call):** settings-save fires an Inngest job → sharp composes JPEG from thumb-sm tiles → R2 `events/{id}/covers/{hash}.jpg` (hash = settings + tile ids). Serving routes (email cover, OG) use the raster; if inputs drifted, serve stale + enqueue refresh. **Sharp NEVER runs inline in a request** (eBay-incident rule).
- Backlog (not this build): marquee scrolling cover; photomosaic-logo-from-dominant-colors (prototype in /playground first).

Phase 1 — Settings model:
- [ ] `event-settings.ts`: `cover.type` discriminated union + focal point + mosaic/solid/crossfade settings; defaults; back-compat normalization helper (single parse point used by gallery API, preview API, OG, email cover).
Phase 2 — Focal point:
- [ ] CoverSection: `object-position` from focal point (public + preview galleries).
- [ ] CoverLayoutTab: drag-pin on the cover preview, live.
- [ ] OG route: focal-aware crop.
Phase 3 — Mosaic engine (pure, tested):
- [ ] `src/lib/cover/mosaic.ts`: tile selection (section → buildStacks dedupe → seeded shuffle → fit to rows×cols) + layout math shared by live CSS grid AND raster composer. Tests.
Phase 4 — Live mosaic + settings UI:
- [ ] `MosaicCover` component: CSS grid tiles, overlay mode (color/opacity/blur), insert mode (hole + padding + fill), logo render, mobile column behavior.
- [ ] CoverLayoutTab: type picker, section picker, rows, logo mode + settings, Shuffle, live mini-preview.
- [ ] Per-event logo upload (R2 asset under the event, presigned serve).
Phase 5 — Solid cover + crossfade hero:
- [ ] Solid cover type: logo + padding + colors[] + angle (multi-color ⇒ gradient, spsv2-style); live render + raster (sharp gradient fill or SVG rasterize).
- [ ] Crossfade: CoverSection accepts image list, slow cycle; email/OG use first frame (focal-aware).
Phase 6 — Raster pipeline:
- [ ] Inngest `cover-raster` job (sharp composite from thumb-sm, R2 write, input-hash).
- [ ] Email cover route + OG route: serve raster for mosaic/solid; stale-hash ⇒ serve old + enqueue.
Phase 7 — QA + ship:
- [ ] Tests + `next build` green; E2E on a real photo-booth test event (all 4 types, both logo modes, mobile 375px); email render check; OG validator; SPS live-event gate before push; docs + lessons.

## Auto-Sections [SHIPPED 2026-07-10]
Phase 1–4 all done. `src/lib/sections/auto-plan.ts` (pure, 11 tests) — detectNaming + planAutoSections (letter-range / per-person / even; never splits a letter; unmatched→Misc; reuses `personNameFromParts` from stacks.ts, no AI). GET `/api/events/[eventId]/section-plan` (images+detection for the live preview) + POST `/api/events/[eventId]/auto-sections` (repurposed the dead AI route: wipe is_auto sections, materialize; Highlights/manual untouched; ownership-scoped, reportSystemError-wired). UI: "Sort into sections…" in the sidebar SectionsPanel → `SortSectionsModal` (detection summary, 3 mode cards, stacks toggle, max-per-section slider with smart default, live section list via the shared planner, Apply). E2E verified on a 45-photo/15-person test event: detection correct, letter/per-person/stacks all right, idempotent regenerate wipes only auto sections, Highlights preserved. 202 tests green, build green.
Known follow-ups (raised with Mason): the big dump lands in Highlights (default upload target) so after sorting Highlights holds everything until curated — consider a "move out of the dump section" option or a real neutral catch-all. Idea parked: per-person direct links.

## (superseded) ACTIVE: Auto-Sections — dump a big upload, let it sort itself [2026-07-10]
Photographer dumps a giant headshot set, hits "Sort into sections," app creates balanced scannable sections (first-name letter ranges, or one-per-person for small jobs) so nobody hand-makes 15 sections. Optional per-person stacking. Live preview before applying. Regenerate anytime.

**Decided:** preview button (not auto-on-finish) · name-based stacking (reuse `buildStacks`/`stackPersonName`, AI face path stays off) · "All Images" (derived) + "Highlights" (default) already exist · smart default + tap-to-override in the preview · auto sections are `is_auto:true` so regenerate wipes ONLY those (Highlights + manual untouched).

Phase 1 — Pure logic (tested):
- [ ] `src/lib/sections/auto-plan.ts`: `personNameFromParts` (refactor in stacks.ts), `detectNaming`, `planAutoSections` (letter-range / per-person / even, never split a letter, unmatched→Misc).
- [ ] `auto-plan.test.ts`.
Phase 2 — API (ownership-scoped):
- [ ] `GET /api/events/[eventId]/section-plan` (units + detection for preview).
- [ ] Repurpose `POST /api/events/[eventId]/auto-sections` (apply: wipe is_auto, materialize).
Phase 3 — UI: "Sort into sections" in SectionsPanel → preview (mode toggle, stacks, slider, live section list) → Apply.
Phase 4 — Verify (tests+build+E2E) + ship (SPS gate) + docs.
Idea parked: per-person direct links (email each attendee a link to their stack).


## Phase 19: Backlog clear-out [DONE 2026-07-02]
- [x] #15 Lightbox: one-time "← → to navigate" hint (localStorage) + square controls
      (public + preview). Verified live.
- [x] #16 Credit dedupe: footer = powered-by only; end-of-gallery moment is THE credit.
- [x] #18 Mobile: download menu clamped (verified 375px, no overflow); tab overflow was
      already solved by More ▾.
- [x] #17 "Milestone messages" toggle (Sharing settings, event-level, default on) gates
      the you've-loved-N toasts; favoriteMilestones exposed via gallery API.
- [x] #11 getCachedDownloadUrl: quantized deterministic signing for originalUrl +
      downloadUrl (public + preview APIs) — byte-stable across lambdas, ≥½ validity.
- [x] #12 closed by measurement: 133kB first load (102kB shared), no editor deps.
- [x] #13/#14 verified already shipped (progress toast; "4-digit PIN" label).
- [x] Q4 verified shipped (OG route 200 image/png in prod).
- [x] D2 first-favorite pixel burst (grid + lightbox; 16 pixels observed live, then
      unfavorited to keep the client share clean).
- [x] A4 analytics milestone banner (100/1k/10k views, 100/1k downloads; localStorage).
- [x] D5 analytics empty state (pixel elephant); gallery + events states already good.
- [x] G1 dominant-color placeholders: sharp stats at thumbnail time (migration 032,
      applied), persisted at 4 generation sites, in gallery payloads, painted in
      GalleryCard + GalleryStackCard. Backfill over 7,658 existing images.
- [x] Already-shipped discoveries (roadmap was stale): D1, D3, A1, A2, A3, V2, V3.
      Q2 covered by editor rename; Q1/Q3/G2/V1 deferred as AI-gated. All statuses
      written into tasks/improvement-ideas.md.
- [x] Tests 190/190, build green, live QA on the College Board share.

## Phase 18: Background ZIP builds + backlog sweep [DONE 2026-07-02]
- [x] PROD OOM (worse than the 300s timeout): with the fast producer, Vercel's response
      transport buffered producer-vs-client speed difference in lambda memory with no
      backpressure — runtime log "instance was killed because it ran out of available
      memory" at ~335MB delivered of a 4GB gallery. Streaming multi-GB ZIPs through a
      request lambda is fundamentally unsafe on this platform.
- [x] Fix: background ZIP builds. zip_jobs table (migration 030, applied) + Inngest
      zip-build (streams archiver → R2 multipart via uploadStreamToR2/lib-storage —
      bounded ~100MB memory) + zip-cleanup daily cron (expired objects+rows).
      POST /download/prepare decides direct-vs-job (≤300 images AND ≤750MB streams
      sync — OOM arithmetically impossible under the cap; else job, deduped by
      content-hash scope_key, 24h TTL). GET /download/status polls → presigned R2 URL
      (resumable, no lambda in the download path). Client polls w/ persistent toast.
      Sync route 413s oversized requests (defense; prepare routes clients first).
      Shared core (lib/gallery/download-core.ts: auth + selection; lib/zip/append-
      images.ts: producer loop) — one implementation for sync route, prepare, builder.
      E2E (scripts/verify-zip-job.ts): real build of Highlights → R2 → presigned
      download → unzip -t clean → cleanup. PASS (29s incl. home-bandwidth transfer).
- [x] PIN → download token (audit #3): verify-pin returns HMAC token (4h, share-scoped,
      key derived from service secret); bulk URLs use ?dt=. +6 tests.
- [x] Email send hardening (audit #4): slug-only trust + ownership check + canonical
      URL rebuild server-side; 30 sends/hour/user.
- [x] Section tab counts follow the favorites filter (audit #6); active tab hops when
      hidden; tabs keep full counts when zero favorites exist.
- [x] Stack names trim absorbed event tokens via date-anchored prefix rule
      ("Rushi Sheth CollegeBoardSLC" → "Rushi Sheth"); +6 tests (190 total).
- [x] .single() → maybeSingle on max sort_order (audit #9).
- [x] tsc clean, 190/190 tests, build green.
- [x] Prod E2E: full 1553-photo gallery via prepare → Inngest build (~2 min) → status →
      presigned R2 download → 4.0GB ZIP, unzip -t clean, all 1553 entries. Inngest event
      key confirmed configured in prod (dispatch succeeded).
- [x] Build progress UX (migration 031, applied): builder bumps images_done every 25
      photos, status returns imagesDone/imageTotal, toast reads "Preparing your gallery —
      N of TOTAL photos… you can keep browsing". Copy no longer claims the tab must stay
      open (build is server-side; tab only auto-starts the download). Prod-verified:
      A-C section job showed 0→100→200→300→325→ready in 26s via the status endpoint.
      Email-me-when-ready deliberately deferred: builds measure ~30s/GB in prod; revisit
      if zip_jobs created_at→ready_at ever shows real builds crossing ~5 min.

## Phase 17: Smart Stacks — toggle fix + guest experience [DONE 2026-07-02]
- [x] Settings toggle fix: EventSidebar DesignPanel never passed `smartStacks` into GridTab
      (switch always rendered off; every click saved `true`, impossible to turn off). The
      correctly-wired EventSettingsPanel is DEAD CODE — flagged for removal (lesson 17).
- [x] Download route: `?section=<id>` and `?images=<id,...>&name=<label>` scope params
      (validated against the share's event; scoped ZIPs flat, full ZIP keeps section
      folders; activity log gains scope). Live-verified against the College Board share:
      stack ZIP = exactly 2 requested originals, section ZIP = all 60 Highlights, correct
      filenames (`…-Rushi-Sheth.zip`, `…-Highlights.zip`); bogus section/image ids → 404;
      empty favorites still 404.
- [x] Public gallery: guest "Stacks" toggle in section toolbar (per-visitor,
      `localStorage stacks_<shareId>`, only shown when event enables stacks; verified
      3→1 layers icons + persisted "off"); "Download “<section>”" menu item (verified in
      menu); stack mini-gallery StackModal (verified: header, count, download-all, body
      scroll lock); lightbox filmstrip + nav constrained to stack (verified: "1/2 ·
      Rushi Sheth…", accent outline on active thumb, thumb click switches); Escape
      layering verified (closes lightbox first, modal second, scroll restored).
- [x] PIN-flow fixes (found in passing): bulk PIN actions now carry their full download
      query through verification (favorites/section/stack no longer degrade to
      "download all"), and the verified PIN string is re-sent on every bulk request
      (server re-checks each; boolean-only state 403'd the second download). Lesson 18.
- [x] GalleryStackCard: hover "⬇ N" pill + click opens the mini gallery.
- [x] Preview page parity (modal + toggle + filmstrip; downloads stay stubbed).
- [x] tsc clean, build green, eslint 0 errors on changed files (warnings pre-existing).
      Dashboard toggle UI not exercised live (needs auth session) — same prop pattern as
      the adjacent working `showFilenames`; save path already proven (DB had `true`).
- [x] PROD BUG (Mason repro'd): full-gallery ZIP of the 1553-photo College Board event
      arrived truncated ("Error 94 – Bad message") — Vercel runtime log shows "Task timed
      out after 300 seconds" killing the stream mid-flight. Fix: `maxDuration = 800` +
      prefetch window of 8 R2 fetches ahead of the append cursor (sequential per-file
      latency was the wall-clock killer) + `store: true` (JPEGs don't deflate) +
      `Readable.toWeb(archive)` for real backpressure (old bridge did unawaited
      writer.write — unbounded memory on slow clients) + 64MB high-water gate + clean
      client-abort handling (no admin alert, loop exits). Lesson 19. Backlog: background
      job → ZIP to R2 → email link, for very large galleries on slow client connections.

## Phase 16: Hardening round (audit top-three) [DONE 2026-07-01]
- [x] Lightbox navigates the VISIBLE view: SectionedGallery reports its
      tab+filter+sort list up (onVisibleImagesChange); page flattens stacks
      person-adjacent; arrows/counter use it (fallback to full set if the open
      image leaves view). Public + preview. Live-verified: counter "1 / 55"
      (section, not event), ArrowRight follows filename sort.
- [x] Rate limiting (migration 026, applied): auth_attempts + atomic
      record_auth_attempt() RPC, 5 fails/15min per scope:slug:ip, success
      resets the counter, fail-open on infra errors. Wired: gallery verify
      (password), verify-pin, download bulk-PIN. Live-verified: 5×401 → 429
      (even for the correct PIN while locked), reset-on-success deletes row.
- [x] Password hashing → PBKDF2-SHA256 (310k iters, Web Crypto, no deps);
      legacy salted-SHA-256 hashes still verify (upgrade on next password
      set). PIN compares timing-safe. +5 hash tests.
- [x] Silent-failure alarms (migration 027, applied): system_errors table +
      reportSystemError() — logs always, emails ADMIN_ALERT_EMAIL (set in
      Vercel prod+preview via API) max once/context/hour. Wired: favorites
      POST/DELETE, emails.send, gallery verify/verify-pin. Client: favorite
      write failures now toast + revert the optimistic heart (and localStorage).
- [x] Tests 170/170, tsc clean, build green.
- [x] Favorites digest [BUILT 2026-07-01, decisions confirmed by Mason]:
      2h quiet period, 4-image preview, no per-share toggle (digest only fires
      when favorites exist — 99% of galleries never will), no zero-favorite
      nudge. Inngest cron */30 (favoritesDigest) → findDigestCandidates
      (lib/favorites/digest-send.ts) → selectDigestCandidates (pure,
      lib/favorites/digest.ts, 9 tests) → sendShareDigest: email to the event
      owner (auth.admin lookup), preview strip via durable
      /api/gallery/[slug]/fav-thumb/[imageId] 302s (favorite row = authz),
      "View Favorites" → /events/{id}. shares.digested_at watermark (migration
      028, applied) advances ONLY on successful send; re-sessions digest again
      with just the new picks. Live E2E (scripts/verify-favorites-digest.ts):
      seeded 6 favs 3h old → 1 candidate, 4 previews, sent (real email),
      watermark set, second run empty, cleaned up. NOTE: that test email's
      image links point at localhost (local env URL) — expected; prod env has
      the real NEXT_PUBLIC_APP_URL. Tests 179/179.

## Phase 15: Client-share feedback round [DONE 2026-07-01]
Feedback from a real client share of "College Board 2026 All Sports" + app audit.
- [x] 1. Share email: cover image hero via durable `/api/gallery/[slug]/cover` 302
      redirect (presigns die in hours; emails are opened days later). Hero in
      renderEmailShell + truthful EmailPreview. E2E: 302→200 image/jpeg, 404 no-cover.
- [x] 2. Section heading: dropped `italic`, clamp 24-40px → 20-32px (it WAS the
      italics — Playfair italic reads flowery; upright reads as wayfinding).
- [x] 3. Sort bug: API honored settings.grid.sortBy but SectionedGallery hard-coded
      sortBy="manual". Now GallerySettings.gridSort seeds the dropdown (public +
      preview). Verified live: filename-sorted event shows "Filename".
- [x] 4. Smart stacks: lib/gallery/stacks.ts (parsedName ?? extractPersonName port
      from spsv2, 9 tests), GalleryStackCard (jittered 4-8s crossfade, IO-gated,
      reduced-motion aware, stacked-paper layers, count badge, name on Names toggle,
      heart-all via new batch handleFavoriteMany — looping handleFavorite would
      clobber its stale closure). Gate: settings.grid.smartStacks, toggle in GridTab.
      Verified live on Two Dudes Sample Images (then reverted the toggle).
- [x] 5. Send-me-a-copy: BCC sender (default ON, checkbox in composer).
- [x] 6. Pinned galleries: 024 migration (events.pinned_at, applied), pinned-first
      order, Pin/Unpin in card menu, Pinned strip + badge. TDP Work + TDP Website
      pinned in prod via SQL.
- [x] 7. Audit (3 agents + hands-on verify) — fixed the criticals, rest reported:
      FIXED: favorites 42P10 (ON CONFLICT vs unique(share_id,image_id,client_email)
      mismatch — EVERY guest favorite 500'd in prod, invisible due to optimistic UI;
      migration 025 applied), shares IDOR (POST/GET/PUT/DELETE had no ownership
      check over service client), event_date UTC off-by-one (4 sites), timing-safe
      secret/password-hash comparison.
      REPORTED (tasks/audit-2026-07-01.md): no rate limit on password/PIN verify,
      SHA-256 (no work factor) for share passwords, lightbox navigates full set not
      filtered view, /api/events N+1 (3 queries/event), download PIN in query string,
      silent favorite failures (no toast), + UX/delight list.

### Phase 15 review
Tests 165/165 (+9 stacks), tsc clean, next build green, lint pre-existing warnings
only. Live verify on dev server against prod DB: font/sort/stacks/cover/favorites.
Dashboard pinned strip not E2E'd (auth-gated) — needs a logged-in spot-check.
Gotcha: `npm run build` while dev server runs clobbers .next → dev 500s (restart).



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

## Phase: Sections-are-the-model cleanup + ordered scenes [SHIPPED 2026-06-10]
- [x] srcset thumbnails (400/800 by tile width×DPR) + deterministic presigns
      (quantized signing window — per-instance memo was useless across lambdas)
- [x] Selection clears on section switch (carried selection acted on hidden photos)
- [x] Globe fully retired; one delete button with "copies" semantics: section open →
      photos in other sections lose this copy only (website section = off the site),
      last copy = permanent delete; All Images = always permanent. Server-side
      partition counts membership across ALL events (lib/gallery/delete-partition.ts).
      Closes the remove-from-section orphan path.
- [x] Ten "ordered" scenes (benefits ×7 services, story, about-values, quote) — new
      scene kind: exact drag order, no featured boost, positions hint in editor.
      Sections created in live DB (sort 28-37) + scaffold-on-open restored
      (ensureWebsiteSections on website-gallery GET — globe retirement had orphaned
      the lazy scaffold).
- [x] All deployed + live-verified: 10 scenes 200/count 0, hero intact (12 curated),
      401/404 contract intact. Tests 103/103.
- [ ] Website repo: add the ten keys + position counts to its scenes.ts

## Phase: Video support for the TDP Website pipeline [BUILT 2026-06-10, commit b7d951e]

Mason's requirement: BOTH short muted loops AND multi-minute sound-on showcase
reels. Routing rule: video needing Stream = `duration > 60s OR has_audio`;
otherwise it publishes through the existing R2 public lane.

### Architecture decisions
- New `images` columns: `media_type` ('image'|'video'), `duration_seconds`,
  `has_audio`, `stream_uid`, `processing_error`. Asset kind derived:
  image → "image"; video + stream_uid → "stream"; video → "video".
- Posters written into the EXISTING `thumbnails/{variant}/` key scheme
  (thumb-sm/md/lg JPEGs) by a new Modal ffmpeg function, so the editor grid,
  `thumbnail_generated` gate, and public-lane derivation work unchanged.
- Modal function is credential-free: Next.js presigns GET (original) + PUT
  (posters, display mp4) and POSTs them to `modal/video_pipeline.py`. Driven
  by a new Inngest function (`video/uploaded`) so upload completion never
  blocks; ffprobe validates H.264/AAC there (politely fails the row with
  `processing_error` otherwise).
- MOV remux: short muted .mov gets a lossless `-c copy` remux to
  `events/{eventId}/video/{stem}.mp4` (Firefox won't play QuickTime
  containers). MP4 originals pass through untouched.
- Stream ingestion at PUBLISH time (membership sync), not upload time — only
  website-published videos cost Stream minutes. Unpublish deletes the Stream
  copy + public posters, symmetric with images.

### Checklist
- [x] 023_video_support.sql migration + database.types.ts
- [x] src/lib/upload/media.ts — shared mime/size validation + duration format
- [x] src/lib/r2/client.ts — isVideoKey/getVideoDisplayKey; getDisplayKey video-aware
- [x] src/lib/stream/client.ts — Cloudflare Stream copy/delete/URL builders
- [x] src/lib/site/publish.ts — assetLane + publishAssetToLane/unpublishAssetFromLane
- [x] src/lib/site/serialize.ts — shared site API payload (kind/videoUrl/posterUrl/duration)
- [x] src/lib/site/membership.ts — media-aware sync; stores/clears stream_uid
- [x] src/lib/video/process.ts + modal/video_pipeline.py — probe/poster/remux
- [x] Inngest: "video/uploaded" + processUploadedVideo + registration;
      processUploadedImage forwards videos (SPS import path)
- [x] Upload routes: presign validation + media_type; proxy skips sharp for
      video; complete dispatches video/uploaded; regenerate requeues poster
- [x] Site APIs (scene, jobs): kind/videoUrl/posterUrl/duration — image shape unchanged
- [x] Grid API + image detail API: mediaType/durationSeconds (+hasAudio/streamUid)
- [x] UploadZone: accept mp4/mov, 500MB video cap, skip EXIF for video,
      size-scaled XHR timeout, video placeholder tile, polite rejections
- [x] ImageGrid duration badge; Lightbox <video> playback
- [x] Tests: publish lanes, membership video sync, stream client, media validation
- [x] docs/SITE-INTEGRATION.md video section + env vars
- [x] npm run lint && npm test && npm run build

### New env vars
- `VIDEO_PIPELINE_URL` — Modal endpoint (modal deploy modal/video_pipeline.py)
- `VIDEO_PIPELINE_KEY` — shared secret (Modal secret `video-pipeline`)
- `CLOUDFLARE_STREAM_API_TOKEN` — Stream:Edit token (Mason to provision, ~$5/mo tier)
- `CLOUDFLARE_STREAM_CUSTOMER_CODE` — customer-XXXX code for playback URLs
- `CLOUDFLARE_ACCOUNT_ID` — optional; falls back to R2_ACCOUNT_ID (same account)
