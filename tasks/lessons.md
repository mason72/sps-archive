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
