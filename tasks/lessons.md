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
