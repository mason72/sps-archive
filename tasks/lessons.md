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

## 34. Dead UI is worse than missing UI — it makes the gap invisible to everyone, including us
**Discovery** (gallery password, 2026-08-05, raised by Mason as "I don't think we currently have a way to add a password"): the password *plumbing* was complete and correct — `shares.password_hash` (PBKDF2), `/api/gallery/[slug]/verify`, the 7-day cookie, a working `PasswordGate` — and `SharingTab.tsx` had a password field. It was imported nowhere. Feature shipped, unreachable, for months. Grep for the *field* found it and made the feature look present; grep for the *component's mount* was the question that mattered.
**Rule**: a component with no import site is not a feature, it's a decoy. When asked "do we have X?", check that the UI is MOUNTED (`grep -rn ComponentName src | grep -v ComponentName.tsx:`), not merely that the code exists — and delete orphaned UI rather than leaving it beside its replacement, or the next session re-derives the same confusion. Corollary: the same audit found the email composer auto-creating a share WITHOUT `useEventDefaults`, so a password set on the event would have been silently dropped by the very flow that emails the link.

## 35. A security posture is not a "default" — it must apply unless explicitly overridden
**Near-miss** (same build): `POST /api/shares` resolved the event password only under `useEventDefaults: true`, treating it as one preference among many (alongside expiry, custom message). But the email composer creates its share without that flag — so the flow that announces "your gallery is protected" would have minted an unprotected link. Fixed to `password || eventPassword`: an explicit body password overrides, absence inherits.
**Rule**: distinguish *preferences* (inherit only when asked) from *postures* (apply unless explicitly overridden) — passwords, expiry, visibility, PII redaction. When a setting's failure mode is "silently less protected than the owner believes", it's a posture. Verify it by creating the object through EVERY path that creates it, not just the one with the flag.

## 36. Password gates must not hand the browser the thing they're guarding
**Design call** (same build): the ask was "blur the images behind the password prompt". Shipping the real thumbnail URLs with a CSS `filter: blur()` would have been theatre — one devtools toggle removes the filter, and the `src` is a presigned URL anyway. What the gate CAN safely show: the cover image (already public by design — the email hero route deliberately skips the gate) blurred as atmosphere, and `images.dominant_color`, which is a single averaged hex per photo, not image data.
**Rule**: on any gated surface, ask what an unauthenticated visitor RECEIVES, not what they SEE — client-side obscuring of delivered data is never a control. Two tuning notes that made it look like a gallery instead of a blank page: blur past ~40px stops reading as a photograph and becomes a flat wash (32px is the sweet spot at 1.15 scale), and dominant colors skew neutral, so a color-field backdrop must prefer the chromatic end of the palette (`chroma > 0.12`) and fall back to brand hues — a gallery of headshots on white seamless otherwise renders as nothing at all.

## 37. An alert that reports its batch instead of its backlog will describe a disaster as a hiccup
**Incident** (HDC // 2026, found 2026-08-08 from Mason's "~90 images stuck" emails): the nightly reconciler emailed `finalized 93, watching 307` while **2,270 rows were stuck** — it examined `RECONCILE_BATCH = 400` and reported only what it looked at, so a 6×-larger incident produced a normal-looking email. Three nights of alerts read as routine noise. Worse, the ghost-delete email capped its filename list at 30 per event, so the *only* record of what to re-upload was being destroyed faster than it was reported, 400 rows a night. A pure-"watching" night (backlog present, nothing yet actionable) sent no email at all — the quietest possible response to an upload session that just dropped thousands of files.
**Rule**: any capped/batched job must report **two** numbers — how much exists and how much it processed — and say explicitly when the cap bound it. Never let the batch size set the story; a `count: "exact", head: true` query is one round-trip. Alert on backlog *existing*, not only on work *performed*. And when a job's output is the only recovery instrument (the list of what to re-send), it must not be truncated before it's durable.
**Root cause it was hiding** (upload client, not yet fixed): `uploadEntries` awaits only the *presign* call, then calls a non-blocking `drainQueue()` — so presign runs unbounded ahead of upload. All 3,839 rows for one session were minted in 3 minutes for a job that drains at ~40/min over ~90 minutes, leaving thousands of presigned rows sitting in an in-memory queue for the entire session. When the tab died at 09:38 UTC the whole queue died with it: 404 unique photos never uploaded, 12 people left with nothing in the gallery. Failed PUTs are NOT the cause — `uploadOne` deletes the row on failure, so a pending row means *never attempted*.
**Rule**: a producer that hands work to a bounded consumer must be bounded by the consumer's progress, not by its own loop. Presign (or any reservation with a side effect) should run at most ~2× concurrency ahead of the drain. And an interrupted long-running client job must persist its work list — a queue that lives only in browser memory guarantees silent, unrecoverable loss on the one event you can't control.
**Counting trap**: the first pass measured 2,241 lost *rows* and read it as 2,241 lost photos. The shoot had been uploaded twice, so 3,844 distinct files backed 7,740 rows — the true loss was 404 files. Count incidents at the level the user cares about (the photo), not the level the schema stores (the row), and de-duplicate before quoting a number to anyone.

## 38. A "duplicate" must be proven by evidence of success, not by the existence of a row
**Near-miss** (HDC recovery, 2026-08-08, caught while planning the re-upload, not by the code): `check-duplicates` matched any `images` row in the section sharing a filename, with no `processing_status` filter. The section held 2,258 presign-created rows whose binaries never landed — so re-uploading the 404 genuinely-missing photos would have flagged each one as a duplicate **of its own ghost row**, and the natural "Skip all duplicates" click would have skipped precisely the files being re-uploaded to recover them. The recovery would have reported success and archived nothing.
**Rule**: when a check asks "do we already have this?", the answer must come from evidence the thing SUCCEEDED (`processing_status='complete'`, a verified binary), never from the presence of a record — records are created optimistically at the start of a workflow, so "a row exists" and "the work finished" are different claims. Any table that pre-creates rows before the real artifact exists (presign, reservation, job queue) will produce this class of bug in every consumer that forgets the status filter — grep the siblings when you fix one.
**Second-order**: this only surfaced because the recovery plan was walked through end to end ("what happens when they re-drop the folder?") before telling anyone to do it. Dry-run the remediation against the current data, not the healthy data — the whole point is that the data is not healthy.

## 39. PostgREST silently caps every response at 1,000 rows — `.limit(n > 1000)` is a lie
**Mistake** (dashboard unfinished-uploads summary, 2026-08-08): the per-gallery breakdown fetched rows with `.limit(10_000)` and got exactly 1,000 back, with no error and no truncation signal. It rendered "1000+" against a real 2,258 — reintroducing the exact under-reporting bug this whole incident was about (lesson 37), one layer up, in the code written to fix it. Caught only because the verification script printed `rowsFetched` next to the independent count instead of trusting the query.
**Rule**: any Supabase/PostgREST read that can exceed 1,000 rows must page with `.range()` until short, or be a `{ count: "exact", head: true }` count — never a bare `.limit()`. When paging, `.order()` on a non-unique column is unstable across pages; add a unique tiebreaker (`.order("id")`) or rows duplicate and vanish between pages. And always compute the headline number from an exact count that is INDEPENDENT of the row fetch, so a capped fetch degrades the detail and never the scale.
**Meta**: the fix for an under-reporting bug is the highest-risk place to write another one. When the whole point of a change is "report the true number", verify the number against an independent source before shipping — the same discipline as lesson 37, applied to your own patch.
**IT RECURRED THE NEXT DAY, in the code this lesson was written for.** The 2026-08-09 reconciler run reported `examined: 1000` against `totalStuckPending: 2258`. `RECONCILE_BATCH` had been raised 400 → 3000 the day before, but the query was still a bare `.limit(RECONCILE_BATCH)` — so the raise bought 600 rows, not 2,600, and the "one night to drain" claim was wrong by 3×. I wrote this lesson about the dashboard route and never checked its sibling, even though the batch raise and the lesson shipped hours apart.
**Hardened rule**: raising a row limit is not a config change, it's a query change — the moment a limit crosses 1,000 the query must be paged. When you write a lesson about a footgun, `grep` the codebase for every other instance of it *in the same commit* (lesson 38 says this too; that is now twice). Concretely: `grep -rn "\.limit(" src | awk` anything whose bound is a constant ≥ 1000 or a variable.

## 40. A React `key` on a stateful component is a destroy button — never key it on something the user changes casually
**Incident** ("Jessica & Koji's Big Day", 2026-08-08, reported by Mason): the event page mounted `<UploadZone key={uploadTargetId}>`. `uploadTargetId` is the active section, so *clicking a section in the sidebar* — or creating one — changed the key, and React destroyed the component along with the entire in-memory upload queue. 110 files stopped mid-session. Nothing warned, because `beforeunload`/`pagehide` are PAGE events and a React unmount is not one; the same gap meant the queued rows were never cleaned up and became ghosts.
**Rule**: `key` on a component that owns in-flight work (uploads, timers, sockets, unsaved edits) is a remount-on-change contract. Before keying, ask what the key is derived from and how casually a user changes it — a selection is the worst possible choice. If a component holds work that must outlive the view, the work does not belong in the component: lift it above the router, where remounting is free. Corollary: `beforeunload` protects you from the browser, not from your own router — client-side navigation and React unmounts are silent, so anything relying on unload handlers for cleanup has an uncovered path.
**Related trap it exposed**: backpressure (lesson 37) spread presigning across the whole session, so `sectionIdRef.current` — read once per chunk — would scatter the tail of one folder into whatever section was selected an hour later. It was masked only because the remount killed the upload first. Whenever work becomes long-running, re-audit every `ref.current` read inside its loop: a live read that was harmless over 3 seconds is a bug over 90 minutes.

## 41. A "does this feature apply?" heuristic must be validated against the data that LOOKS like a yes
**Near-miss** (Smart Stacks auto-detection, 2026-08-09): the obvious test for "should we group photos by person?" is *what share of images land in a multi-image group*. Every headshot job scores ~100%. So does a WEDDING — "Jessica & Koji's Big Day" has 1,020 images across 2 filename prefixes, so 100% of its images sit in a "group", and stacking would have collapsed the whole gallery into two tiles. The stated failure mode (photo booth dumps, camera-coded names) scores near zero and is caught by any metric; the dangerous case is the one that scores *better* than the true positives.
**Rule**: when writing a detector, don't only test it on the cases you were told about. Enumerate the real corpus and look specifically for rows that score HIGH but should be negative — that is where a one-clause heuristic dies. Here it took a third clause (enough distinct people, plausible shots each) that exists solely to reject the shape nobody mentioned. Run the real function over the real data before shipping and read every row, not just the ones you expected to flip.
**Corollary**: derive the detector from the SAME function that performs the action (`detectStackable` groups with `buildStacks` and asks the exported `isPersonLike` that auto-sections uses). A detector with its own private notion of "person" can green-light a set the renderer then groups differently.

## 42. A raw control character in source makes the file invisible to grep
**Time sink** (2026-08-09): `auto-plan.ts` contained a literal NUL byte inside a template literal — a sort-key separator written as the character itself rather than as an escape sequence. TypeScript compiled it happily and the code worked, but `file` reported the source as `data`, and **plain `grep` silently found nothing in it** — no error, no "binary file matches", just empty results. I searched that file repeatedly for a function I could plainly see via Read, and started doubting the codebase before checking the file's encoding.
**Rule**: when `grep` returns nothing from a file you can clearly Read, run `file <path>` before doubting the search or the code. Fix it at the source: control characters in string literals belong as escape sequences, never as raw bytes — the runtime value is identical and the file stays greppable by every tool in the chain.

## 43. HuggingFace AutoProcessor can hardcode a tokenizer the checkpoint doesn't use — split image and text loading
**Time sink** (AI pipeline rebuild, 2026-08-09): SigLIP-2's fixed-resolution checkpoints ship `model_type: "siglip"` with `tokenizer_class: GemmaTokenizer`, but `AutoProcessor` routes to `SiglipProcessor`, whose class attribute hardcodes the v1 sentencepiece `SiglipTokenizer` — it crashed looking for a `spiece.model` the repo doesn't have. Two failed Modal image builds before reading the checkpoint's `config.json`/`tokenizer_config.json` directly.
**Rule**: for any vision-language checkpoint, `curl` its `config.json` + `tokenizer_config.json` FIRST and load parts by role: `AutoImageProcessor` for pixels, `AutoTokenizer` for text (it respects `tokenizer_class`; processor classes may not). A "successor" model family often reuses the predecessor's architecture classes — the class name in the docs (`Siglip2TextModel`) may not exist for the checkpoint you're actually loading.
**Bonus caught in the same build**: the text tower of siglip2-so400m carries Gemma's 256k vocab — ~1.2GB of embeddings alone. A "small CPU text encoder" function needs 6GB of memory, not 2.

## 44. `supabase gen types` writes its auth ERROR into the output file — the redirect truncates first
**Near-miss** (2026-08-09): `npx supabase gen types ... > database.types.ts` without `SUPABASE_ACCESS_TOKEN` exits 0 at the npm layer and the shell redirect replaces 5,000 lines of types with a one-line JSON error. Nothing failed loudly; the file was just gone. Caught because a sanity `grep -c` on the output came back 0 for a column that had to exist.
**Rule**: never bare-redirect a generator over a tracked file — generate to a temp path, sanity-grep it (a known symbol + a minimum line count), then move into place. After any generator run, `wc -l` the result before building on it. When the CLI can't auth, the Supabase MCP's generate_typescript_types works but floods context — for a small schema delta, hand-edit the three Row/Insert/Update blocks and the RPC signature instead.

## 43. Event names are not unique — a `.single()` lookup turns a duplicate into a silent skip
**Mistake** (focal backfill, 2026-08-09): a backfill script resolved its target with `.eq("name", …).single()`. The archive contains TWO events named `COLLEGEBOARD // NASAI` — byte-identical, one empty and one holding 2,542 photos. `.single()` errors on multiple rows, the script reported "No event named …", the stream logged COMPLETE, and 2,542 images were quietly skipped in a run I had already reported as finished. I only caught it by counting the per-event "Done:" lines against the list I set out to process.
**Rule**: resolve records by ID in any script that writes; accept a name only as a convenience, and when a name matches more than one row, PRINT the candidates and exit rather than pick. `.single()` is a three-way outcome (none / one / many) and its error path collapses "ambiguous" into the same branch as "missing" — never let those two mean the same thing. Corollary for batch runs: reconcile the completion report against the input list, because "COMPLETE" only means the loop ended.

## 45. A callback prop used as an effect dependency is an API contract — and "clear" must be a transition, not a state
**Found in QA** (2026-08-10, /search page): SearchBar's search effect listed `onClear` in its deps and called it whenever the query was empty; the page passed a fresh closure every render. Empty query → onClear → parent setState → new prop identity → effect re-runs → onClear… 999 "Maximum update depth exceeded" errors on an otherwise working page (React caps the loop, so nobody saw it without opening the console — the dev overlay badge was the only tell).
**Rule**: a component that puts a callback prop in effect deps has made prop stability part of its API — either document it (parents wrap in useCallback) or don't re-run on identity change. And fire "cleared" callbacks on the non-empty→empty TRANSITION (tracked in a ref), never on every empty-state effect pass: mount with an empty input is not a clear event.
**Meta**: the console check after a visual QA pass costs ten seconds and caught what three green screenshots missed. "The page renders and works" and "the page is healthy" are different claims.

## 46. Calibrate on the biggest corpus you have — and prefer adaptive cuts to constants
**Mistake** (semantic search thresholds, 2026-08-10): 0.06 was calibrated against a 6-image sandbox where noise topped 0.052 and matches sat 0.09+. On the full archive, a wedding's real "first dance" matches topped 0.058 (invisible) while archive-wide nonsense reached 0.052 — the ranges overlap, so ANY constant either hides real results or admits junk. Same shape a second time the same day: zero-shot scene labels on raw argmax let a generic "Portraits" label swallow 96% of a wedding — fixed by per-label event-mean debiasing, not a tuned constant.
**Rule**: similarity thresholds calibrated on toy samples do not generalize — the max of N noise samples grows with N, and per-query score ranges vary wildly. Ship RELATIVE decision rules (fraction-of-top cuts, mean-centered scores) with only a low absolute floor for pure noise, and validate against the largest real corpus available plus at least one deliberately absurd probe. When two live cases need different constants, the constant is the wrong abstraction.

## 47. Ship the human override in the same release as the automation
**Pattern** (People suite, 2026-08-10 — five separate field reports in one day): every automated derivation eventually met a case where its source data lied, and each time the fix was an override surface, not better automation. Consensus naming met the truncated-export ("Sami Hadouaj Mundra") → refine card + inline rename; met the two-people-one-filename case (a woman exported under "Daniel Nelson") → per-side rename in the merge review; clustering met look-alike over-merges → split view; representative faces met a contaminated cluster (friend's face fronting Bianca's card) → solo-portrait preference PLUS the modals that let a human see the contamination. Every card also needed dismiss-forever, because sometimes the anomaly is the truth (two real John Smiths).
**Rule**: when shipping a system that derives facts (names, groupings, cover choices) from noisy data, budget the correction surface into the SAME milestone: view the evidence (photos + filenames), override the fact inline, dismiss the suggestion permanently. If the only paths are "accept" and "ignore", the first wrong derivation becomes trusted data — and the user finds it after they've stopped checking. Corollary: show the EVIDENCE (filenames, both photo sets), not just the conclusion — the human is the classifier of last resort and needs the features, not the label.

## 48. Users type the UI's own labels back as data — reserve them, and make "empty" reachable
**Pattern** (People view, 2026-08-10): Mason didn't know some people's names, saw the "Unnamed" group label, and typed "Unnamed" into the rename field expecting the person to move there. The system stored it as a literal name — two clusters proudly named "Unnamed" sitting in the A-Z section. Root cause was really two gaps: the rename input had no way to CLEAR a name (empty was rejected client-side even though the PATCH route accepted null), so typing the label was the only move that looked like it might work.
**Rule**: wherever a value can be set, "unset" must be a first-class reachable state — not just a server capability the UI never exposes. And any vocabulary the UI itself displays for the empty state ("Unnamed", "Untitled", "No section") is a reserved word: treat a user typing it as the clear command, because that's what they meant. Same family as lesson 47: the correction surface has to cover the whole state space, including "I don't know."

## 49. A Supabase `.eq()` on a column that doesn't exist typechecks, then reads as "no rows"
**Bug** (`/api/stats`, found 2026-08-10): the dashboard's shares query filtered `shares` on `user_id`. That column has never existed — shares are owned transitively through `event_id → events.user_id`. PostgREST answered `42703 column shares.user_id does not exist`, the result's `.error` was never checked, `data` was `null`, and `(sharesResult.data || [])` turned a hard schema error into an empty array. Every photographer's dashboard read **Total Views 0 / Favorites 0**; the account I probed should have shown 443 and 22. Zero is a plausible number for a new user, so nothing ever looked broken.
**Why nothing caught it**: the client IS typed (`createClient<Database>`), but supabase-js types the *column argument* of `.eq()` loosely — `next build` passes on a filter column that isn't in the schema. tsc will not save you here. The type system covers the `select` shape, not the filter.
**Rule**: on any Supabase query, `error` is not optional to read. `data || []` is a lie the moment `error` is non-null: it converts "the query was invalid" into "the answer is nothing". Destructure `error` and throw it into the route's catch so `reportSystemError` fires — a 500 is honest, a confident 0 is not. And for ownership on a table with no `user_id`, use `select("…, events!inner(user_id)").eq("events.user_id", id)`; only `events`, `user_profiles`, `event_templates`, `email_templates`, `email_sends`, `activity_log` and `subscriptions` actually carry `user_id` (verified against the generated types 2026-08-10 — `subscriptions` was invisible when this was first written because it wasn't in the types yet; see #50).
**Verification that generalizes**: prove a stat by computing it two independent ways before believing either. The join and a plain `.in("event_id", eventIds)` both returned 443 views over 22 shares — matching numbers from two different bases is what makes the fix trustworthy, not the fact that it stopped erroring.

## 50. A "types drift" cleanup is a schema audit — budget for what the regeneration exposes
**Pattern** (2026-08-10, removing the Stripe `subscriptions` casts). `database.types.ts` was hand-written ("Manually maintained to match migrations 001–008") while the DB had reached 037, so `npm run db:gen-types` had never actually produced it — four Stripe call sites reached the table through `as unknown as "profiles"`, i.e. zero schema checking on billing code. Replacing 830 hand-written lines with 1,285 generated ones surfaced **15 compile errors in 12 files that had nothing to do with the change**, every one a real latent bug where the hand file claimed a column was non-null and the live schema disagreed. The biggest: `events.user_id` is **nullable** (added in migration 002 as a bare FK with no `NOT NULL`), and guest semantic + selfie search were passing it straight through as the owner scope of their RPC — an ownerless event would have searched unscoped.
**Closed 2026-08-10**: migration 038 sets `events.user_id NOT NULL` (0 null rows across 18 events; all five insert paths already set it), so the type is now `string` and the fail-closed guards are belt-and-braces rather than live paths. Kept them anyway — a constraint can be dropped, a guard in the request path cannot be dropped by accident.
**Rule**: treat replacing a hand-maintained schema type as an audit, not a mechanical swap. The errors it throws are findings, and each deserves a decision — fail closed, fall back to the column's own default, or skip the work — never a blanket `!` or `as`. Fail **closed** wherever the null feeds a security scope: a null owner means "search nothing", not "search everything". Two process notes: the generator's output is the source of truth, so any hand-edit is drift-in-waiting; and two runs 15 minutes apart differed by 27 lines because another session landed migration 037 mid-work — when a regeneration isn't byte-reproducible, diff before assuming truncation. Lesson #44's generate-to-temp discipline is what made that visible instead of alarming.

## 51. Which parts of a Supabase query the types actually check — and why a hidden zero outlives a wrong one
**Probe** (2026-08-10), pinning down the boundary #49 describes, run against the real typed client:
- `.from("subscriptionz")` → **compile error** ✅ table names are checked
- `data.made_up_field` → **compile error** ✅ the Row shape is real — this is what caught all 15 errors in #50
- `.eq("user_idd", x)` → **compiles clean** ❌ the filter column is typed loosely so embedded paths like `"events.user_id"` keep working
- `.select("nonexistent_column")` → no error at the call site; it only bites when you read the missing property

So regenerating types does **not** close the `/api/stats` class of bug. Worth stating plainly because "we now have real types" reads like the hole is covered, and it isn't — `result.error` is still the only guard.
**Correction to #49's framing**: the dashboard never displayed "0 views". `DashboardStats.tsx` builds its row as `stats.totalViews > 0 ? [tile] : []`, so the gallery-views and favorites segments *vanished* rather than showing zero — the row just read "19,642 photos · 18 events". Meanwhile the true 443 was on the analytics page the whole time (different endpoint, RPC-based), so the two were never side by side.
**Rule**: **a UI that hides empty values cannot show you a broken query.** If a metric is expected to exist, render `0` or `—` rather than omitting it — an absent tile is indistinguishable from a tile that has nothing to say, and that ambiguity is what let this sit for months. Same family as #48: the empty state has to be visible to be questioned.

## 52. `create or replace function` reverts every ALTER that was applied to it — diff the LIVE definition, not the original migration
**Near-miss** (`increment_share_views`, 2026-08-10): the function needed one extra assignment, so the obvious move was to copy its body out of migration 011 and re-issue it with the new line. Migration 011's version has no `search_path` — but the LIVE function did, because 033_infra_hygiene later ran `alter function … set search_path = public` on it (and thirteen siblings) to close a search_path-injection hole flagged by the Supabase advisor. `create or replace` rewrites the whole function object including its settings, so shipping the 011-derived body would have silently un-hardened it. Nothing would have failed, no test would have gone red, and the advisor warning would simply have reappeared with no commit obviously to blame.
**Rule**: before replacing any database function, read what is actually deployed — `select pg_get_functiondef(oid) from pg_proc where proname = …` — and treat that text as the base to edit. The migration file is where the function *started*, not where it is; every `alter function` since then lives only in the live definition. Same shape as the `onConflict`/`pg_constraint` rule already in this file: **the live catalog is the source of truth, the migration folder is a changelog.** Capture the current definition before you replace it and you get a rollback for free.
**Also worth keeping**: verify a mutating function inside `begin; … rollback;` — the check ran the real RPC against production, proved view_count 180→181 *and* the new timestamp, then left the row untouched. A read-back afterwards (`max(view_count)` back at 180, zero stamped rows) is what makes "I didn't change anything" a fact rather than an intention.

## 53. A redirect target masked by middleware is untested code — grep route literals against the app dir
**Latent bug** (2026-08-10): `src/app/analytics/page.tsx` redirected unauthenticated users to `/sign-in`, a route that has never existed in this repo (the page is `src/app/login/page.tsx`). It was invisible because `src/middleware.ts` catches `!user && !isPublic` first and redirects to `/login` before the page component ever runs.
**Where the symptom would actually have surfaced** — worth tracing, because my first reading was wrong. Had `/analytics` been added to `isPublic`, the page would redirect to `/sign-in`, middleware would bounce *that* to `/login?redirect=/sign-in` (verified against production: `/sign-in` returns 307, not 404, for a signed-out visitor — it is simply another non-public route), and the visitor would still see a login form. The 404 arrives one step later: after a successful sign-in, `/login` honours `?redirect=` and sends the now-authenticated user to `/sign-in`, which no longer matches the `!user` branch, falls through to the router, and 404s. So the failure lands on a *successfully authenticated* user, at the moment they'd least suspect the login page.
**Second-order lesson**: "it 404s" was a plausible guess I stated as fact, and one `curl` disproved it. Trace a redirect through every interceptor in the chain before describing its symptom — each hop can re-handle the request, and the visible failure often surfaces a hop later and to a different user than the obvious reading suggests.
**Rule**: a hardcoded route string in a code path an interceptor shadows gets no runtime coverage, so it must be checked statically — grep every route literal against `src/app/**/page.tsx` before trusting it. And when a page duplicates protection the middleware already provides, make the fallback IDENTICAL to the primary, params included: middleware sends `/login?redirect=<pathname>`, so the page does too. A defense-in-depth branch that behaves differently from the branch it backs up is a second behavior nobody has ever seen.

## 54. A code comment asserting an architectural fact is not evidence — probe the storage, not the docstring
**Discovery** (2026-08-10, backfilling 35 frames from SPS into the FoU26 archive gallery). `src/lib/sps-integration/import.ts` opens with "Key insight: Since SPS and Archive share the same R2 bucket, images DON'T need to be re-uploaded or copied", and `CLAUDE.md`, `docs/PRD.md` and `docs/TECHNICAL.md` all repeat it. So the obvious plan was a zero-copy import: mint metadata rows pointing at the SPS keys. One `ListObjectsV2` against `sps-prism` with the SPS key prefix returned **0 objects** — SPS v2 serves from its own public lane (`pub-7363d57d….r2.dev`), and the archive stores under `events/{eventId}/originals/` in `sps-prism`. Two different buckets. A zero-copy import would have created 35 rows pointing at keys that do not exist in the bucket the archive reads: 35 ghost tiles, and the docstring would have been the reason.
**Rule**: an architectural claim repeated across four files is still one claim, copied. Before building on "these two systems share X", issue the cheapest read that would fail if it were false — a list, a HEAD, a count. Four files agreeing is not four confirmations; the docs were probably true once and drifted when SPS v2 moved its storage. Same family as the `pg_constraint` and `pg_get_functiondef` rules already here: **the live system is the source of truth, the prose is a changelog.**
**Corollary — a re-encoding pipeline makes "we have a copy" a quality question, not a boolean.** SPS's stored "original" is a re-compressed derivative: at identical pixel dimensions its bytes were 32–36% of the archive's for the same frame. Backfilling from it closes the gap in *count* while quietly degrading those files relative to their neighbours. When copying assets between systems, compare bytes at matching dimensions before treating one side as a faithful source, and record the deficit somewhere durable (here: `tasks/sps-fou26-backfill.md` plus a receipt JSON of image IDs) — otherwise "all 353 photos are present" becomes true and misleading in the same sentence.
**Process note**: the drift ran in *both* directions (35 frames only on SPS, 51 only in the archive), which is what proved these were two independent uploads rather than a lossy import. A one-directional check — "is everything from A in B?" — would have answered the user's question and still missed what was actually going on. Diff both ways before diagnosing a sync.

## 51b. A Next.js layout is not a security boundary — and a browser cannot show you the leak
**Bug** (/ops, caught 2026-08-10 minutes after ship): the admin gate lived in the /ops layout (redirect for unauth, notFound for non-admin). With streaming SSR, Next renders the page component IN PARALLEL with its layout — so the page's server-fetched data (user emails, storage, invites) was already in the raw 200 response stream when the layout's redirect threw; the redirect became a NEXT_REDIRECT payload the client obeys. Every browser test passed because browsers follow that redirect; only `curl` against the prod URL showed the streamed body with real data in it.
**Rule**: the auth/authz gate goes at the TOP of every page/route that fetches protected data, awaited BEFORE the first fetch (here: assertAdminPage()). Layouts and middleware are conveniences layered on top, never the boundary. And verification of any access control must include the RAW response (`curl`, grep the body for data that shouldn't be there) — "the browser showed the login page" proves nothing about what was on the wire.

## 55. A special-case for the safe value is a fail-open for every other value
**Latent bug** (pre-alpha audit 2026-08-10, fixed same day): seven guest-facing resolvers each narrowed a share's visible images with the same inline shape — `if (share.share_type === "selection" && share.image_ids?.length) query.in("id", share.image_ids)`. Read as written, that is "selection shares get narrowed." Read as *executed*, it is "**everything that is not a selection gets the entire event**" — and `shares.share_type`'s check constraint has permitted `section` and `person` since 001_initial_schema, with `section_id`/`person_id` columns sitting there waiting for the feature. A section share would have served the whole archive from the first request. Nothing was exploitable because `POST /api/shares` only ever writes `full` or `selection`; the hole was one future writer away, and that writer would have been a feature commit with no reason to think about the seven readers.
**Rule**: when a conditional exists to RESTRICT, enumerate what it permits — never branch on the one case you know how to handle and let `else` mean "unrestricted." Write the deny as the default arm (`switch` with `default: return none`) so the next value added to the domain is refused until someone teaches the resolver about it. The tell to grep for: a security-relevant `===` against a single literal, with no `else`.
**What made the fix hold**: `shareScopeIdFilter()` returns an **empty Set** for a denied scope rather than `null`/undefined, so a caller who forgets the explicit 404 branch still filters everything out. The safety lives in the data the helper hands back, not in each caller remembering to check — which is the only version that survives the eighth call site. (Four of the eleven sites fixed were NOT in the audit's list of seven: the OG card, both favorites endpoints, and the dashboard's gallery-link picker. When an audit names N instances of a pattern, grep the pattern yourself — the list is a sample, and mine was too: a fresh-eyes reviewer on the diff found the last two after I'd already called it complete.)
**The subtler half — a derived row is not authorization once it has two writers.** `/fav-thumb/[imageId]` served any image with a `favorites` row for the share; the row *was* the access check. I fixed the guest writer to respect scope and thought that closed it, but `POST /api/images/batch` action `favorite` (the photographer's "Pick") is a second writer, and it had no scope check — so a pick outside a selection share's curation would still have handed that thumbnail to anyone holding the slug. **Guard the reader**, always: writers multiply quietly (a new admin tool, a backfill, a migration), and each one is a fresh chance to forget. Fixing the writers too is belt-and-braces, worth doing, but it is never the load-bearing half.
**Verification worth repeating**: reverting the resolver's `default` to the old fail-open turned 8 of 18 tests red, including a route test asserting the images table is never queried. A fail-closed test that has never been seen failing is indistinguishable from a test that asserts nothing. And before shipping, tally the live column (`22 active shares: 14 full, 8 selection, 0 section/person`) plus a prod-vs-local response diff on the same real slugs — that turns "should be inert" into "is inert."
## 56. A client-side permission check is a UI affordance — if the payload already contains the thing, the gate is decoration
**Bug** (pre-alpha audit, 2026-08-10). `require_pin_individual` ("ask for a 4-digit PIN before downloading a single photo") was enforced **only** in the browser: `GET /api/gallery/[slug]` presigned a `downloadUrl` for every image whenever `allow_download` was set, and the guest page decided whether to show the PIN modal. A guest past the password gate opened the Network tab, read the gallery JSON, and had a presigned original for all 273 photos without ever seeing the prompt. Same-scope exposure (the guest was entitled to *view* the gallery), not cross-tenant — but the photographer's stated control did nothing.
**The part that nearly shipped half-fixed**: removing `downloadUrl` alone would have been a false fix. `originalUrl` is built from `getDisplayKey(r2_key)`, and for a web-viewable format that function returns **the original key unchanged** — so the lightbox field was serving the identical bytes. Measured: PIN on, the payload's `originalUrl` fetched 670,573 bytes of original JPEG; after gating both, 41,728 bytes of 800px thumbnail. Two fields, one asset, and only one of them was named like a download.
**Rule**: when a flag says "don't hand this over", find **every** field the asset can reach the client through, then gate on one derived predicate rather than per-field. Here that's `originalsWithheld = !allow_download || require_pin_individual`, consumed by `downloadUrl`, `originalUrl`, and `coverImageUrl` alike — one expression, so a future field can't be forgotten in a different `if`. And the server, not the component, decides: the payload ships no URL at all, and `POST /api/gallery/[slug]/image-download` mints one only for a request carrying a verified PIN token. The bulk ZIP had this right the whole time (`authorizeShareDownload`), which is exactly why the individual path was worth suspecting — **when two sibling paths guard the same resource and only one calls the server, the other is the bug.**
**Verification that generalizes**: assert on the *serialized payload*, not on the fields you remembered to check — `JSON.stringify(gallery).includes("/originals/")` catches the field you forgot, which a per-field assertion cannot. 24 checks across PIN-off, PIN-on, forged token, foreign `imageId`, bulk regression, and `allow_download=false`, each proving the negative (no URL) *and* the positive (the PIN flow still delivers 670KB with the right `Content-Disposition`).
**Blast radius at the time of the fix**: zero active shares had `require_pin_individual`, `require_pin_bulk`, a `download_pin`, or `allow_download=false` — so no live gallery changed behavior. Worth measuring before shipping a gate: it turned a "does this degrade customer galleries?" question into a fact.

**What the adversarial review then caught — the fix was still wrong in three ways.** A fresh reviewer got the diff and the original bug report and nothing else. Every finding below survived verification against live data, and all three are the *same* mistake as the original bug, made again:
1. **Video still shipped verbatim.** `getDisplayKey` short-circuits on `isVideoKey` *before* consulting the withhold flag, and `getVideoDisplayKey` returns the key unchanged for `.mp4`. I had written the comment "video is unaffected — its display key is already a transcode" without reading the function: the `.mov` branch is a lossless `-c copy` remux, i.e. bit-identical essence in a different container. So the gate covered stills and let 13 real videos through untouched. **A comment asserting why something is safe is worth nothing until you have read the function it describes** — I wrote the reassurance and the hole in the same commit.
2. **The gate failed OPEN on a blank PIN.** `if (pinRequired && share.download_pin)` means "flag set, no PIN configured" skips the check entirely — and the endpoint I *added* then handed the original to anyone. Reachable: the sidebar auto-generates a PIN but the field can be cleared. Now 403. **A guard conditioned on the existence of the secret it checks is not a guard.**
3. **An unauthenticated 500 factory.** A malformed `imageId` is a Postgres 22P02 *error*, not an empty result, so `throw error` → 500 → a `system_errors` row **per request**, claiming the hourly notify slot and burying real failures. Fixed with a uuid-shape check that returns "not found".

Two client dead-ends came with it: an expired token (4h TTL) left the download button permanently inert because the modal is gated on `!downloadToken` and nothing ever cleared it; and widening the tile-button condition to `image.downloadUrl || onDownloadClick` made the owner *preview* render a button wired to a no-op handler.

**The rule worth keeping**: when you generalize a fix into a predicate, enumerate every branch the predicate flows through — `getDisplayKey` had a video path I never traced, and that path was the whole bug for 13 files. And check the *failure* direction of each new condition: I verified extensively that the gate blocks when it should, and wrote zero checks for whether it blocks when the config is half-set. My 24 checks all pointed the same way; the reviewer's first question pointed the other way and found three holes. **Testing that a lock refuses the wrong key is not testing that it locks.**

## 57. Thumbnails were generated without EXIF auto-orient — every rotated phone shot came out sideways
(Grafted from the orphaned EXIF branch, original date 2026-07-10.) `generateThumbnailsFromBuffer` read `meta.orientation` to report width/height but never called `.rotate()` before resizing. sharp strips EXIF on output, so any original with orientation≠1 lost its rotation tag while keeping unrotated pixels → sideways thumbnails, including one LIVE on the TDP site. Fixed with a bare `.rotate()` in the variant pipeline + a regression test asserting a portrait-tagged source produces portrait pixels. **Rule: any sharp pipeline that re-encodes must `.rotate()` first — reading `meta.orientation` elsewhere in the same file is not evidence the pixels are handled.**

## 58. File extensions lie — sniff bytes before deciding a file is unprocessable
(Grafted with #57.) Of two ".HEIC" images stuck in TDP Website, one was a genuine HEVC HEIC; the other was a plain JPEG mislabeled `.heic`, decodable all along. `sharp().metadata()` on the actual bytes settled it in seconds; `sips -s format jpeg` is the zero-dependency local HEIC escape hatch. **Rule: before declaring a format unsupported, check what the bytes actually are.**

## 61. Verify layout in a viewport that exists — a 0×0 browser pane invents bugs and hides them
**Two wrong conclusions in one session** (2026-08-10, the gallery section switcher). I reported that a public gallery hid its "Full Set" section behind an unlabeled "More" dropdown on desktop. It doesn't. The Browser pane was running at a **0×0 viewport** — `read_page` even printed "Viewport: 0x0" and I read past it — so `<html>` and `<body>` measured 0px wide, the tab row's `clientWidth` was 0, and the overflow algorithm correctly collapsed to one tab. I was diagnosing the harness. At a real 1440px viewport both tabs render inline.
Then, fixing the *actual* bug, I nearly filed a second phantom: the new edge-fade never appeared to turn on. Computed `opacity` was `0` while the inline style said `1` — which only an animation or `!important` can do. It was neither: `getAnimations()[0].currentTime === 0` with `playState: "running"`. The hidden pane doesn't advance the **animation clock**, so every CSS transition freezes at its start value, `scroll-smooth` scrolls never move, and programmatic scrolls emit no `scroll` event.
**Rules**:
- **Assert the viewport before trusting any layout measurement.** `document.documentElement.getBoundingClientRect().width` — if it's 0, stop and resize; `window.innerWidth` can report 1280 while the document is still 0 wide, so it is NOT a sufficient check.
- **For any transitioned property, read the inline/attribute style, not `getComputedStyle`.** The computed value is the animated value, and an animation that never advances pins it to the start. `el.getAttribute("style")` is what your code actually decided.
- **Layout bugs are width-dependent, so name the width in the claim.** "Full Set is behind More" was unfalsifiable; "at 375px the row is 208px and tab 2 needs 226px" is checkable — and turned out to be the real, mobile-only bug.
**Substantive lesson underneath it** (worth keeping on its own): **a ResizeObserver on a scroll container cannot detect content-driven overflow.** Overflow is `scrollWidth > clientWidth`, but RO fires on the *observed element's* box. When the webfont swapped in, the tabs grew while the scroll box kept its exact size — no callback, fade stuck off on a genuinely overflowing row. Observe the **content** box as well as the container (and re-measure on `document.fonts.ready`).

## 59. A caller that predicts what a route will return has forked the decision — make it call the route's own resolver
**Discovery** (2026-08-10). `POST /api/emails/send` decided whether to embed the email hero `<img>` by testing `events.settings.cover.imageId`; `GET /api/gallery/[slug]/cover` decided what to *serve* from the share's scope. Two rules for one question. For a **selection** share whose curated `image_ids` exclude the event cover, the composer said "attach" and the route said 404 — deliberately, since serving it would leak an excluded frame. Measured against production: 4 of 8 active selection shares were in exactly that state, so every gallery email they sent carried a dead hero. The same fork ran the other way too: a mosaic cover has no `imageId` at all, so the composer attached nothing while the route would happily have served the composed raster — a plainer email for no reason.
**Why nobody saw it**: `EmailPreview` hides the hero on `onError`. The photographer's preview looked clean and heroless; only the recipient's inbox showed the break. **A preview that is more forgiving than the medium it previews is not a preview** — it is a second renderer with its own bugs. Make the preview fail the way the real thing fails, or make both ask the same source.
**Rule**: when a caller must know what an endpoint will do, it calls the endpoint's resolver, not a local re-derivation of it. Here both now go through `resolveShareCoverUrl()` (`src/lib/cover/resolve-share-cover.ts`) — the composer attaches iff it resolves, the route serves what it resolves. Note this is the *opposite* of the "a guard must not share the assumption it's guarding" rule and does not contradict it: a guard must derive its check independently, but two producers of the same artifact must share one definition. The failure mode for a guard is agreeing with the bug; for two producers it is disagreeing with each other.
**Corollary — a durable URL needs a fallback or it isn't durable.** The route's pool fallback was gated on `cover.type !== "image"`, so an image-type cover that fell out of scope, or was simply deleted, dead-ended at 404 forever. A stable address handed to email clients that open it days later must self-heal to the next frame it is allowed to show.
**Two traps inside the fallback itself**, both caught only by running it against all 22 live shares:
- **Scope the pool before picking leads, never after.** `poolLeads()` collapses filename stacks to one frame each, and a stack's lead is not necessarily the frame a selection picked — filtering the leads discards a stack whose selected member was never a lead.
- **`fetchMosaicPool()` returns the FIRST section with members, not the union.** A selection whose picks all live in a later section filters that pool to empty. Three shares still 404'd after the "fix"; they needed the direct `images` query as a last resort. **A fallback added without exercising every live case is a guess** — the E2E is now `scripts/verify-share-cover.ts`, and it asserts the served frame is *inside* `image_ids`, resolved from the DB rather than trusted from the route.

## 60. A `.gte()` on a nonexistent column silently disabled the email rate limiter for five months
**Discovery** (2026-08-10, found while reading `POST /api/emails/send` for an unrelated bug). The abuse brake — "30 sends per hour" — filtered on `email_sends.created_at`. That column does not exist; the table's timestamp is `sent_at`. PostgREST 400s, supabase-js returns it as `error`, and the code destructured only `{ count }`, so `count` was `null` and `(null ?? 0) >= 30` evaluated false on every request. The brake never engaged once between the first send on 2026-03-06 and the fix.
**What made it invisible**: three things stacked. Generated types validate the table name and the Row shape but **never the column a filter names** (lesson 51), so it typechecked. The error object was returned, not thrown, and was discarded by the destructure (lesson 49). And the failure direction was *permissive* — a broken limiter looks exactly like a user who hasn't hit the limit. **The PostgREST error message was the empty string**, so even logging `error.message` would have printed nothing useful.
**Rule**: security controls fail closed. Any query whose result gates an abuse check, a quota, or an authorization decision must read `error` and refuse the request when it can't be evaluated — the fix now returns 503 and files a `reportSystemError`. And when a limiter has never been observed firing, that is not evidence it works: exercise it, or query the column list. `select("*").limit(1)` and reading the keys costs one round trip.

## 56. "Missing from B" is only a defect if B was supposed to be a copy of A
**Correction from Mason** (2026-08-10, the FoU26 backfill). I diffed the SPS gallery against the Pixeltrunk archive, found 35 frames on SPS and not in the archive, and imported them. He deleted four within the hour: they were **setup photos**. The two systems are not two copies of one set — SPS is the *live event feed* (uploaded during the shoot, setup and test frames included) and the archive is the *curated* version. A frame present on one and absent from the other is the system working, not drift.
The tell was in my own data and I walked past it: the diff ran in **both** directions — 35 only on SPS, **51 only in the archive**. I used the two-way asymmetry to correctly conclude "these were independent uploads, not a lossy import", then failed to draw the obvious next inference — that if each side legitimately holds frames the other doesn't, neither side's absences are automatically defects.
**Rule**: before reconciling two stores, establish whether one is *supposed* to be a superset of the other. If it isn't, a diff is a **report for a human**, not a work list — surface "present on A, absent on B" and let the owner judge. Never auto-import across a curation boundary. And when the user's framing ("not everything came across") presumes a defect, the two-way diff is exactly the evidence that can falsify the presumption — say so, rather than treating their framing as the specification.
**Cheap check I should have run**: the four deletions were frames 31–35, the *lowest numbered* in the set — the very start of the shoot, which is where setup frames live. A glance at the actual images, or at where the missing frames sat in the sequence, would have raised the question before I moved 43MB.

## 62. `npm run build | grep "✓ Compiled"` is not a green build — the exit code is
**Mistake** (waitlist launch, 2026-08-10): `next build` prints "✓ Compiled successfully" BEFORE lint runs, and my verification pipeline was `npm run build | grep -E "✓ Compiled|Error"` — grep matched the compile line, exited 0, and I shipped a commit whose build fails on three `@next/next/no-html-link-for-pages` lint ERRORS. Local check "passed"; Vercel's identical build errored in 30s; prod kept serving the stale deploy (old copy, 404 API) and only the outside-in prod probe caught it.
**Rule**: a build verification reads the EXIT CODE, never a grep of happy words — `npm run build; echo $?` or capture to a file and check `$?` before grepping for details. A pipeline's exit status is the last command's (grep's), so `build | grep` structurally cannot fail. Same family as "never git push -q": don't let the receipt be swallowed by the tool that's supposed to read it.

## 63. An effect that depends on the array it debounces will debounce forever
**Bug** (upload batch retire, found via Justin's 523 report 2026-08-10): the retire effect scheduled a 600ms timer, cleaned it up on re-run, and depended on `[batches]` — but `batches` gets a new identity on EVERY XHR progress tick (12 workers × per-percent updates). The effect reset its own timer many times a second, so a fully-drained batch could not retire while ANY other upload moved: a finished 42-file batch stayed in the event totals for the entire following 481-file session, inflating "headed for Unsorted" to 523.
**Rule**: when an effect exists to react to a DERIVED CONDITION (batch became drained), depend on a stable key of that condition (sorted drained-ids string), never on the raw state that changes for unrelated reasons. If the cleanup cancels a timer, ask what else invalidates the dep — anything that does will starve the timer.

## 64. Measure the population before you design the page for it
**Pattern** (Wall of Fame, 2026-08-10). Mason asked for a cross-event "wall of fame" — people appearing in 2+ events, ranked. Before building I counted: the archive holds 910 named people and exactly **one** appears in two different client events. A first query had said 123, which looked healthy until I read the names — `MOSCONE CENTER`, `Stripe BTS`, `GitHub Universe5`: filename fragments from four marketing galleries that duplicate each other's photos. The real repeat population was 1.
**What the number changed**: not whether to build, but WHAT to build. A repeat-only page ships empty and stays empty until the archive finishes migrating; the same query with the threshold removed is an index of everyone — useful the day it ships, with the wall of fame as its podium, filling in on its own. The feature got better because the data was consulted first, and it cost two SQL queries.
**Rule**: before designing a view over a population, COUNT the population, and read a sample of the rows rather than the aggregate. An aggregate can't tell you its members aren't people. Same family as lesson 29 (a frequency heuristic needs a shape guard) — and the guard that shipped here (`looksLikePersonName` + excluding the marketing galleries) exists precisely because the sample exposed what the count hid.

## 65. Clicking the subject of a page must show the subject, not guess a destination
**Bug** (people index, Mason 2026-08-10). A `/people` tile linked one of two ways: one event → straight into that event; two or more → a semantic search for the name. He clicked "Jeff Roark, 77 photos", waited through a 5,787-image event load, and arrived at Hotel Data Conference with no filter, no Jeff, nothing. Both branches were guesses at what he wanted, and the single-event branch is the worse one precisely because it *looks* purposeful — it navigates somewhere real and then fails silently, so the bug reads as slowness rather than as a wrong link.
**Rule**: a card that says "77 photos of X" has already promised what the click does. Show those 77. If a destination can't render the promise (an event page has no concept of "this person"), the answer is to build the view, not to route to the nearest page that exists. A link whose target can't honor the card's own label is a broken link with a 200 status.
**The structural fix that matters more than the modal**: membership now has ONE predicate, `personKeyForImage()`, shared by the count on the tile, the spotlight payload, and the `?person=` deep link — and `scripts/verify-person-spotlight.ts` asserts all three return the same number on live data (Jeff: 77 / 77 / 77). Counts shown on one surface and computed on another is the same shape as the email-hero and archive-cover drifts: whoever re-derives, drifts.

## 66. A default lives where the value is READ, not where the constant is written
**Pattern** (selfie search flipped on, 2026-08-10). Turning a `SharingSettings` default from off to on looks like editing one line of `DEFAULT_SHARING_SETTINGS`. It isn't: events persist `settings: {}` at creation and every default resolves at read time, so the constant governs *nothing that already exists*. All three read sites tested `selfieSearch === true`, which pins every one of the 14 existing events to the old default permanently — the flip would have shipped as a no-op for all of them and been "verified" on a newly created test event.
**Rule**: when flipping a stored-optional default, the change is at the READ sites, and absence must mean the new default (`!== false`). Give the flag one exported predicate (`selfieSearchEnabled`) so the guard on the endpoint and the condition rendering the button cannot disagree — a button that appears where the API 403s, or an API that answers where no button shows, are both one-line-apart from this. Before flipping, count the rows: `select settings->'sharing'->>'key', count(*) group by 1` tells you the true blast radius (here: 14 absent → on, 3 explicit true, 2 explicit false preserved).

## 67. A "dismiss" that only hides is the same bug as a fallback that fabricates success
**Bug** (HDC, Mason 2026-08-10): "I saw a notification that 9 images were stalled and I dismissed it. I assumed that would dismiss the error and stop waiting for them." It didn't. Dismiss wrote a timestamp to `localStorage` and removed the local manifest — the nine `images` rows survived, in ONE browser's opinion only. Hours later those rows were still rendering as blank tiles in the grid, still inflating the event's photo count (Jeff Roark's tile promised 77 photos for 68 real ones), and still counted as "uploads in flight" — which made `ai-index` return `skipped: "uploads-in-flight"` on every run and blocked AI processing for all 5,778 finished photos in the event.
**Rule**: a control whose label claims a state change must produce that state change on the SERVER, or be labelled honestly ("Hide"). The UI reporting a state the system isn't in is the identical failure to `if (!apiKey) return {ok:true}` — both answer a question with the answer the user wants rather than the one that's true. Dismiss now `DELETE`s: it HEADs each stale row in R2, deletes the genuinely empty ones, and leaves anything whose bytes landed for the reconciler to heal. Never blanket-delete "pending" rows — ~1% of them have their binary and only missed the finalize call, and deleting those destroys a photo the photographer actually has.
**The amplifier worth remembering**: nine rows out of 5,787 — 0.16% of the event — silently disabled semantic search, the Faces tab, selfie search and smart sections for the whole gallery. When a guard means "wait", ask what the maximum blast radius of one stuck row is.

## 68. A status word without a duration just relocates the anxiety
**Correction** (Mason 2026-08-10, twice). First: "Processing being stuck at 0% gives me anxiety" — a percentage that never moves is indistinguishable from broken, so work that hasn't STARTED now reads "Queued" and only work in flight shows a number. Then, given a tooltip explaining Queued: "I don't see any additional info here… perhaps show a live activity indicator showing the live status, when it will process, approximately how long it might take, and what is or isn't available until it's completed."
**Rule**: for any wait longer than a few seconds, the UI owes three answers, not one — *is it moving* (a count that changes), *how long* (an ETA measured from real throughput, never a typed-in constant), and *am I blocked* (what works now vs. what switches on later). The third is the one that decides whether the user can get on with their day, and it's the one that always gets left out. `ProcessingBanner` computes its ETA from rows-indexed-since-first-row on that event, so it reflects actual GPU speed and self-corrects.
**Corollary**: a native `title` tooltip is not a status surface. It has a delay, truncates, doesn't exist on touch, and an empty `title=""` on a child element silently suppresses the parent's — which is exactly why the cursor turned to `?` and nothing appeared.

## 69. Detail budget has to match display size
**Pattern** (loading elephant, 2026-08-10). The same two-rounded-rect chevron read as a convincing bird at 3% of the frame and as "two black tic tacs" / "two poops flapping" at 9%. Nothing changed but the scale: at distance the eye completes a silhouette, up close it counts the rectangles.
**Rule**: decide the display size FIRST, then spend detail to match. When an element can't carry the craft of what it sits beside, cut it rather than enlarging it — the close bird was deleted, the distant flock kept. Same lesson from the other direction: the first trees were five rounded rects next to a hundred-tile mosaic, and the craft mismatch ("the elephant is an art deco piece of art, those trees are child drawing garbage") was fixed not by drawing better trees but by using the mark's own CONSTRUCTION — a tile grid clipped to a silhouette, hairline grout, colour drifting in zones. Borrow the technique, not the shapes.
**Also**: flicker is a safety constraint, not a style one. Birds flapping on two held frames at 0.42s = ~2.4Hz, with wings swinging through `scaleY(-0.55)` so they vanished and inverted each frame, six of them in near-unison — squarely in photosensitive-seizure territory (guidance: stay well under 3Hz). Slowed to ~0.8Hz, no inversion, phases spread across a full cycle so the flock never pulses together.

## 70. Two galleries that must look identical have to BE the same component
**Pattern** (2026-08-10). `/gallery/preview/[eventId]` was a 609-line reimplementation of the 1,550-line guest gallery. It had drifted to filename-only search with no selfie search at all, so a photographer checking "is this what my client sees?" got a confident wrong yes. Mason: "previewing a gallery should have 100% of the fidelity of viewing a real gallery."
**Rule**: when two surfaces are *specified* as identical, sharing an implementation isn't a refactor for tidiness — it's the only way the specification can hold. The two now render one `GalleryExperience`, differing by a four-flag `capabilities` object (favorites, tracking, passwordGate, downloads) and a single `apiBase`. Every future feature lands on both by construction. The unification deleted 2,230 lines and was possible only because the page was coupled to a share through exactly ONE thing — the API path; check for that single seam before assuming a fork is permanent.

## 71. Print the exit code AND gate on it — reading it is not the same as obeying it
**Mistake** (2026-08-11, dedupe script). Ran `npm run build > log; echo "BUILD EXIT: $?"; git add … && git commit && git push`. The build failed on a TypeScript error, `BUILD EXIT: 1` was printed in my own output — and the push went out anyway, because `;` runs the next command unconditionally. Vercel errored on the deploy; prod kept serving the previous build, so nothing broke, but only because the platform refuses broken builds.
This is lesson 62 wearing a different hat. There the exit code was swallowed by a pipe (`build | grep`); here it was displayed and then ignored. Seeing the number is worthless if the next command doesn't depend on it.
**Rule**: the push must be a CONSEQUENCE of the build passing, never a sibling of it — `npm run build && npx vitest run && git push`, one `&&` chain, no `;` between a verification and the action it gates. If a chain is long enough that `&&` is awkward, that's the signal to run the verification as its own command and read the result before deciding, not to loosen the operator.

## 72. In a repo with concurrent sessions, `git add` and `git commit` must be one motion
**Mistake** (2026-08-11, Pixieset triage tool). I staged seven files by name, then ran a handful of verification commands before committing. In that gap another session in the same checkout ran its own `git commit` — which commits *the whole index*, not the files that session staged — and swept all seven of my files into a commit titled "Guest list: accept XLSX, which is what SPS actually exports". It was pushed to origin before I noticed. Nothing was lost; the history is simply wrong, and it can't be fixed because rewriting shared history under a live session is worse than the mislabel.
This is lesson-file guidance from `ship-discipline.md` seen from the other side. The documented hazard is *inheriting* another session's staged work; the symmetric hazard is *donating* yours. A clean index when you start protects you from them, and nothing protects them from you except not leaving files staged.
**Rule**: in any repo that another session may be touching, `git add <paths> && git commit` in a single chained command. Never stage and then go do something else — not a build, not a curl, not a screenshot. If verification is needed, do it BEFORE staging. And check `git log --oneline -1` after committing: "nothing to commit, working tree clean" when you expected a commit means someone else already took your files.

## 72. A token-authenticated route must be exempt from session auth, or it is broken for exactly the person it exists for
**Bug** (guest-list link, 2026-08-11). Built `/api/guest-list/[token]` — 32 bytes of entropy, hashed at rest, rate-limited, live-share required. Then curled it: **307 to /login**. The middleware protects `/api/*` by session, and the recipient is a CLIENT with no Pixeltrunk account. Every security property was right and the link was useless.
**Rule**: when the token IS the authorisation, the path must be on the public list — and adding it there is not a weakening, it's the completion of the design. Say so in the comment, or the next person "tightens" it back. The tell: any route whose audience is definitionally logged-out (email links, webhooks, public galleries, unsubscribe) but which lives under a prefix the middleware guards wholesale.

## 73. Verify the file format before writing the validator
**Mistake** (same feature). I wrote the upload route to accept `.csv`/`.tsv` because "Create Spreadsheet" sounded like CSV. SPS exports **XLSX**. The first real file Mason handed over would have been rejected by my own validator. One `file(1)` call on the actual artefact — which he'd already produced and I could have asked for — would have settled it before a line was written.
**Rule**: when integrating with an existing export, get one real output FIRST and inspect it. Format, encoding and content type are facts to observe, not infer from a button's label. Corollary: carry the observed content type through to the download, or the client's browser gets bytes it can't identify.

## 74. Two settings that travel together in the UI are still two settings
**Bug** (publish email, 2026-08-11). The download PIN was emitted as `downloadPin: includePassword ? pin : null` — it rode on the PASSWORD toggle. A gallery with a PIN and no password never rendered the toggle, so the flag stayed false and the PIN was silently dropped, leaving the client a link that asks for a PIN nobody sent them. It worked in every test because tests had both or neither.
**Rule**: one flag per user-facing decision. Coupling two because they usually appear together produces a bug that only exists in the combination nobody tried, and it fails SILENTLY — no error, just an omission the sender can't see. Same shape as lesson 66 (a default that lives at the read site): the condition and the thing it governs must be about the same fact.

## 75. "Something is stripping it" is a guess; capture the artefact at every hand-off
**Mistake avoided** (publish email blank lines, 2026-08-11). The standing theory was that empty `<p></p>` was being eaten "between the editor's HTML and the email shell's sanitiser". Both halves were wrong: there is no sanitiser anywhere in that path, and nothing was stripped. Captured at all three points with the real editor (`/dev/email-html`), the HTML was byte-identical from `getHTML()` to what the recipient received. The blank line was deleted by **CSS**: an empty `<p>` has no content, so it measures 0px and its margins collapse through it into its siblings. Measured: 15px gap with the blank line, 15px without — worth exactly nothing.
Chasing the sanitiser theory would have meant reading a sanitiser that does not exist, then "fixing" the editor's serializer, which was innocent.
**Rule**: for anything that passes through N transformations, print the value at all N boundaries before forming a theory — a `<pre>` per stage costs minutes and converts a guess into a fact. And when every stage matches, the bug is not in the data, it is in the RENDERING: measure `getBoundingClientRect()` and computed styles rather than reading more code. The tell for this specific class: an element that is visually absent but present in the DOM is almost always zero-height, and zero-height blocks collapse their own margins away.
**Corollary**: the editor was right all along — ProseMirror puts a `<br>` in empty paragraphs, so it rendered the blank line at 21px. A discrepancy between a WYSIWYG editor and its own preview is evidence about the *downstream* surfaces, not the editor.

## 76. A value you deliberately refuse to store cannot be re-read — design every surface around that, including the ones you forget
**Pattern** (guest-list link, 2026-08-11). The download token is returned once by `POST` and kept only as a SHA-256, on purpose: a database leak must not yield a working link to client PII. Three consequences that were each one step from being missed:
1. **The send route cannot mint the link.** It can still *verify* one — hash what the composer presents, constant-time compare to the stored hash. Not being able to produce a secret does not mean you cannot authenticate it; that asymmetry is the whole point of storing a hash.
2. **The rendered email was about to be written to `email_sends.body_html` verbatim** — putting a live link to the PII straight back into the database that was carefully holding only a hash. The token is redacted from the archived copy. Any log, audit row, or analytics event that stores a *rendered artefact* silently re-imports every secret the artefact contains.
3. **The UI must survive its own unmount.** The composer's step toggle unmounts the control, so the token needed hoisting to the parent — and a sheet attached in an earlier session can only be recovered by re-minting, which is why `PATCH` exists at all. A one-shot secret needs a rotate endpoint on day one, not when someone complains.
**Rule**: after choosing to store only a hash, walk every surface that touches the plaintext and ask "where does this end up?" — response body, log line, archived HTML, React state, someone's clipboard. The hash-at-rest guarantee is only as good as the leakiest of them.

## 77. Two documents describing one fact will describe it differently — reconcile the KEY before either side builds
**Near-miss** (SPS↔PT event link, 2026-08-11). `src/lib/sps-integration/import.ts` had written the flat `settings.spsEventId` since SPS import shipped, and `/api/sps/enhancements/[eventId]` read it inline. The guest-list design note in `tasks/todo.md`, written later and independently, specified the nested `settings.sps.eventId`. Two sessions were about to build in parallel — one pulling SPS events, one auto-resolving guest lists — each correctly following the document in front of it. The result would have been events linked under one key and read under the other, and the failure is **silent**: no error, no type complaint (JSONB is `Json`), just a guest list that never auto-resolves for exactly the events that were imported *correctly*, which is the hardest possible case to notice.
Nothing caught it because a JSONB bag accepts any shape and the fact had no home — it was written in one file and read inline in another, so there was no single definition for a second one to contradict.
**Rule**: when a fact is stored in a JSONB settings bag, give it an exported reader and an exported patch-builder the day the second consumer appears — not the day a bug appears. Then a divergent spec fails to compile instead of failing silently. And when work is split across parallel sessions, the shared KEY NAMES are the interface: agree them in a committed contract file first, because a naming disagreement between two correct implementations is invisible to both.
**Corollary — the incumbent wins.** Resolve the conflict toward whatever code already writes to production, not toward the newer or prettier document, then correct the document and say in it that it was corrected. A tolerant reader (accept both shapes) plus a single writer (emit one) is the safe migration; a tolerant writer is how you get both shapes forever.

## 78. When a wrong match ships PII, no heuristic is good enough
**Design call** (same feature). Mason asked how to match event names between SPS and PT given they routinely differ. The instinct is fuzzy matching on name + date. The answer is that name matching is disqualified outright here, and not because it's inaccurate — because of what the payload is. A wrong match doesn't mislabel a gallery; it emails one client the names, addresses and sign-in answers of a different client's guests. A heuristic with a non-zero false-positive rate is not an acceptable authorisation mechanism for PII, however good the rate is.
**Rule**: let the blast radius of a false positive pick the mechanism. Cosmetic consequence → heuristics are fine. Data-disclosure consequence → an explicit id, chosen once by a human, stored as an id. Fuzzy signals then get demoted to what they're actually good for: RANKING the human's picker so the right answer is usually first, never selecting for them. Corollary: the best fix is to delete the matching step entirely — a pulled event arrives already carrying the foreign id, which is why the import path should always persist it even when nothing needs it yet.

## 79. A guard that shares the ghost-row window cannot close it — invert the order instead
**Design call** (SPS pull import, 2026-08-11). The spec said to move bytes "through Pixeltrunk's own presign + `/api/upload/reconcile` path", and the obvious reading is: reuse the upload lane end to end. But presign exists for one reason — a *browser* cannot reach R2 without it — and the row-before-binary window it forces is precisely what produces ghost tiles (lessons #21–23, the eBay incident) and the reason the nightly reconciler exists at all. Reusing that path server-side would have inherited a failure mode *and* the machinery built to clean up after it, for a caller that already holds the buffer in memory.
The import writes bytes to R2 **before** the row exists. There is then no instant at which a row references an object that isn't there, so nothing needs reconciling. The remaining failure — an object with no row — is invisible and cheap, and every path after the upload deletes what it created.
**Rule**: when reusing a pipeline, separate its *invariants* (key layout, no orphan sections, thumbnails, settlement events — keep all of them) from its *compromises* (the presign window, which exists to serve a constraint the new caller doesn't have). "Follow the existing path" is right about the first and can be wrong about the second. And when a spec prescribes a mechanism rather than a property, implement the property and write down why the mechanism didn't come with it.

## 80. Verify the sibling repo's HEAD, not the handoff's description of it
**Near-miss** (same feature). The brief said SPS was "built, deployed and verified as of 2026-08-11" at spsv2 `7b2f005`, and that Mason mints a token at Settings → Pixeltrunk. Both true when written; neither current. `7b2f005` had two commits on top of it: `ab7f839` **hid the minting UI behind `NEXT_PUBLIC_ENABLE_PIXELTRUNK`, default off**, because it had shipped ungated and handed out a credential with nowhere to paste it. So the very first instruction in the brief — go mint a token — pointed at a card that no longer renders. This repo's own HEAD had also moved (`cb3fceb` → `cccc0c2`) mid-session, and one of those commits *reversed the token-storage decision* the brief stated (env var → per-user DB row).
**Rule**: a handoff prompt is a dated claim, like any sibling session's note. Before building against a described API: `git log --oneline -5` the other repo, read anything on top of the named commit, and open the route you're calling. Cheap, and it is the difference between building against the contract and building against a screenshot of it. Corollary: re-read the spec file from disk at the moment you start, not from the summary you were handed — `git log` on the doc itself will tell you if someone changed the decision an hour ago.

## 81. A DDL migration needs `lock_timeout`, or a millisecond change becomes an outage
**Practice** (migration 046, applied to production 23 minutes after a 679-photo client upload finished). The migration was additive and metadata-only — three nullable columns and two partial indexes over zero matching rows, genuinely sub-second. The risk is not the work, it is the *wait*: `ALTER TABLE` needs an ACCESS EXCLUSIVE lock, and a queued ACCESS EXCLUSIVE blocks every read that arrives behind it. One long-running query on `images` turns a millisecond migration into a stalled gallery for as long as that query runs.
`scripts/db-sql.ts` now prepends `set lock_timeout = '5s'; set statement_timeout = '120s';` to every migration it applies, so the failure mode is "the migration fails, retry later" rather than "the app hangs". It also prints the statement plan and requires `--apply`.
**Rule**: never apply DDL to a live database without a lock timeout. And when the pre-flight activity check comes back non-zero, distinguish *upload in progress* (0 pending rows, burst ended, safe) from *event being shot right now* — the gate is there to protect a live shoot, and reading it as "never touch prod after anyone uploads" is as wrong as ignoring it.

## 82. A preview must BE the thing it previews — reusing the grid, not imitating it
**Correction from Mason** (Highlights review, 2026-08-11). I built the review as a bespoke contact sheet: fixed 2:3 tiles, `object-cover`, its own caption row. Mason: *"Why do we need to re-crop tiles at all? If we just show the top 20/40 in the regular mosaic as proof that seems like magic."* He was right on three counts at once.
- **Aesthetically**: the section's own masonry already looks like the finished deliverable, so the proposal reads as the result rather than as a tool.
- **Correctness**: `ImageGrid` sizes every tile to `aspectRatio: width / height`, so in masonry mode it does not crop at all, and where it does (uniform mode, unknown dimensions) it honours `focal_x/y`. My review grid *introduced* a crop the app never imposes AND ignored the focal point — cutting faces in the one surface whose whole job is judging photographs.
- **Architecturally**: it was lesson 70 again. A second grid beside the real one starts drifting the day it is written.
The fix was ~10 lines on the shared component — an optional `tileOverlay?: (image) => ReactNode` render prop — instead of 250 lines of fork.
**Rule**: when building a preview, review, or "what the client will see" surface, render it through the **same component the real surface uses**, and add an extension point if it needs one. If you find yourself choosing a tile aspect ratio, stop: the real grid already made that decision, and yours will disagree with it. Corollary: the overlay must be a *sibling* of the tile button, never a child — a nested `<button>` is invalid HTML and hydration-errors; wrap in a `group relative` div, make the overlay layer `pointer-events-none`, and let each control opt back in.

## 83. "Nothing renders" in dev is `.next`, not your code — check before you diagnose
**Wasted cycle** (same session). Review tiles rendered at `opacity: 0` forever. I diagnosed a real-sounding React bug (image completes before `onLoad` attaches, so the fade-in never fires) and *fixed* it in the shared `ImageGrid`. The fix was unnecessary: the actual cause was a corrupted `.next` — chunk requests 404'ing and being served as `text/plain`, so React never hydrated at all. No hydration → no `onLoad` handler → permanent `opacity-0`. `find .next -name "* [0-9]*"` showed the tell: `BUILD_ID 2`, `routes-manifest 2.json`, `chunks 2` — iCloud conflict copies, the documented trap in CLAUDE.md.
The giveaway I should have used first: **dispatching a synthetic `load` event changed nothing.** If a React handler doesn't respond to a synthetic event, the component isn't hydrated, and no amount of component-level reasoning applies.
**Rule**: before diagnosing any "the UI doesn't react" bug in dev, prove hydration is alive (click something and watch state change, or dispatch an event a handler should catch). If it isn't, the answer is the build, not the code — move `.next` aside and restart. And when a diagnosis turns out wrong, *remove the speculative fix* rather than leaving it in a shared component because it seems harmless; unearned code in a shared component is how the next person inherits a mystery.

## 84. When a repro contradicts the diagnosis, suspect the repro first
**Near-miss** (date-picker click-through, 2026-08-11). Justin could not click a date on `/events/new`; the calendar looked transparent and clicks hit the "Import" link behind it. I diagnosed it correctly on the first read — `.reveal` uses `animation-fill-mode: both`, the retained transform creates a permanent stacking context, two `.reveal` siblings paint in DOM order, the popover's `z-50` is trapped. Then I built a minimal repro, it did **not** reproduce, and I concluded my diagnosis was wrong, said so, and **reverted a correct fix**.
The repro was broken three ways and each one silently produced a passing result: `.next` was corrupted by iCloud (`static/css 2`), so the page loaded with **zero stylesheets** and no animation at all; animations are throttled in the headless pane, so they sat at the FROM frame; and my first hit-test probed the popup's centre, which was **outside** the overlap region, so it "passed" regardless. Co-driving the real page settled it in two probes: hit-test at the true overlap returned `A.text-accent` before and `BUTTON.h-9` after.
**Rule**: a repro that does not reproduce proves **nothing** — it is an untested instrument, not evidence. Before trusting a negative result, prove the repro can produce the FAILURE (assert the bad state first, then fix it and watch the assertion flip). Specifically: confirm the styles/scripts you depend on actually loaded (`document.styleSheets.length`), confirm animations reached their end state (`getAnimations()` playState, or `.finish()`), and confirm the two elements you are testing **geometrically overlap** — then probe inside the intersection, never the centre of one of them. Corollary: when a hypothesis explains every reported symptom precisely and a local test disagrees, the cheapest next move is the real environment, not a bigger local test.

## 85. A denominator that moves is worse than no denominator
**Reported by Justin** (Island HQ upload, 2026-08-11): *"These numbers are not accurate and keep changing."* He watched an upload total go 1,106 → 1,090 while it ran. Both subtractions were individually correct — the server discovered duplicates chunk by chunk, and a failure was excluded too — but the total was defined as "files we still intend to upload" rather than "files you handed over", so it retreated as reality arrived. It had been written that way on purpose: excluding duplicates and failures let the progress ring close cleanly at 100%.
That trade is backwards. A ring that closes is cosmetic; a total you can reconcile against the folder you dragged in is the entire function of the display. **The denominator is what the user handed over, and it never moves.** Every file reaches exactly one terminal state, the ring closes because the work finished, and every subtraction is NAMED on screen ("16 already in this section", "1 failed") rather than silently deducted. Three separate components had each drifted into the same shortcut.
**Rule**: when a count is displayed, write down what it is a count OF, in the user's terms, before writing the filter. If the answer contains "we", "still", or "intend", it is machinery, not a fact about their work.

## 86. The whole day's bugs were one habit: surfaces reporting machinery as fact
**Pattern** (2026-08-11, eleven reports from Justin plus four found while fixing them). Not one was a crash. Every single one was a working system that looked broken, because a surface showed a number produced by internal plumbing and let it read as a statement about the user's photos:
- "85 photos still uploading" was the PRESIGN-AHEAD WINDOW — it counts *down* while hundreds of files have not started.
- "Confirmed 0" on a flawless 105-photo import conflated *reported to SPS* with *SPS had a held copy to release* (0 is correct for passthrough).
- The section sidebar rendered a mid-write transaction as final: `M–T 0 images`, `V–Z` missing, `Unsorted` still showing 1,142 after it had been consumed. The server had it exactly right.
- The stacks toggle disagreed between two people in one gallery because its default came from `detectStackable(images)` — the FILTERED view — so it changed with whichever section you had open.
- The import screen said "Import 500 photos" for a 9,107-photo event, because it counted manifest pages loaded rather than the import's scope.
**Rule**: before displaying a number, ask *what question does the user think this answers?* Then check the expression answers that question and not an adjacent one about implementation. A count of in-flight rows, loaded pages, or filtered views is a fact about the program, and the user is never asking about the program. Corollary: derive from the most authoritative cheap source — the client knows what was dropped, the rows know what landed, and neither is the queue depth.

## 87. Skipping is not the safe default when the user is pointing somewhere new
**Data loss, caught by a test upload** (2026-08-11). The duplicate guard matched `(event, filename, size)` and skipped — added after HDC came back 34% duplicates, and correct for that. But Justin put 78 photos in Highlights and the same files inside 1,143 bound for Unsorted, and the second batch vanished with no message: the guard was EVENT-scoped while the thing he was aiming at was a SECTION. Verified after the fact: 1,142 rows, no Highlights copies.
`section_images` is a link table — one image can live in many sections — so "already in this event but not in the section you are pointing at" is a request to LINK, not a duplicate. Skipping silently discarded a deliberate act.
**Rule**: a de-duplication guard must be scoped to the same unit the user is acting on. When they differ, the guard answers a question nobody asked. And check the inverse operation for symmetry while you are there: section-scoped DELETE already had this right (`partitionSectionDelete` — unlink when a copy exists elsewhere, hard-delete the last one), which is what made the upload side's event-scoping visible as a bug rather than a policy.
**Corollary that nearly bit**: the fix marked linked files with the existing `duplicate` status, which feeds the replace-or-skip panel — where "Replace" DELETES the original to re-upload an identical copy. A new terminal state was needed, not a reused one. When adding an outcome, check every consumer of the status you are tempted to borrow.

## 88. Throttles have downstream consumers that nobody told
**Design gap** (same day). Presign is deliberately throttled to a 60-task high-water mark — the fix for HDC, where 3,839 rows were minted in three minutes for a queue draining at 40/min and a dead tab took 404 photos with it. Correct, tested, documented. But the "Sort into sections" preview plans from DATABASE ROWS, and rows now appear at upload pace: Justin's 1,142 files took FIFTY MINUTES to fully register. So the modal's promise — "every file is already counted below" — was false for the entire useful window, and its author had no reason to suspect it.
The fix needed neither waiting nor loosening the throttle: `planAutoSections` is pure over filenames, and the browser has held every name since the drop.
**Rule**: when you add backpressure, list what reads the thing you are slowing down. A throttle changes the *timing contract* of everything downstream, and the downstream code usually states its assumption in a comment that was true when written.

## 89. A filter that reassigns one list orphans every snapshot taken of it

`UploadManager` held two views of the same 50-file chunk: `chunkEntries` (the
rows) and `const chunk = chunkEntries.map(e => e.file)` (the bytes). When
presign dedupe started REASSIGNING `chunkEntries` to a filtered copy, the
snapshot kept the unfiltered order. The zip at the bottom then paired row N with
file N-1. **805 of 1,142 photos in a live client gallery were filed under the
wrong person's name**, with no error, a correct count, and a ring that closed at
100%.

- **Never take a snapshot of a list you are going to filter.** Read the field off
  the element you are already holding (`entry.file`), not off a parallel array
  indexed the same way. Two arrays that must stay in lockstep are one bug away
  from not being.
- **`let` on a list is a warning sign.** The reassignments were four lines below
  the snapshot and looked completely local. Grep for other readers of the name
  before making a `const` list mutable.
- **Cross the boundary with an identity, not a position.** The presign response
  already carried `originalFilename` for every slot and nothing checked it. The
  fix asserts name-matches-entry and fails the file loudly. A protocol that
  ships an identifier and then indexes by position is not using its own protocol.

**The detector generalises: find a field written on one side of the boundary and
re-read it from the other.** `images.file_size` is written at presign from the
correct File, before any bytes move; the R2 object has its own true
Content-Length. Comparing them shares no assumption with the buggy code, so it
could not agree with the bug — 805 mismatches, each holding the size of the
photo immediately before it. Inspecting thumbnails would have shown plausible
headshots forever.

**A human confirming an AI suggestion can launder corruption into the one field
that was still correct.** The People view asked "Is this William Pashby?" about
a file named `Zaid Haq_458`. The picture genuinely was William Pashby, so
confirming was right on the evidence — but the picture was the corruption and
the name was the only sound part. 64 `fix-label` overrides renamed correctly
named rows to match wrong pictures, and they SURVIVED the byte repair because
they live in `parsed_name`, which the repair had no reason to touch. **After
repairing data, list every human decision that was made while the data was
wrong, and check whether it is still true.** Derived data (thumbs, embeddings,
faces) is obvious; a human's confirmation looks like intent, not derivation.

**Repair order matters, and the guard fights you.** The 71 files at the tails of
each chunk were never uploaded at all — the loop ran only as far as the shorter
slot list. Their rows record the CORRECT filename and CORRECT `file_size`, so
re-dropping those files hits the (name, size) duplicate guard and is silently
skipped. The rows must be deleted before the re-upload, or nothing happens and
it looks like it worked.

### Addendum — repairing from a sister product

Island's 72 unrecoverable frames were pulled from the SPS gallery rather than
re-exported by the photographer. Two things that matter for the next time:

- **Isolate the question you are actually asking.** Comparing SPS's bytes to the
  archive's "proved" SPS was lossy — but the photographer had adjusted crops and
  re-exported between the two uploads, so that diff measured HIM, not SPS. The
  test that isolates SPS is entirely internal to SPS: `images.file_size`
  (recorded at upload) vs the Content-Length of `original_url` (what it serves).
  8 of 8 served ~73% of recorded. Same shape as the guard rule — a comparison
  whose two sides share a confounder is one measurement, not two.
- **"Lossy" is a product decision, not an engineering one.** SPS's copies are a
  lighter rendition than the photographer's export. Mason's call: at 4800px on a
  headshot nobody can see it, and it beats bothering Justin. Provenance is
  stamped on the rows (`sps_image_id` / `sps_quality` / `sps_pulled_at`) so the
  difference is recorded rather than argued about later.

## 90. A count is not content, and must not be able to take the page down with it

**Symptom.** "Something went wrong. We couldn't load your events" on the archive
dashboard, constantly, cured by two or three hard refreshes. Reported
2026-08-12. Production logs named it in one line:

    GET /api/events 500 — canceling statement due to statement timeout

**Cause.** The list query was `events.select("*, images!images_event_id_fkey(count)")`.
PostgREST turns an embedded `(count)` into a correlated subquery per parent row.
`images` is written to constantly (uploads, AI indexing, SPS pulls), so its
visibility map is never current and the index-only scan degrades to a heap fetch
per row: **23,136 heap fetches for 26 events over 30,111 photos**. Warm it ran
in 16ms — which is exactly why it looked innocent. Re-measured on a busy morning
it took **2,641ms**, and under real write load it crossed the **8s
statement_timeout**, which PostgREST inherits from the `authenticator` role.
(`service_role` has no `rolconfig`, so using the service key buys no exemption —
worth knowing before assuming a server-side query is unbounded.)

**Three separate faults, only one of them the slow query:**

1. **The count and the content were the same query.** One aggregate nobody would
   miss took down 26 galleries, their covers, their statuses and their links.
   A count is an ENHANCEMENT of a row you already hold. It now runs under
   `Promise.allSettled` with the other enrichment legs, so a failure costs its
   own feature and nothing else.
2. **The failure was invisible.** The route had no try/catch and never called
   `reportSystemError` — no `system_errors` row, no admin email. It had been
   failing repeatedly and the only detector in the system was Mason noticing.
   The rule ("API catch blocks call reportSystemError") was already in
   CLAUDE.md; the file that most needed it was the one that skipped it.
3. **The same rows were being counted twice per request.** `event_readiness`
   already aggregated them in ONE grouped pass, in 166ms, for the status badges.
   The expensive path existed alongside a cheap one that was already running.

**The rules worth keeping.**

- **A count over a hot table belongs in a grouped aggregate you already run,
  never in a per-row embed.** 166ms vs 2,641ms for the identical numbers.
- **Two counts with different definitions get two names.** `total` is settled
  photos (the readiness denominator); `all_rows` is every row, which is what the
  card's "N images" has always meant. Swapping one for the other would have
  shrunk every number on the dashboard silently — the same "basis mismatch with
  matching units" that made the FosterWealth email wrong for months. Proved
  equivalence across all 26 galleries before shipping, 0 mismatches.
- **A number you could not compute renders as NOTHING, not as 0.** "0 images"
  under a full gallery is a number the app invented, and it is indistinguishable
  from an empty event. Same family as lesson 86.
- **`EXPLAIN (ANALYZE, BUFFERS)` earns its keep on intermittent failures.** Heap
  Fetches was the whole diagnosis and is invisible in timing alone — a query
  that is fast when you test it and slow in production is usually one whose cost
  depends on table churn, not on row count.

**Also found, and worth its own note:** `event_readiness` had been running in
production since the readiness work shipped but existed in NO migration file
anywhere in the repo — applied by hand and never checked in. The repo could not
have rebuilt the database. Migration 047 is both the fix and that function's
first definition under version control. Worth an audit of what else was applied
by hand: `list_migrations` against the live project vs `supabase/migrations/`.

## 73 — Re-read the user's actual words before building the general version (2026-08-13)

Mason said: *"add the year for annual **events** (eBay intern day, NASAI) and
for **company shots** like PG&E I usually include the month and year (eg
`// Jul 2026`) since we may do multiple shoots throughout the year."*

I read the trailing clause as the rule and built recurrence detection — a helper
that walked three calendars, 4,975 entries, and counted 3,239 client mentions to
decide whether a client was "recurring". It was wrong in both directions on real
data: Appfolio (two shoots a month apart) read as a one-off because recurrence
was keyed on the gallery name rather than the client, and Clario got the wrong
form because being shot once has nothing to do with being a shoot.

The actual axis was in the sentence's nouns — **events** vs **shots** — and the
gallery name answers it directly. `isCompanyShoot()` is nine lines and needs no
corpus at all.

**The rule:** when a stated preference has a *because* clause, the clause
explains the rule, it is not the rule. Build against the nouns the user chose,
and if the implementation needs a corpus walk to answer a question the user
answered in one sentence, that is a signal the question was misread.

**Corollary, and the reason this was caught:** run every heuristic over the real
corpus before shipping it. The unit tests were green on the recurrence version —
they encoded my misreading faithfully. The live run over 27 galleries surfaced
four further defects nothing else would have found: sittings dated (the calendar
keys on "Chris Barnet", the gallery is "Chris Barnet's Headshots"), internal
buckets dated, `Lombardo` "corrected" to `Lombardo's` producing `Lombardo's's`,
and `eBay HEADSHOTS` not registering as shouted — 10 uppercase of 13 letters is
77%, under the 80% threshold, entirely because of eBay's mandated lowercase e.
A brand's own casing is not evidence about the author's intent; exclude those
tokens from the measurement, not just from the fix.

## 74 — An enhancement must never share a write with the thing it enhances (2026-08-13)

Ingesting Perkin Elmer Accelerate 2018: **947 imported, 69 failed**, and every
failure line read `[object Object]`.

**Cause:** exifr returns GPS as a degrees/minutes/seconds TUPLE —
`[33, 38.1798, 0]` — and `gps_lat` is `double precision`. Postgres rejected the
update: `22P02 invalid input syntax for type double precision`.

**Why it cost so much more than a missing coordinate:** the GPS fields rode in
the SAME update as `processing_status` and `thumbnail_generated`. So one
unconvertible decoration failed the whole write and left the row at `pending`
with no thumbnail — bytes safely in R2, nothing pointing at them. A ghost tile,
the same shape as lessons #21–23, arriving by a completely new route. And while
those rows were fresh they also blocked the event's entire AI pipeline.

**The rules:**

1. **Split display-critical fields from enrichment, into separate writes.** The
   photo is the product; camera metadata is a decoration on it. Same rule the
   dashboard already follows with `Promise.allSettled` on its enrichment legs —
   "an enhancement must never be able to fail the page it decorates" — and it
   applies to writes, not just reads. Fixed in all three lanes that had the
   pattern (Pixieset ingest, `/api/upload/complete`, SPS pull).

2. **Never let an error reach a log through `String()`.** A Supabase/PostgREST
   error is a plain object, not an `Error`, so `err instanceof Error ? … :
   String(err)` renders it `[object Object]`. Sixty-nine identical lines carrying
   no information, in front of a one-line cause. Write a formatter that reads
   `code`/`message`/`details`/`hint`, and fall back to `JSON.stringify`.

3. **A unit conversion needs its SIGN source in the same breath.** The fix
   required `GPSLatitudeRef`/`GPSLongitudeRef`, which were not even in the exifr
   pick list. Without the ref, 112° W becomes +112 — an Arizona shoot in China.
   A confidently wrong value is worse than a null; out-of-range returns null.

4. **Measure the blast radius before fixing.** 0 of 31,120 images archive-wide
   had `gps_lat` set, so this write had never once succeeded — invisible for
   months because professional bodies do not geotag without an accessory. That
   measurement is also what proved only 69 rows were stranded and no other event
   was touched.

**Two smaller traps in the same session, both worth remembering:**

- **`select()` silently truncates at 1,000 rows.** My first reconciliation
  reported "1000 / 1000 linked — all visible" against an event of 1,016, and the
  status breakdown summed to 1,000 rather than 1,016. Use
  `select("*", { count: "exact", head: true })` for counts; a row fetch is not a
  census.
- **A script that calls `main()` at module load cannot be imported.** Exporting
  `publishGallery` so the repair path could reuse it ran the whole ingest CLI on
  import, which printed usage and exited the caller. Guard with
  `import.meta.url === pathToFileURL(process.argv[1]).href`.

## 75 — The driver's fidelity flag records what it ASKED for, not what it GOT (2026-08-14)

`BoxWorks 2014 Headshots Day 3` was reported by the download driver as
`fidelity: "fresh-high-res"`. The archive it produced was a **Web Size
rendition** — every sampled frame uniformly 1920px wide.

The collection's setting was correct (`high_res_download_size: 1`, Original,
verified live and identical to its two sibling collections that both passed).
The driver did POST `Download[download_size]=1`. Pixieset served a cached
archive anyway — one a CLIENT had generated at Web Size before the setting was
fixed.

**So the flag is a record of intent, and intent is not evidence.** The only
thing that knows what actually arrived is `sampleDimensions()` measuring pixels
in the delivered ZIP. That guard rejected it and quarantined it; without the
guard, an at-risk 2014 collection where Pixieset is the ONLY copy would have
been archived permanently as half-resolution derivatives.

**The general rule: when a remote system can serve you something cached, a
request parameter is a hope, not a contract. Measure the artefact.**

Corollary on how to read a MIXED sample: a rendition is UNIFORM. Two sibling
collections shot the same week sampled at median 1844px and 2880px and both
PASSED, because their widths varied (1844 / 2880 / 3840) — cropped headshot
deliverables are legitimately small. Day 3 failed not because it was small but
because it was *uniform*. Never judge fidelity on the median alone; judge it on
the spread.

## 76 — I ran the build and the push in one command, so the push won (2026-08-14)

`npm run build > log; git push` — the build failed, and the push had already
happened by the time the failure printed. `main` auto-deploys, so a broken build
went out. Vercel kept the last good deployment serving, which is the only reason
production was fine; that was luck, not diligence.

This is written in ship-discipline.md in almost these words — *"a guard chained
to the thing it guards is not a guard"* — recorded after the same mistake with
`git log … && git push`. Knowing the rule did not help. **Read the result, then
decide, then act, in separate invocations.** For a build gate specifically: run
it, read the exit code in the tool result, and only then issue the push as its
own call.

## 77 — "Not found" from a case-sensitive probe is not "not rendering" (2026-08-15)

Three checks in a row said the new confirm strip was absent from the page, and I
was about to go debug JSX placement and deployment. It had been rendering the
whole time. The label is `uppercase` in CSS, so `innerText` returns
"FROM THE CALENDAR" and my `includes("From the calendar")` never matched.

**A DOM probe searching for user-visible text must be case-insensitive**, because
CSS decides the case that `innerText` reports. More generally: before concluding
a feature is broken, prove the PROBE works — search for a string you are certain
is on the page. The earlier version of this lesson is "an empty poll result is a
BROKEN probe, not a pending answer" (workflow.md); this is the same failure with
a different disguise.

## 78 — Ask what a control MEANS before deciding what a click does (2026-08-15)

A guessed role rendered dashed and was stored as "on". So clicking it removed
it — while the row flipping to confirmed turned a sibling chip solid in the same
frame. Mason read that as "clicking lead selected photographer", which is exactly
what it looked like.

The bug was not the handler; it was that one visual state was carrying two
meanings. Dashed said *provisional* to the reader and *selected* to the code.

**When a control has a third state, it needs a third behaviour.** Enumerate what
each state MEANS to the person looking at it, then write the transition for each:

    outline  not chosen        → choose it
    dashed   proposed, not yet → ACCEPT it
    solid    chosen            → remove it

And a corollary about provenance: `roles_source` marked a whole ROW as inferred,
so confirming one thing confirmed everything on it. **Provenance has to live at
the same grain as the decision.** Per-row provenance on a per-item decision
silently launders guesses into facts — here, rehire-grade claims about named
people that nobody made.

## 79 — A comment describing a bug is not a guard against it (2026-08-15)

`normaliseClient` carried an excellent comment: a set-up entry names its gig
("Set Up for Axos Bank Headshots"), so leaving that prefix in makes it normalise
to a different client and the two refuse to group — "the exact failure this
grouping exists to prevent". The regex under it was anchored `^`.

Mason writes it both ways. "Appfolio Set Up" is trailing, so the Appfolio job
came back as two gigs a day apart. Nothing failed: the backfill counted them
separately, the create screen offered both, and the copy the payer domain lived
on was the one you would not pick. **15 spurious gigs in a 9-month window,
invisible for a year**, in a function whose comment described the problem
precisely.

The tell is that the comment generalised ("a set-up entry names its gig") while
the code special-cased (one word order). **When a comment states a rule, check
the code implements the RULE and not one instance of it** — and grep for the
other orderings before believing it does.

Found by running the live calendar, not by reading. The 72 unit tests all passed
both before and after, because they encoded the same one word order.

## 80 — Grouping decides the range; it must not also decide the label (2026-08-15)

`groupIntoGigs` merges a set-up day with its shoot day — correct, that is its
job. It also returns the group's `client` and `start` from whichever entry
opened the group, which is the set-up. Every consumer that had only wanted a
DATE RANGE was fine. The first consumer that wanted a NAME got "Appfolio Set Up"
into a gallery title and the load-in date into the gallery's date, in
production, on the first real click.

**A grouping function's identity fields are about the group's extent, not about
what to show a human.** When something copies a value out of a group and into a
user-facing record, derive it from the member that IS the thing — here the first
entry classified `kind === "gig"` — and keep the aggregate for the aggregate
question. `start`/`end` still show "Jul 13 – Jul 14"; only `client` and the new
`shootDate` changed.

Same shape as lesson 78's provenance point: the grain of the answer has to match
the grain of the question.

## 81 — A typeahead and a matcher are different questions (2026-08-15)

Sharing the backfill's `nameScore` with the create screen's autocomplete was the
obvious move and the wrong one. Token overlap cannot match "perk" to "Perkin
Elmer" — a half-typed word is not a token — so the autocomplete returned nothing
until a whole word was typed.

The fix is not to loosen the shared function. **Loosening it would have changed
1,371 unattended matches to catch one interactive one.** A prefix rule is safe
where a human reads the list and picks (an extra candidate costs a glance) and
unsafe where nothing is watching ("Pure Storage" vs "Purely Social" attaches the
wrong crew to a gallery nobody re-checks).

So: one module, two entry points, sharing the signal set —
`scoreNameAgainstClient` for the backfill, `scoreTypeahead` for the box. **"Share
the code" and "share the thresholds" are separate decisions**, and conflating
them is how a strict path gets quietly relaxed by a lenient caller.

## 82 — If a metric is EVIDENCE, it has to know who is looking (2026-08-15)

Mason asked for a "View" link to the real public gallery, because the app could
show you a mirror of your gallery and never the thing itself. One line of href.

Except `share_views` is not a vanity counter — `src/lib/events/status.ts` reads
a view as **delivery evidence**: a gallery counts as *opened* because somebody
looked at it, not because an email was sent (6 of 15 live galleries were opened
with no email ever leaving Pixeltrunk). So the photographer clicking their own
link would have marked an unopened gallery as seen by the client, and nothing
afterwards could tell the two apart.

**Before adding a path to something instrumented, ask what the instrument is
used to DECIDE.** A counter that only feeds a dashboard tolerates a stray hit; a
counter that answers "did the client get this?" does not.

The fix is that the public route now recognises its owner (`getOptionalUserId`)
and skips both the counter and the log. Note it needed a NEW helper:
`getAuthUser()` returns a 401 for an anonymous caller, which is correct for an
owner-only route and fatal for a guest gallery. **"Who is asking?" and "is the
caller allowed?" are different questions and need different functions.**

Verified by fetching the live gallery as the owner and re-reading the count: 0
before, 0 after, `last_viewed_at` still null.

## 83 — Verify the premise before HIDING a control (2026-08-15)

Mason: "all regulars can lead and travel, so we only need that chip for
non-regulars", and "all regulars are photographers so they really don't need to
have the role pill either."

Both are excellent simplifications and both are assertions about data. Hiding a
control on a false premise does not fail loudly — it silently mislabels every
person the premise is wrong about, and the UI no longer offers the means to
notice. So it was checked first (`scripts/triage/regular-kinds.ts`): 15
regulars, ALL `kind: photographer`; 46 non-regulars, all stylists. True, so the
controls went.

**Adding a control on a wrong assumption is visible clutter; removing one is an
invisible cap on what can ever be recorded.** The asymmetry is the whole point:
verify before you subtract, and put the resulting implication in ONE function
(`canLead()` / `willTravel()`) so the day the premise changes has a single site.

Corollary that bit in the same feature: **absence is not a value.** 35 of 61
active crew have `travels` unset. A radius search reading that as "will not
travel" would silently drop half the roster — so the resolver treats regular as
implying travel, and everything else unset stays *unknown*, shown rather than
filtered.

## 84 — `position: sticky` does nothing when its container is its own height (2026-08-15)

The Intel crew list was `max-h-[70vh] overflow-y-auto` in normal flow, so a tall
detail panel scrolled it off the top and left dead space. Adding `sticky top-6`
looked correct, computed as `position: sticky`, and still did not stick.

A sticky element only travels **within its containing block**. The grid parent
sized itself to its tallest child, and when the selected person had a short
panel the list WAS the tallest child — so the container was exactly 693px, the
element was 693px, and there was zero distance to travel. Picking a person with
12 gigs made the grid 1212px and it pinned at exactly `top: 24px`.

**A sticky element that does not stick is almost never the sticky rule; it is the
container** — a parent with `overflow: hidden`, or one with no spare height.
Diagnose by measuring the PARENT's height against the child's, not by re-reading
the class list. And test the case with a tall sibling, because the short case
looks broken and is actually correct.

## 85 — an ownership check missing on a NON-database resource does not trip the database habit (2026-08-15)

Mason: "make sure that none of the crew/location stuff we did will affect other
accounts." The check found a real leak, live for half a day and widened that
morning: `/api/events/suggest-gig` verified that a caller was signed in and
never WHICH caller. The Google Calendar behind it is one service account
reading a hardcoded set of Two Dudes Photo calendars, so any Pixeltrunk account
typing 2+ characters into the event-name box received Two Dudes' gig titles,
venue addresses, client domains and — via `unresolvedCrew` — attendee email
addresses. A third alpha account existed and belonged to a person ON the
roster.

This repo has shipped exactly this hole twice before (lessons #2, #14) and grew
a reflex for it: every table read behind `getAuthUser()` gets an `.eq("user_id",
…)`. The reflex did not fire here because **the calendar is not a table**. The
habit was keyed to the query builder, not to the question "whose data is this?"
— so a studio-owned credential read through `fetch` sailed past a review that
would have caught the same omission in a Supabase call instantly.

**When a route serves data from ANY shared resource — an env-var credential, a
third-party API, a file — ask the ownership question explicitly, because no
query-shaped habit will ask it for you.** The tell: a credential in an env var
is inherently ONE account's data unless something maps callers to credentials.
`sps_connections` (per-user rows) is the safe shape; `GOOGLE_CALENDAR_KEY`
(one env var) is the shape that leaks.

Three more from the same fix:

- **Measure who owns the data BEFORE choosing the gate.** The obvious gate was
  `is_admin`; measuring showed every crew/venue/org/event row belongs to info@
  (the shared team login) while `is_admin` belongs only to mason@. Admin-gating
  would have shown Intel to the account with no data and denied the account
  with all of it — a fail-closed bug that looks exactly like the fix working.
- **Ship the gate as a DROP-IN for the function every handler already calls**
  (`getIntelUser()` returns `getAuthUser()`'s exact shape). Fourteen handlers
  became a one-word edit each, and a future handler that copies its neighbour
  inherits the gate instead of a fourteen-place checklist.
- **A feature gate and an ownership filter are different protections; keep
  both.** The gate hides the feature from accounts it does not belong to; the
  `.eq("user_id")` filters are what make the data safe if the gate is ever
  mis-set. Removing either because the other exists recreates the bug.

Also from the same session's probes: **a result of exactly 1,000 rows is
PostgREST's default cap wearing the costume of a real number.** The crew-face
probe printed "1000 person clusters"; the true count was 5,299. A suspiciously
round total is a truncated query until proven otherwise — page with `.range()`
before believing any count that lands on the limit.

## 86 — a best-effort catch with no report is a lie with good intentions (2026-08-15)

The first LIVE confirmation of a crew face — tagging the "Mason Foster" cluster
to the roster — wrote the `crew_persons` link, toasted "Tagged as Mason Foster
— their face joins the references", and snapshotted nothing. The Intel panel
said "No photos of Mason yet" thirty seconds after the toast said otherwise.

Two causes, stacked:

1. **PostgREST refuses an AMBIGUOUS embed outright, and only where the schema
   makes it ambiguous.** `faces → images → events` failed with "more than one
   relationship was found for 'images' and 'events'" because those tables are
   related twice — `images.event_id` up, `events.cover_image_id` back. The
   identical unhinted embed works on any pair with a single relationship, which
   is why every other nested embed in the codebase was fine and nothing in
   typecheck, build or unit tests could catch this one. The fix is a hint:
   `events!images_event_id_fkey!inner(...)`. **Any embed through `images` ↔
   `events` needs the hint, in either direction.**

2. **The failure was invisible by my own design.** The enrichment was wrapped
   in `.catch(() => {})` — "best-effort, must not undo the link". Non-fatal was
   the right call; SILENT was not. The failure now reports to `system_errors`
   like every other caught error in this app. The rule: **best-effort means the
   OUTCOME is optional, never the EVIDENCE.** If a step is allowed to fail,
   its failure must still land somewhere a human can find, or the first real
   failure costs a live debugging session — which is exactly what it cost.

The meta-lesson is older than both: this surfaced only because the feature was
exercised against production with real data before being called done. The
probe that found it (`scripts/triage/crew-face-probe.ts`) reproduced the exact
query from the code, per the standing rule: when a guard or write misbehaves,
reproduce its exact expression before believing or dismissing it.

## 87 — I read the convenient surface instead of the durable record, four times in one hour (2026-08-15)

Restarting the Pixieset migration produced four confident wrong readings in
about sixty minutes. No data was lost, but three of the four pointed at a
disaster that was not happening, and one of them nearly caused a real delete.
They are one lesson, not four, because the shape is identical every time: **I
checked the thing that was easy to look at instead of the thing that actually
records the truth.**

1. **A stale doc line about staging.** `SESSION-HANDOFF.md` said staging was on
   the external SSD. `.env.local` said the internal disk. I repeated the doc,
   reported it to Mason as fact, then "fixed" the config to match my own wrong
   statement — undoing a deliberate reversal made the day before with
   measurements attached (77 photos/min → **2** on the drive that shares a
   spindle with Time Machine). Reverting cost two 17 GB round trips.
   **The config is the record; the doc is a claim about the config.**

2. **A probe watching a directory that gets emptied every 20 seconds.** I waited
   10 minutes for a ZIP to appear in `~/Downloads` and reported the pipeline
   stalled. The watcher had already swept the file to staging — its whole job.
   Chrome's own download history and `queue.json` both held the answer the
   entire time. **Never poll a buffer; poll the ledger.**

3. **An exit code reporting the wrong command.** `rsync … | tail` followed by
   `df` returned **0** because `df` succeeded, while the rsync had failed on an
   unsupported `--info=stats2` and moved nothing. The tool result said "exit
   code 0" and I nearly believed the move happened. Same shape as the older
   `check && echo ok` rule: **a status chained behind another command reports
   that other command.** Put the operation in its own invocation and read its
   own result — and for a move, assert byte totals on both sides.

4. **The nearly-expensive one: comparing against the wrong column.** Before
   deleting the only staged copy of a 2014 collection, I compared ZIP entries
   against `images.filename` and got **1,185 of 1,185 missing** — which reads
   exactly like "the ingest silently failed, do not delete." `filename` is the
   R2 storage key (a UUID); the camera name lives in `original_filename`. The
   corrected check returned 1,185 of 1,185 *present*. **A false alarm and a real
   one are indistinguishable until you look at a row.** I only caught it by
   printing eight actual records, which took one command.

The rule, and it is cheap: **before believing any alarming or reassuring
reading, name the durable record for that fact and check it there.** For this
repo that is almost always `queue.json`, the process's own log line, or the
database rows — not a doc, not a directory listing, not an exit code, and not a
column I assumed the meaning of.

Two corollaries worth keeping separate:

- **A count-based guard is not a presence guard.** `verifyLanded()` gates on
  `total >= expected`, which is right for the ingest and is satisfied trivially
  when an event holds images from more than one source. Releasing the last other
  copy of something needs the stricter question — is every file present, by name
  — which is now `scripts/triage/px-filecheck.ts`, exiting non-zero so it can
  gate a delete in a shell `if`.
- **A gate can be recorded in data you already have.** 22 collections have bulk
  downloads switched off; I diagnosed it as a live-page problem after a failed
  run, when `collection_download: false` had been sitting in
  `pixieset-inventory.json` since the day it was built. Before probing a live
  system for why something failed, grep the inventory you already pulled.

## 88 — OFFSET paging without ORDER BY silently double-counts (2026-08-16)

Mason, looking at `/people`: *"Steven Hughes has 186 photos; I'm thinking some
of these may be dupes."* Then: *"Jenna shows as 64 photos on the top, but when I
open her card, it says 35."*

Neither number was duplicate photos. **The index was reading the same rows
twice.** `buildPeopleIndex` pages ~39k images by firing every `.range()` call
concurrently. `range()` compiles to OFFSET/LIMIT, and **Postgres guarantees no
row order without an `ORDER BY`** — worse, its *synchronized sequential scans*
optimisation deliberately starts a new scan wherever a concurrent scan already
is, so ~39 parallel page queries each saw the table in a different order. Pages
overlapped and left gaps. Jenna's 35 real photos landed inside an overlap and
were counted twice plus change (64); Steven lost one to a gap (186 of 187).

Measured, because a race is only real if you can show it: an unordered control
scan corrupted **4 of 8 runs**, duplicating up to **10,202 rows** in one run.
The ordered version was clean 8/8. Harness:
`scripts/triage/verify-people-counts.ts`, which runs both shapes side by side —
**the unordered control is the point**, since without it a passing run looks
like proof when it may only be a quiet moment on the database.

- **Every paged read gets `.order()` on a unique, stable column.** Not "the ones
  that page concurrently" — the sequential path in `buildPersonDetail` has the
  same hole, and it only pages for people with 1,000+ frames, which is exactly
  when a wrong count is hardest to notice.
- **Dedupe by row id anyway.** Over-counting is the failure a human sees and
  disbelieves; a row that slips during an active upload comes back on the next
  load. Belt and braces, and they fail in different directions.
- **Two surfaces disagreeing is a gift.** The card said 35 and the tile said 64,
  which is what made this findable at all. When two paths compute the same
  quantity, diffing their *row sets* (not their counts) names the bug in one
  run — `scripts/triage/person-count-diff.ts`.
- **`1000` exactly is never a real answer.** Chasing this, my own probe reported
  "0 matching clusters" for Steven because an unpaged `persons` select returned
  exactly PostgREST's 1,000-row default limit and truncated him away. A
  truncated read is indistinguishable from a real absence. Same family as
  lesson 87: **check the record, and check you read all of it.**

## 89 — a backtick in a shell-quoted commit message is a COMMAND (2026-08-15)

Writing a commit message inline with `git commit -m "…"`, I referred to a
column as `` `archived` `` — the way it is written everywhere else in this
repo's prose. zsh read the backticks as command substitution, ran `archived`,
printed **"command not found: archived"**, and committed the message with the
word simply *missing*: "the state key stay  — renaming the data…". The commit
was already pushed by the time I read the output, so the gap is permanent
short of a force-push nobody wants for one word.

- **Backticks, `$(…)`, `$VAR` and `!` are all live inside double quotes.** A
  commit message full of identifiers is exactly the message most likely to
  contain them.
- **Use a heredoc with a QUOTED delimiter** (`git commit -F - <<'EOF'`), which
  suppresses every expansion, or drop the backticks. Anything else is trusting
  prose not to look like code.
- **The tell is in the output**: a stray "command not found" line beside a
  successful commit means the message is not what you wrote. Read the whole
  output, not just the receipt.

And the second failure in the same command, which is worse because it is
already written down in `ship-discipline.md`: I ran the passenger check
`git log --oneline origin/main..HEAD && git commit … && git push`. It printed
another session's unpushed commit — the warning fired correctly — and the push
ran anyway, because a guard `&&`-ed to the thing it guards is a log line, not
a guard. **Read the answer, decide, then act, in separate invocations.** The
passenger was docs-only this time (a lessons entry whose code had already
shipped), so nothing broke; that was luck, not diligence.

## 90 — a partial apply must not erase what it was not told about (2026-08-15)

Repairing one person's rehire rating on the Chicago import, I called
`applyGigIntel` with only that person in the payload. It wrote the rating
correctly **and silently detached the event's venue** — North Riverside Park
Mall — plus its `calendar_event_ids` provenance. Mason found it, not me.

The function upserted the whole intel row every time:

```ts
{ venue_id: venueId, calendar_event_ids: (input.calendarEventIds ?? []), … }
```

With no venue in the input, `venueId` is null and `calendarEventIds` is `[]`,
so a call about CREW erased two facts about the EVENT. The upsert was written
when the only caller was "apply an entire gig", where every field is always
present — and it stayed correct exactly until a second caller had a narrower
purpose.

- **In an upsert, absence must mean "nothing to say", never "set it to
  empty".** Build the row conditionally: `if (venueId) row.venue_id = venueId`.
  Clearing a field is a deliberate act and deserves its own path.
- **The tell is the call site, not the function**: any function whose input
  type is `Partial`-ish but whose write is total will do this the first time
  someone calls it partially. Ask "what happens if the caller only cares about
  one field?" before adding the second caller.
- **My repair caused a bug**, which is the sharper half. A fix that touches a
  shared writer is a change to every caller. Re-read what the writer WRITES,
  not just what you are asking it to write.

## 91 — "All" that is not all puts a hole in the search nothing explains (2026-08-15)

Mason asked for the crew band filter to narrow search results ("if I choose a
filter, it should filter my search results too"). I made the change and told
him the original case still worked, in writing: *"the default is All, so an
untouched filter still searches everyone, alumni included."*

It did not. My `inCrewBand(p, "all")` read:

```ts
if (band === "alumni") return p.archived;
if (p.archived) return false;   // ← "All" quietly meant "all ACTIVE"
```

So typing "Boris" with **All** selected returned "Nothing matches" — Boris
Zharkov is alumni. That is the exact complaint the alumni band was built to
fix, reintroduced by the change that was supposed to preserve it. I caught it
one screenshot after asserting the opposite.

- **A label is a promise the predicate has to keep.** "All" that excludes a
  category is a lie the UI cannot explain — nothing on screen says why the
  person you know exists is missing, so the reasonable conclusion is that the
  search is broken.
- **The arithmetic was the tell, and it was on screen the whole time:** the
  tab read `CREW 87` while the bands read 18 + 48 + 21 = 87. If the parts sum
  to the whole, "All" cannot be a proper subset.
- **When you change what a filter DOES, re-verify what it SHOWS.** The band
  went from being bypassed by search to governing it — a change of role, not
  of value, and every claim about the old behaviour needed re-testing rather
  than restating.
- And the process half: **do not assert the preserved case, exercise it.** One
  search would have caught this before the sentence claiming it worked.

## 92 — a LIVELOCK reads exactly like a network problem, and the clean log is the clue (2026-08-16)

Mason dropped 1,197 photos rapid-fire from several folders, tried to create a
section mid-upload, and everything stopped. Enter appeared to do nothing.
Uploads fell to **0.2 Mbps with a 26-hour ETA** on a fast connection. He
cancelled, re-dropped, and got the same thing.

I spent a long time reading the worker pool for a deadlock — the round-robin
`nextTask`, `activeWorkers` leaks, `waitForQueueRoom` (whose own doc says "if
workers stall permanently this never resolves, and that is correct"), the
mid-flight `sectionId` change. **All of it was fine.** There was no deadlock.

`updateFile` called `setBatches` on **every XHR progress event**. XHR fires
those roughly every 50ms per request; 12 concurrent workers is ~240 state
writes a second. Each write did `prev.map(...)` over every batch plus a full
re-map of the target batch's files, allocating a new object per file. **Cost
per tick was O(total files staged), not O(1)** — and "rapid fire from different
folders" is precisely the input that maximises it: ~36 concurrent batches,
~2,600 files, so ~3 million allocations per second to move some progress bars.

The main thread never came up for air. Everything downstream followed:

- **The Enter key "did nothing" — it had worked.** Vercel logged the successful
  `POST /api/sections` at 17:15:07. React simply never got a frame to render
  the new section, so he pressed Enter four more times and the server answered
  `23505 duplicate key` four times, each surfacing as an opaque 500.
- **Uploads crawled**, because XHR completion callbacks queue behind React work.
- **Presign loops all parked** at their high-water mark: 52 chunks in 25 minutes.

**The tells, in order of how much time each would have saved:**

1. **The server logs were CLEAN.** 302 × 200, and `/api/upload` answered 200 all
   52 times. A wedge with no server error and no client error is not a
   distributed-systems problem — it is one thread doing the wrong work. *Read the
   durable record FIRST; I read code for far too long before opening Vercel.*
2. **`/api/upload/[imageId]` never appeared in the route breakdown at all**,
   while `/api/upload` appeared 52 times. Presign ran; the workers did not. That
   single asymmetry located the fault on the client in one query.
3. **A performance cliff that scales with input size is a complexity bug, not a
   capacity one.** "Fine for 40 files, catastrophic for 1,200" is the shape.

**The rule: never call a React state setter from a high-frequency event.**
Progress, scroll, pointermove, resize — collect into a ref and flush on a timer.
Cost must track FLUSHES, not events, and one flush must be one pass regardless
of how many items changed.

**Use a timer, not `requestAnimationFrame`.** rAF does not fire in a background
tab, and a long upload is exactly what someone leaves running in one — progress
would freeze and terminal statuses would sit unapplied until they came back.

**Coalesce by MERGING, not replacing.** `pending.set(fileId, patch)` would let a
progress tick silently drop a status set earlier in the same window; a file
would read `pending` at 90%, and `cancelBatch` removes pending files. The test
for this is worth more than the one for the speedup.

### Three more, all found in the same 25 minutes of logs

- **`check-duplicates` put unbounded lists in two `.in()` filters.** PostgREST
  puts filter values in the QUERY STRING, so a long enough list comes back a
  bare **400 "Bad Request"**. It failed 36 times and **left no `system_errors`
  row, because it reported through a bare `console.error`** — which is why the
  whole incident had no trace. It also **self-amplified**: `imageIds` was every
  image already in the section, so the check degraded exactly as the section it
  protects filled up. *An `.in()` filter is URL length. Page it.*
- **A unique-constraint violation is the user's answer, not a fault.** `23505`
  on section name now returns **409 with the real sentence**, and the sidebar
  prints the server's message instead of throwing a generic one away.
- **A refusal is not a failure.** Rejected `.CR3`/`.psd` files rendered
  identically to failed uploads — red, with a **Retry** that could never
  succeed — and Dismiss was gated on `!isUploading`, so they were unactionable
  for the whole run. They now carry their own `incompatible` status, amber, with
  a dismiss and no retry. And **the reason was there the whole time; the layout
  ate it**: the row prints the filename in its own column and the message was
  *also* filename-prefixed, so a 180px truncation left
  `"Daren Matsuoka_25-06-05_a16z..."` as the entire explanation. *When a message
  renders beside the thing it names, it must not repeat it.*

## 93 — the identity-engine day: three DB traps, and a rule I re-broke minutes after citing it (2026-08-16)

The naming engine (migrations 065–069) hit three database traps in one build,
each already half-known, each now with its tell:

1. **PostgREST's 8s statement budget applies to RPCs too.** The full reference-
   centroid rebuild (avg over 57k 512-d vectors) died at 57014 on its first
   live call. The shape of the fix matters: make the ROUTINE path small
   (event-scoped refresh — clustering and confirms only ever change one event)
   and reserve the full rebuild for the Management API where the timeout is
   ours. Don't fight the budget; redesign the unit of work.

2. **Data-modifying CTEs share ONE snapshot.** A `with removed as (delete…)`
   followed by an insert in the same statement collides with the very rows the
   delete "removed" (23505) — the insert cannot see the delete. It worked on
   the first run because the table was empty, which is the trap's favourite
   disguise. Sequential semantics need plpgsql, full stop.

3. **The tell for silent truncation is a round number.** My backfill's
   candidate query returned exactly 1,000 rows — seven events summing to
   1,000, with WACA (the biggest group-shot gallery in the archive) simply
   absent. Third occurrence of this cap in two days (lesson 88's corollary,
   the face-membership probe, now this). If a count lands on exactly 1,000,
   it is the PostgREST default limit wearing a plausible outfit.

And the process miss: Mason asked "why am I still on the wall of fame?" after
the crew exclusion shipped. ship-discipline.md already says the FIRST
hypothesis for "the fix didn't take" is a stale build — I instead diagnosed
grid mechanics and shipped a crew-sink feature. He then said: "oh i was
looking at an older version." The shipped change was defensible on its own
merits (crew topping Everyone duplicated the crew wall above it), but the
sequence was wrong: **ask "did you reload?" BEFORE building the theory that
explains the report.** One question costs ten seconds; a feature costs a
deploy — and a fix shipped for a misdiagnosed report is untested against the
real one.

## 94 — an invariant without a display path makes correct behaviour look like data loss (2026-08-16)

Mason confirmed 22 crew clusters in the /people tray, then opened the Staff
Photos event and saw "Add name · 341" on every one of them: "I already
specifically matched some of these images in the People tab so why didn't the
confirmed names carry over?!?!" They HAD carried over — every link was in
crew_persons exactly as he made it. But a crew confirm deliberately never
writes persons.name (crew stay out of guest identity space), and the event
wall only displayed persons.name. The invariant was correct; the wall made
it indistinguishable from a bug eating his work.

**When a rule says "this write must not happen", every surface that would
have shown the write needs another way to show the STATE.** The fix was a
crew_persons join in the people route and a "Christie Jones · crew" label —
the link is the identity, so the wall must read the link. Related failure
earlier the same hour: the crew scan skipped junk-NAMED clusters (only
unnamed ones), so "Marriott Green" hid Christie — wrongly named is worse
than unnamed, and it was the one state the engine ignored.

Also cleaned: two crew names had leaked into persons.name via guest confirms
from the half-day before crew-first existed. An ordering lesson rides along:
when two identity systems share one corpus, build the PRIORITY rule (crew
first) before the volume path (guests), because every confirm processed under
the wrong priority becomes cleanup.

## 95 — a gate named for one action was firing on every action that shared its code path (2026-08-21)

Mason, poking at a PIN-gated headshot gallery as a client: opening one person's
18-shot group and pressing "Download all 18" demanded the download PIN. The
setting is called **PIN for Download All** and means the whole gallery; the
code gated on "is this a ZIP" — and a person's stack, a section, favorites and
a picked selection all ship as ZIPs. Same shape as the `linked`/`duplicate`
status trap: a mechanism (ZIP vs single file) stood in for the meaning (the
entire gallery vs a subset), and they stopped agreeing the day stacks got a
download button.

- **The rule now has one pure home, `src/lib/gallery/download-gate.ts`**:
  `bulk` = empty scope on a non-curated share; everything else is `individual`.
  The three ZIP routes pass the scope into `authorizeShareDownload`, which
  derives the gate — routes no longer name a kind — and the client imports the
  same function so the prompt and the refusal cannot disagree. A curated
  (selection) share link's "Download all" is a subset too.
- **The status route reads the job BEFORE the gate** because the stored scope
  decides which PIN applies; share ownership is still checked after, so nothing
  from the row escapes on a mismatch.
- **When a toggle's label names an action, grep for where the flag is READ**
  and check each reader agrees with the label. The sidebar copy said "Download
  All"; three routes and one client branch read it as "any ZIP".

Same day, the Highlights generator: Justin read "Still reading the photos —
Highlights waits for the whole event" as *uploading to Highlights is blocked*,
and then the panel stayed frozen after AI finished because it fetched its plan
**once on mount**. A waiting state that fills the screen must name the path
that works now, and a state that depends on a background job must re-read
when that job reports done — the page already had the live `aiStatus`; the
panel just never asked for it.

## 96 — a group shot is evidence of WHERE a face is, never of WHO it is (2026-08-21)

Justin, from the People tab: "You may want to prevent PT from doing its split
suggestions when it comes to group photos" — 14 / 8 for him, 18 / 4 for Angela.
And a merge card offering to fold a 5-face "Kaitlin Kinzer" cluster into her
7-face one, where the 5-face cluster was her DOG.

- **Split camps now count SOLO frames only.** Group files are named for whoever
  booked them (`Justin Group_26-08-19_Appfolio_1021.jpg`, four faces), and
  "Justin Group" passes `looksLikePersonName` and is not in Justin's name
  family. The mislabel engine had this rule from day one ("SOLO PORTRAITS ONLY
  … group photos are FOUND via faces, never re-labeled"); the split engine was
  written beside it and skipped it. Same input (`faceCountByImage`) was already
  on the call. The Review proposal (`resolve` route) got the same counts so it
  cannot propose what the card refuses to show.
- **Two clusters that share a frame are never offered a merge.** A person
  appears once per photo — the rule `loadFaceMembership` already uses to drop
  contaminated clusters. Verified in the DB before touching anything: the
  5-face cluster's faces sat in 5 frames that also held a face from the
  7-face cluster (5 of 5), avg detector quality 0.56 vs 0.82. Merge would have
  taught her reference set a Maltese.
- **Not done, worth doing:** the dog cluster still exists, named, on the event
  wall. A "this may not be a person" card (unname + mark not-a-face) is the
  clean end of this; today the only path is to manually clear the name.
- The general shape: **when two engines read the same data and one has a
  hard-won rule, grep the sibling for the rule before shipping it.** Rules
  written as comments in one function do not propagate.

## 97 — a flyout that lists targets while its handler silently returns (2026-08-21)

Mason, from All Images with 36 group shots selected: Copy to… showed only
"Another gallery…" and no sections. Reading the gate explained it — and found
its sibling was worse: Move to… DID list the sections from All Images, but
`handleMoveToSection` began with `if (!activeSection) return`. Pick a target,
nothing happens, no toast. A control that looks live and does nothing is the
worst of the three states (hidden / disabled-with-reason / live).

- Copy from All Images now lists the sections: copying is a LINK into the
  target and needs no source. The old comment ("copying is section-scoped
  there") described a constraint that did not exist.
- Move from All Images means "this section and no other": ADD FIRST, then
  unlink from every other unlocked section. Add-first matters — the section
  DELETE only unlinks, but a failure midway must leave a photo in two places,
  never none.
- "+ New section" lives in both flyouts (Mason's ask), same POST the sidebar
  uses; the created section is picked immediately.
- Tori Marifian Marifian: ONE file at the shoot carried the doubled surname,
  and that single file named her 37-face cluster and minted a second /people
  identity. `collapseRepeatedWords` now runs at every name-extraction home
  (`extractPersonName`, `nameBeforeDate`, `parseFilename`); the row and the
  cluster were repaired by hand in production (image 6a7b34e3…, person
  07342b30…).
- The tell for the move bug was the screenshot itself: two menus with the
  same shape behaving differently from the same place. **When two siblings
  differ, diff their gates before reading either one's handler.**
