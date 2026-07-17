# Pixeltrunk — Lessons Learned

## 1. Always check DB constraints before using custom status values
**Mistake**: Set `processing_status: "uploaded"` in the upload/complete route, but the DB only allows `('pending', 'processing', 'complete', 'failed')`. Every EXIF update silently failed.
**Rule**: Before using a string value in a DB column, verify the CHECK constraint allows it. Use existing allowed values (`complete`) rather than inventing new ones.

## 2. Service client bypasses RLS — always add explicit filters
**Mistake**: The events API used the service client (bypasses RLS) without filtering by `user_id`, so it returned ALL events from ALL users.
**Rule**: When using `createServiceClient()`, always add `.eq("user_id", user.id)` to every query. RLS is your safety net — don't operate without it.

## 3. Fire-and-forget operations need error monitoring
**Mistake**: EXIF extraction was fire-and-forget (`.then()` instead of `await`), so when it failed due to the check constraint, there was no visible error — uploads appeared to work but data was silently lost.
**Rule**: Fire-and-forget operations MUST log errors. Add `console.error` in catch blocks. Consider a health check endpoint that surfaces silent failures.

## 4. Image serving: thumbnail + original URL pattern
**Pattern**: API endpoints return both `thumbnailUrl` (400px thumb-md) and `originalUrl` (full-res). Grid uses `thumbnailUrl` with `onError` fallback to `originalUrl`. Lightbox uses `originalUrl`.
**Why**: Serving full-res originals for grid thumbnails wastes massive bandwidth. The fallback pattern allows graceful degradation for images uploaded before thumbnail generation was deployed.

## 5. Masonry layout with left-to-right reading order requires JS
**Learning**: CSS `columns` renders top-to-bottom per column. CSS `grid` gives left-to-right but uniform heights. For masonry + left-to-right, you need JS round-robin column distribution.
**Pattern**: `gridItems.forEach((item, i) => columns[i % colCount].push(item))` then render each column as a vertical flex container.

## 6. Next.js force-dynamic for auth-aware server components
**Issue**: Homepage was cached between authenticated and unauthenticated states.
**Rule**: Any server component that checks `auth.getUser()` MUST export `const dynamic = "force-dynamic"`.

## 7. Disambiguate Supabase FK relationships with `!column_name`
**Mistake**: Query `select("*, images(count)")` failed with "Could not embed because more than one relationship was found for 'events' and 'images'" — because `events.cover_image_id → images.id` AND `images.event_id → events.id` both exist.
**Rule**: When two tables have multiple FK relationships, always use the explicit hint syntax: `images!event_id(count)`. This tells PostgREST which FK to traverse.

## 8. Modal deprecations (2025+)
**Deprecations fixed**:
- `container_idle_timeout` → `scaledown_window`
- `allow_concurrent_inputs` → `@modal.concurrent(max_inputs=N)` decorator (on the CLASS, not the method — method-level raises `InvalidError`)
- `@modal.web_endpoint()` → `@modal.fastapi_endpoint()` (requires `"fastapi[standard]"` in `pip_install`)
**Rule**: Modal web endpoints now require explicit FastAPI installation. Always decorate the class with `@modal.concurrent`, never the method.

## 9. Middleware must exempt API routes from subdomain rewrites
**Mistake**: Marketing domain rewrite (`pixeltrunk.com → /m/...`) was rewriting ALL paths including `/api/inngest` and `/api/stripe/webhook`, causing 404s for webhooks.
**Rule**: When using middleware for subdomain routing, always add an early return for `/api/` paths before the rewrite logic. Webhooks and API routes must pass through unchanged.

## 10. Vercel Deployment Protection blocks Inngest/webhook syncs
**Mistake**: Vercel SSO protection (`ssoProtection: "all_except_custom_domains"`) blocked deployment-specific URLs with 401. Inngest's Vercel integration hits the deployment URL (not the custom domain), so syncs failed.
**Rule**: Disable Vercel Deployment Protection (`ssoProtection: null`) when using Inngest or similar services that need to reach deployment URLs. Inngest has its own signing key security. The env var `INNGEST_SERVE_HOST` does NOT fix this — the integration still uses the deployment URL directly.
**Fix**: `PATCH /v9/projects/{id}` with `{"ssoProtection": null}`.

## 2026-05-31 — Recurring mistakes (Opus working session)

These cost real time and broke production twice. Do not repeat.

1. **Verify every Edit landed.** In this large, iCloud-synced repo, `Edit`
   `old_string` matches FAIL SILENTLY on whitespace/escape mismatches. After any
   Edit, grep/read to confirm it applied. For multi-spot deletions in a big file,
   use a Node script (read → regex replace → write) instead of many fragile Edits.

2. **`next build` before every commit — not just `tsc`.** main auto-deploys to
   Vercel; a build failure errors the deploy. tsc passes things the Next build
   fails (lint, unused vars). A green tsc is NOT enough. Also: a passing build
   does NOT prove the logic is what you intended — read the diff.

3. **Don't trust a green build for behavior.** Twice an Edit silently didn't
   apply, the build still passed (valid JSX, wrong behavior), and I nearly
   shipped a no-op. Read the actual changed region after building.

4. **Use the right event_id.** Queried the wrong Supabase event_id and got
   "0 images," nearly misdiagnosed. Confirm IDs from a fresh query, not memory.

5. **Architecture notes for this app (root causes of the upload/gallery saga):**
   - Masonry was hand-rolled JS column-packing using DB width/height. Those are
     null for most images → square estimates → wildly uneven columns. Fixed by
     switching to CSS multicol (browser balances by real height; no dim needed).
   - The event grid fetches ALL event images then filters by section client-side
     in an imperative effect → races to "No images yet". Fix: derive displayed
     images (useMemo) from allImages + section IDs; never imperatively set empty.

## 2026-06-11 — Don't run `next build` while the dev server is running
**Mistake**: Ran verification builds (`npm run build`) while the preview dev
server was serving from the same `.next` directory — the build clobbered the
dev server's incremental chunks ("Cannot find module './vendor-chunks/next.js'")
and the user hit a broken page.
**Rule**: Before `npm run build`, stop the dev server (preview_stop), or skip
the local build when a dev server is up (CI/the pre-push build covers it).
Recovery: stop server, remove `.next`, restart.

## 13. Verify upsert ON CONFLICT targets against the LIVE schema
**Mistake**: Guest favorites upserted with `onConflict: "share_id,image_id"` but the table's unique key was `(share_id, image_id, client_email)` — Postgres 42P10, so EVERY guest favorite since launch returned 500. Nobody noticed for months because the optimistic UI + localStorage made favorites look saved.
**Rule**: An upsert's `onConflict` columns must exactly match an existing unique constraint/index — check `pg_constraint` on the live DB, not just the migration file. And any write that's masked by optimistic UI needs at least one E2E check that the ROW actually exists afterward.

## 14. Lesson 2 (service client + explicit filters) applies to EVERY route — audit new ones
**Mistake**: The shares routes (POST/GET/PUT/DELETE) shipped without ownership filters over the service client — any logged-in user could create or revoke shares on any event (IDOR). Same class of bug as lesson 2, different route.
**Rule**: `getAuthUser()` hands back the SERVICE client. Every query in every route it feeds must carry `.eq("user_id", ...)` or an `events!inner(user_id)` join filter. When touching an API file, scan its siblings for the same omission.

## 15. DATE columns need timeZone:"UTC" at display time
**Mistake**: `new Date("2026-06-23").toLocaleDateString("en-US", ...)` shows June 22 for US viewers (DATE parses as UTC midnight, formats in local TZ).
**Rule**: For date-only columns (event_date), always pass `timeZone: "UTC"` to toLocaleDateString. Timestamps (created_at) format local, dates format UTC.

## 16. Don't run `next build` while the dev server is up
**Mistake**: `npm run build` during a live `next dev` clobbered `.next` — the dev server started 500ing (ENOENT route.js) mid-verification, which briefly looked like a data bug.
**Rule**: Stop the dev server before production builds, or build first and start dev after. If dev suddenly 500s with ENOENT under .next, restart it before debugging anything else.

## 17. New settings fields must be wired into the LIVE settings panel (there are two)
**Mistake**: The Smart Stacks toggle was added to `GridTab` and wired in `EventSettingsPanel` — but that component is dead code. The live panel is `EventSidebar`'s `DesignPanel`, which never passed `smartStacks` down, so the switch always rendered off and every click saved `true` (impossible to turn off, looked "broken" while the DB value was fine).
**Rule**: After adding a prop to a shared tab component, grep for EVERY render site (`grep -rn "<GridTab"`) and wire them all — or better, delete the dead duplicate. A toggle that "won't turn off" usually means display state and saved state have different sources.
**Resolved 2026-07-02**: `EventSettingsPanel.tsx` deleted (zero imports confirmed; tsc + build clean). `EventSidebar`'s DesignPanel is now the only render site for the settings tabs.

## 18. Client PIN state must mirror what the server re-checks
**Mistake**: The gallery kept a boolean `pinVerified` after bulk-PIN entry, then issued later bulk downloads WITHOUT the `pin` param — but the server re-validates the PIN on every `/download` request, so the second download 403'd. A related bug dropped the `favorites=true` param when re-issuing the URL after PIN verify.
**Rule**: When a server endpoint re-checks a credential per request, the client must store the credential (the PIN string), not a boolean, and re-send it every time. When an action is deferred behind a verification modal, carry the action's FULL query through the modal, not a hardcoded reconstruction.

## 19. Streaming routes on Vercel need maxDuration + parallel fetches — or they ship corrupt files
**Mistake**: The gallery ZIP route fetched 1500+ R2 originals *sequentially* (~0.4s latency each) with no `maxDuration`. Vercel killed the function at the 300s default MID-STREAM — the client received a 1.6GB ZIP with no central directory ("Error 94 – Bad message" in Archive Utility). Worse, a kill can't run any error handling, so nothing was reported; the only trace was the runtime log's "Task timed out after 300 seconds".
**Rule**: Any route that streams for minutes needs (1) `export const maxDuration = 800`, (2) parallel prefetch — per-file latency × file count is the real wall-clock, not bandwidth, and (3) real backpressure (`Readable.toWeb(nodeStream)`, never `stream.on("data", chunk => writer.write(chunk))` with unawaited writes). ZIPs of JPEGs should use `store: true` — deflate burns CPU for ~0%. Residual risk: a slow client pulling a multi-GB ZIP can still exceed 800s → the durable fix is a background job that parks the ZIP in R2 and emails a link (backlog).

## 20. iCloud-synced project dirs drop conflict copies into .next
**Mistake**: `npx tsc --noEmit` kept failing with duplicate-identifier errors from files like `.next/types/cache-life.d 2.ts`. The repo lives in iCloud-synced ~/Documents; sync races with build churn and drops macOS "file 2" conflict copies inside .next, which tsconfig's `.next/types/**/*.ts` include picks up.
**Rule**: tsconfig now excludes `**/* 2.ts`..`* 5.ts` (TS globs have no character classes). If weird "already declared" errors appear from a ` N.ts` file, it's iCloud, not the code. Longer-term: consider moving active repos out of iCloud-synced paths.

## 21. The client must never claim an upload succeeded without server confirmation
**Mistake** (the eBay HEADSHOTS incident, 2026-07-06): `UploadZone` retried `/api/upload/complete` 3× and then fell through to marking the file "complete" ANYWAY. Under burst load (1,477 files at ~300/min), 458 uploads the UI counted as done were never finalized — and 413 of those never even landed in R2. The client showed success; the gallery showed broken tiles; nothing was logged anywhere queryable.
**Rule**: A client-side "done" is a claim about SERVER state, so it must come from the server: mark complete only on a confirmed 2xx, keep failures visible and retryable, and reconcile the whole batch against the server when the queue drains (`/api/upload/reconcile`). The nightly Inngest `upload-reconciler` is the backstop for anything both layers miss.

## 22. Rows created before their binary need an abandonment story on EVERY exit path
**Mistake**: `/api/upload` pre-creates `images` rows at presign time (50 at a time), but Cancel just emptied the task queue, navigation killed the workers, and the abort path returned early — every one of those left permanent ghost rows (DB row, no R2 object) that render as broken tiles forever. That's where most of the 413 ghosts came from ("I was stepping ahead and uploading future folders").
**Rule**: If a DB row is created ahead of its backing resource, enumerate every way the session can end (cancel, unload, abort, worker crash) and clean up on each: Cancel deletes queued rows, `pagehide` fires a keepalive batch-delete, the abort path in `uploadOne` deletes its own row, and the reconciler cron deletes >24h-old rows whose original provably isn't in R2 (HEAD-verified, and only after re-checking the row hasn't progressed).

## 23. Self-heal endpoints need brakes, or they amplify the outage that triggered them
**Mistake**: A grid tile whose thumbnail 404'd fired `POST /regenerate-thumbnail` (original download + 3× sharp). During the upload burst, tiles for not-yet-uploaded rows 404'd en masse and the "self-heal" added a second wave of sharp jobs to already-saturated functions — 811 pointless 500s in 10 minutes, all `NoSuchKey` on rows whose original didn't exist yet (or ever).
**Rule**: Self-heal must be (1) impossible for states that can't heal — pending rows never trigger regen, they render a placeholder until the row completes; (2) rate-limited — page-wide cap on concurrent regens; (3) terminal on proof of impossibility — the server answers 410 for missing originals so the client stops. General form: any automatic retry-on-error path needs an argument for why it can't feedback-loop under load.

## 24. The service-client IDOR is systemic — audit ALL routes at once, not one at a time
**Mistake**: Lessons #2 and #14 fixed this class (getAuthUser's service client bypasses RLS → every query needs an ownership filter) one route at a time. A full-branch audit (2026-07-09) then found SEVEN MORE live holes, including a CRITICAL one: GET /api/search returned presigned ORIGINAL image URLs for every tenant to any logged-in user (`?q=.jpg&limit=100000` = whole-archive exfil, no id-guessing). Others: events/[eventId] GET, images/[imageId] GET (leaked EXIF/GPS + original), upload/[imageId] PUT (overwrite any tenant's binary), upload POST (inject into any event), events/[eventId]/favorites GET (client emails), gallery/[slug]/favorites GET/POST/DELETE (guest PII + cross-share tamper), images/batch PATCH (publish attacker images onto a victim's marketing site via a site_scene_key section), stacks/[stackId]/cover PUT.
**Rule**: When you find one instance of a systemic auth bug, audit the WHOLE surface immediately — grep every route for `getAuthUser`/`createServiceClient` and confirm each data query carries `.eq("user_id", …)` or an `events!event_id!inner(user_id)` + `.eq("events.user_id", …)` join. The tell for a hole: a handler that destructures `{ supabase, error }` WITHOUT `user`, then queries by a resource id/slug alone. Public guest routes (gallery/[slug]/*) authorize by binding the id to the path slug + is_active, never by a bare shareId (which is handed to everyone with the link). Verify a fix means: cross-tenant read/write → 404/403, own resource → 200, live.
**Also**: the .single()/.maybeSingle() after an !inner-join ownership filter returns no row (→ your 404 branch) for a non-owned id — it does NOT throw or leak. That's why the pattern is safe.

## 25. Deleting an image/event must delete its FULL R2 footprint, not just the original
**Mistake**: Image delete removed only the original (leaving 3 thumbnails per image), and event delete cascaded the DB but did NO R2 cleanup at all — so every deleted event stranded every file. Result: 47,724 orphaned R2 objects (~19 GB) with no DB row, half the bucket. Also: a naive orphan-sweep first matched the FIRST UUID in each key (the event id in the path) instead of the filename stem (image id), which flagged EVERY object — including all live galleries — for deletion. The dry-run caught it.
**Rule**: When a resource owns derived files, deleting it must delete ALL of them — added `deleteImageAssets(r2Key, mediaType)` (original + thumb-sm/md/lg + video rendition), used by both delete paths; event delete collects image keys BEFORE the cascade wipes the rows. For any bulk R2/storage sweep: (1) match by the naming-agnostic identity `{eventId}|{filename-stem}` (works for uuid AND legacy human-readable names, originals AND thumbnails), never "first UUID in the key"; (2) ALWAYS dry-run to a manifest first; (3) independently assert zero live keys appear in the delete set before running; (4) back up the manifest. Deletes are irreversible.

## 26. HEIC is rejected at upload — sharp can't decode HEVC-HEIC anywhere we run
**Decision (2026-07-09)**: HEIC/HEIF removed from UPLOAD_ACCEPT / IMAGE_ACCEPT. sharp has no HEVC decoder on Vercel OR local macOS prebuilds, so a HEIC upload could never get a thumbnail AND browsers can't render the original — the photo was invisible everywhere (one sat stuck for weeks). iPhone consumers hit this; pros shoot JPEG/RAW. validateUploadFile returns a specific convert-to-JPEG message (matched on extension too — browsers often report an empty MIME for .heic). Chose rejection over a ~1.5MB client-side WASM transcoder for an edge case (base-product-simple roadmap). Revisit transcoding only if photographers actually hit it often.

## 27. Filename-derived features (name sections/stacks) beat AI when the data has names in it
**Insight (auto-sections, 2026-07-10):** the "Smart Stacks" toggle and "group by person" were assumed to need the (disabled) Modal face-clustering AI. But headshot filenames ARE "FirstName LastName_YY-MM-DD_TAG####.jpg", so first-name letter bucketing AND per-person stacking come straight from the filename — deterministic, instant, no GPU, and the guest gallery already had the name-cleaning (`stackPersonName`/`nameBeforeDate` in lib/gallery/stacks.ts, which strips the trailing frame code after the date anchor). Refactored to `personNameFromParts(parsedName, originalFilename)` so server code reuses the exact gallery logic — sections and stacks must agree on who a photo belongs to. Real data check first (SQL over 6 events) proved names are clean for headshot events and junk for camera-code events (TDP website) → the feature is opt-in + auto-detects person-named vs not.
**Rules that paid off:** (1) a PURE planner (`planAutoSections`) shared by the client preview (live slider) and the server apply → byte-identical results, no drift. (2) DRY-RUN the destructive apply mentally + guard: wipe only `is_auto` sections (never Highlights/manual), cap at 60 sections. (3) When a shared validator changes (HEIC reject), RUN THE TESTS not just the build — a stale media.test.ts `.heic` case only surfaced when the full `vitest run` ran two commits later. Build-green ≠ tests-green.

## 28. Never mount an <img> per dropped file — object-URL thumbnails decode the ORIGINAL
**Mistake** (Appfolio // Jul 2026, 2026-07-15): a 2000-file drop crashed the tab before a single byte reached the server (0 rows, 0 system_errors — pure client death). `UploadZone` rendered one row per file, each with an `<img src={objectURL}>`: the browser decodes the ORIGINAL full-res image for every mounted `<img>` (a 24 MP JPEG ≈ 100 MB of bitmap), even inside a 340px scroll container. Same crash via drag-drop and file picker — both funnel into the same render. The eBay fixes hardened server bookkeeping but nobody load-tested the RENDER path.
**Rule**: any list that grows with user input gets a render window (`MAX_RENDERED_ROWS = 30`, errors first, footer counts the rest) — the DOM must stay O(1) as the batch grows to O(n). Corollaries fixed in the same pass: EXIF reads `file.slice(0, 4MB)` not the whole file (12 workers × 100 MB held in memory); progress events only touch React state when the integer pct actually changes. When a client-side crash report says "both input paths crash", suspect what they SHARE — the render — not the input mechanism.

## 29. Name-comparison guards must compare NORMALIZED forms; frequency heuristics need a shape guard
**Mistake** (Appfolio stacks, 2026-07-15): stackPersonName's event-tag guard compared `nameBeforeDate` (which camel-splits: "AaronCote" → "Aaron Cote") against parsedName ("AaronCote Appfolio") with a raw `startsWith` — the injected space meant the prefix never matched, so the guard silently never fired for CamelCase names and every Appfolio stack was labeled "AaronCote Appfolio". A guard that exists but can't fire is worse than none: it reads as handled.
**Rule**: whenever two DERIVED forms of the same string are compared (parsed vs extracted, split vs fused), normalize both first (lowercase, strip punctuation/spaces) — never raw string-compare across transformations. Test the guard with an input each transformation disagrees on.
**Second catch, same session**: the corpus frequency rule ("token in 60%+ of names = event tag") classified a shared surname ("Doe" ×28 in the planner's test corpus) as a tag. Frequency alone can't distinguish tag from surname — the fix is a SHAPE guard (stripping must leave a person-looking remainder in 80%+ of carriers). General form: any statistical heuristic over user data needs a semantic sanity check on what it's about to do, and the FULL test suite (not just the new tests) is what catches the interaction — lesson 27's "run vitest, not just build" paid off within a week.

## 30. The service-client IDOR class includes JSONB-stored keys, not just query params
**Near-miss** (Covers v2 review, 2026-07-16): mosaic/solid cover settings store an R2 `logoKey` in owner-writable `events.settings` JSONB. The gallery payload presigned it and the raster job downloaded it with NO prefix check — any signed-in user could PATCH their own event's settings with a foreign key (`events/<victim>/...`) and get a 4-hour presigned URL to any bucket object via their own gallery. Caught by the zero-context diff review, not by the author, and not by the earlier IDOR audit (which only covered ids arriving via params/body).
**Rule**: any storage key that lives in user-writable data (settings JSONB, DB rows the owner can update) must be prefix-pinned at EVERY sink that dereferences it (presign, read, delete) — and the sanitization must be identical wherever the value feeds a content hash, or the mismatch loops regeneration. `pinnedCoverLogoKey`/`sanitizeCoverForEvent` in event-settings.ts is the pattern. When auditing IDOR, enumerate the SINKS (what dereferences untrusted identifiers), not the entry points.

## 31. Satori (@vercel/og) silently ignores objectPosition — hand-compute OG crops
**Mistake** (Covers v2, 2026-07-16): the OG route "applied" the focal point via `objectPosition` on an `objectFit: cover` img. Satori doesn't implement objectPosition (its cover is a hardcoded centered slice) — the style is accepted and silently dropped, so the feature's headline fix no-oped exactly where faces get cropped most (social cards). Nothing errors; you only catch it by rendering and looking.
**Rule**: for focal-aware crops in ImageResponse, render the image OVERSIZED inside an overflow-hidden container and offset it with absolute px (`scale = max(vw/w, vh/h)`, clamp the focal offset) — needs the original pixel dims, which the images table has. Generally: satori supports a narrow CSS subset and drops the rest silently; after adding any nontrivial style to an OG route, fetch the actual PNG and look at it.

## 32. Two renderers sharing a seeded arrangement must share the exact POOL, not just the math
**Near-miss** (Covers v2 review, 2026-07-16): the live CSS mosaic tiles from the gallery payload (gated `thumbnail_generated`, videos included) while the raster job's pool gated `processing_status='complete'` (reintroducing the exact bug lesson-documented in the gallery route's own comment) and skipped videos. The layout math was shared and tested — but a single pool difference reorders the ENTIRE seeded shuffle, so email/OG would show a different wall than the live cover. Filters are part of the contract.
**Rule**: when a deterministic arrangement (seed/hash) is computed in two places, the INPUT SET construction is part of the shared contract — same gate, same exclusions, same order — and belongs in one function or in tests that diff the two pools. A comment in one route warning about a gate is a smell that the gate should be a shared helper.

## 33. A slider must visibly move pixels at both ends — quantized geometry can eat the whole range
**Mistake** (Covers v2 insert mode, 2026-07-16, caught by Mason in first use): the "space around logo" slider fed a hole width that was then snapped to whole grid columns AND parity-adjusted to stay centered — two roundings that swallowed the entire 0–45 range, so the slider did literally nothing. It shipped with a monotonicity unit test (`loose ≥ tight`) that PASSED, because ≥ admits equality — the test encoded the bug as acceptable.
**Rule**: any user-facing continuous control gets a test asserting STRICT inequality between distinct positions (min < mid < max on the actual rendered geometry), and a hand-check on the real surface at both extremes. Corollary: when a design requires snapping/quantization, don't let a continuous control feed through it — either the control moves something continuous (the justified-mosaic hole is free-width in px) or the control itself becomes stepped.
