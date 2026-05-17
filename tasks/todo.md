# Pixeltrunk — Build Plan

> **Branch:** `claude/pixeltrunk-deep-review-0U5wb`
> **Status:** Plan drafted after a deep five-track audit (UX, aesthetics, bugs, security, AI pipeline).
> **Strategy (per owner):** Fix bugs first, then aesthetic polish, then reactivate AI separately. Defer Modal AI for now. Allow breaking changes (live but few users). Wire `ClientIdentityModal`, delete other dead components. Add Sentry. Truthful/modest AI copy.

---

## Phase History

### Phases 1–11 [DONE]
Scaffold, schema, upload pipeline, AI pipeline (Modal), gallery + search, design system, data wiring, auth + shares, thumbnails, rebrand, SPS integration. See git history.

### Phase 12 — Earlier "Future Enhancements" [SUPERSEDED]
Replaced by the consolidated plan below.

---

## Five-Track Audit Findings (Feb 2026)

Two systemic root causes plus a dead-code overhang explain ~90% of the "buggy" feeling:

1. **`getAuthUser()` returns the service client by default** → 13+ P0 IDORs across events, images, search, shares, stacks/cover, favorites, sections/images, upload, upload/complete. Any logged-in user can read or modify any other photographer's data.
2. **Upload/processing status state machine fights itself** → `/api/upload/complete` writes `complete` before Inngest runs; Inngest then flips to `processing` and back. Combined with fire-and-forget thumbnail generation and a try/catch that swallows Inngest dispatch errors, users see "5 photos processed" toast → blank grid → some images permanently stuck.
3. **~2,500 lines of dead UI** (`ActivitiesPanel`, `ClientIdentityModal`, `SectionManager`, `EventSettingsPanel`, `SharingTab`, `MoreMenu`) plus broken routes (`/g/{slug}`, `/sign-in`, `/dashboard/settings`). The headline "see who picked what" value prop is unwired — every favorite saves with `client_email = NULL` because `ClientIdentityModal` is never imported.
4. **AI is dead in production but live in marketing copy.** `SearchBar` hardcodes `filename`; `MODAL_API_URL + "/embed-text"` 404s; three scene tags mismatch between Modal and TS; reclustering destroys all `persons.name` values; stack rebuilds aren't idempotent.
5. **Editorial spine, retail seams.** Strong brand language (Playfair, Libre, pixel-mosaic) but six BrandButton colors used inconsistently, five different H1 sizes, mobile lightbox has no nav arrows.

Full audit reports live in the PR description.

---

## Phase 0 — Stop the Bleeding [DONE]
**Goal:** Close every P0 security gap and harden the auth/state surfaces. 10 commits on this branch (see git log bfbe4b9..HEAD).

### Auth architecture refactor [DONE]
- [x] `getAuthUser()` returns the cookie-bound RLS client by default. RLS policies on events / images / stacks / sections / faces / persons / section_images now scope every query to `auth.uid()`. Routes that legitimately need service-role import `createServiceClient` explicitly. Single change fixed ~13 P0 IDORs at once.

### IDOR sweep [DONE — via the helper refactor]
All routes that called `getAuthUser()` (events, images, search, shares, stacks/cover, favorites event side, sections, upload, retry-processing, etc.) now run under the RLS-bound client. Existing explicit `.eq("user_id", user.id)` filters stay in place as belt-and-suspenders. Non-owned UUIDs return 404 instead of leaking.

### Authenticate `/api/upload/complete` [DONE]
- [x] Require auth + verify image's parent event belongs to user via RLS-scoped UPDATE.
- [ ] Set status to `pending` (not `complete`) — *deferred to Phase 1 state-machine fix; this commit closes the auth hole without changing user-visible status behavior.*

### Share-system hardening [DONE]
- [x] Dropped `"Anyone can read active shares"`, `"Anyone can view favorites"`, and `"Anyone can delete own favorites"` RLS policies (migration 012). Added SECURITY DEFINER RPC `resolve_share_by_slug` returning only safe columns.
- [x] Gallery cookie auth uses HMAC-signed tokens (`pt-gs-<slug>`) instead of raw share.id, via `lib/shares/session.ts`.
- [x] `/api/gallery/[slug]` and download route branch on `share_type` — section/person shares no longer leak the whole event.
- [x] `originalUrl` now only ships when `allow_download` is true (was UI-only restriction before).
- [x] PBKDF2-SHA256 600k iterations with legacy SHA-256 verify + auto-rehash on next login. No password resets required.
- [x] `crypto.timingSafeEqual` on PIN, password (byte-level), and SPS API key.
- [x] PIN moved from URL `?pin=` to HMAC-signed `pt-pin-<slug>` cookie set by verify-pin.
- [x] Rate limit (in-memory LRU) on verify, verify-pin, signup, forgot-password.
- [x] OG image route returns generic "Private Gallery" card for password-protected shares.

### SPS integration tightening [DONE]
- [x] `crypto.timingSafeEqual` on API key compare.
- [x] r2Key shape check (`events/<uuid>/originals/<filename>`). Full ownership verification still requires an SPS callback (Phase 5+).
- [x] Payload cap at 5,000 images per import.

### Stripe hardening [DONE]
- [x] Migration 013 creates the `subscriptions` table with RLS + signup trigger + backfill (code had been writing to a table that didn't exist).
- [x] Migration 014 creates `stripe_events(event_id PK)` for webhook idempotency.
- [x] Webhook dedupes via PK insert; rolls back the dedupe row + returns 500 on handler exception so Stripe retries.
- [x] `isAllowedPriceId()` gates checkout against env price-id allow-list; webhook refuses unknown priceIds instead of defaulting to "pro".
- [x] Webhook resolves user via `subscriptions.stripe_customer_id` (the server-side binding) rather than trusting `metadata.supabase_user_id`.

### Open-redirect / SSRF fixes [DONE]
- [x] `safeRedirect()` helper rejects absolute / protocol-relative / backslash-escaped paths.
- [x] forgot-password uses `NEXT_PUBLIC_APP_URL` only (no Origin-header fallback). Dev-mode reset URL log gated behind `NODE_ENV === "development"`.
- [x] login `?redirect=` validated through safeRedirect.
- [x] `/auth/callback` `?next=` validated.

### Misc hardening [DONE]
- [x] SVG rejected by logo upload (raster only).
- [x] CSP added to `next.config.ts`; `Image` remotePatterns tightened to configured R2 hostname.
- [x] HTML-escape `fullName`/email in admin signup notification.
- [x] `/api/upload` whitelists JPEG/PNG/WebP/HEIC/TIFF and caps at 100MB.
- [x] `/api/admin/batch-thumbnails` requires user.email ∈ `ADMIN_EMAILS` env list.
- [x] `/api/stats` queries shares by event_id (the schema FK), not the non-existent `shares.user_id`.
- [x] `/dev`, `/playground`, `/mockups` return 404 when `NODE_ENV === "production"` (middleware rewrite).
- [x] Favorites public GET no longer returns `client_email` / `client_name`; POST/DELETE validate `imageId` is in share scope.

**Acceptance:** Manual IDOR test from a second account against the first's event/image/share/stack/section UUIDs returns 404/403 everywhere.

### Deployment prerequisites
Before deploying this branch:
1. Apply migrations 012, 013, 014 to production Supabase (run SQL in order).
2. Set new env vars in Vercel:
   - `GALLERY_SESSION_SECRET` — random string ≥32 chars (`openssl rand -base64 48`)
   - `ADMIN_EMAILS` — comma-separated admin email allow-list
3. Active share viewers will keep their session cookies but the cookie format changed. Existing `gallery_auth_<slug>` cookies are ignored; viewers re-enter the password once, then get a new `pt-gs-<slug>` cookie. Passwords themselves don't need to be reset — legacy SHA-256 hashes still verify and are auto-upgraded on next successful entry.
4. Anyone running self-hosted Supabase: confirm RLS policies from migration 012 dropped successfully (some hosted Supabase tiers cache RLS).

---

## Phase 1 — Make the Core Flow Bulletproof [SUBSTANTIALLY DONE]
**Goal:** Stability sprint. Eliminate silent failures, fix the upload/processing state machine, surface real errors, kill dead code.

### Upload + processing state machine [DONE]
- [x] Migration 015 adds `images.last_error` text + `event_image_status_counts` RPC.
- [x] `processing_status` transitions: pending → processing → complete (on thumb success) or failed (on thumb error). "complete" now means safe-to-render, not a premature flag.
- [x] Real upload progress via XMLHttpRequest with per-file bar.
- [x] Thumbnail variant generation made sequential (was OOM-risk on 50MB originals).
- [x] `useProcessingStatus`: single combined RPC, exponential backoff (2s→30s), restarts on snapshot change, returns `recentFailures` so UI can show what's wrong.
- [x] Three routes were filtering `processing_status != "error"` (never a valid value) — fixed to `!= "failed"`.
- [ ] Janitor cron: deferred (orphans are now a tiny risk because /api/upload/complete is authenticated; can ship as a simple admin endpoint when needed).

### Observability [DONE]
- [x] Sentry SDK wired via `instrumentation.ts` + `instrumentation-client.ts`. No-op without `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
- [x] `src/lib/log.ts` structured logger — `log.info/warn/error(channel, message, ctx)`. Forwards `ctx.err` to `Sentry.captureException`.
- [x] `/api/admin/health` GET endpoint (gated by `ADMIN_EMAILS`): stuck-processing count, failed count, recent failure feed, configured-or-not flags for Inngest/Modal/Sentry.

### Dead code purge [DONE]
- [x] Wire `ClientIdentityModal` into gallery favorite flow. First-add-favorite triggers the modal; identity persists in localStorage with a `prompted` flag so a skip doesn't re-ask.
- [x] Delete unused: `ActivitiesPanel`, `SectionManager`, `EventSettingsPanel`, `SharingTab`, `MoreMenu` (~2,200 lines).
- [x] Fix broken routes: `/sign-in` → `/login`, `/dashboard/settings` → `/account?tab=branding`, `/g/<slug>` → `/gallery/<slug>` in email variable example.
- [x] Convert `/dashboard` and `/events` runtime-redirect pages into `next.config.ts` redirects.
- [x] Move favorites GET to image-IDs-only (no client_email leak); add image-in-share validation on POST/DELETE.

### Race & state bugs [DONE — relevant ones]
- [x] Atomic stack cover swap via `set_stack_cover()` RPC (migration 016). Was three round-trips; concurrent requests could leave two rank=1 images.
- [x] Surface finalize failures in UploadZone (was the "both branches mark complete" dead code).
- [-] Inngest `event/processing.complete` debounce: deferred — Inngest only runs when AI is enabled, which is being deferred in Phase 2.
- [-] `buildFaceStacks`/`buildBurstStacks` idempotency: deferred for the same reason. Will land alongside AI reactivation.
- [x] React selection deps bug: already resolved in earlier commit (destructured stable refs at the call site).

**Acceptance:** Build passes. Upload state machine now transitions cleanly. Sentry catches server + client errors when DSN is set. `/api/admin/health` shows ops-grade status.

### New deployment prerequisites added since Phase 0
- Apply migrations **015, 016** to production Supabase.
- (Optional) set Sentry DSN env vars for error monitoring.

---

## Phase 2 — Defer AI Cleanly [TODO]
**Goal:** Stop promising AI; ship filename-only search with grace. Code stays for future reactivation.

- [ ] Add `ENABLE_AI=false` env flag. Default false. Gate all AI surfaces.
- [ ] Hide search-mode toggles in `SearchBar`; ship filename-only with a single "Search filenames" placeholder.
- [ ] Hide `SmartStack` rendering when no stacks exist (already true) — but also gate the entire stacks-building Inngest workflow behind `ENABLE_AI`.
- [ ] Hide Auto-Sections UI behind `ENABLE_AI`. Manual sections remain available.
- [ ] Delete the `MODAL_API_URL + "/embed-text"` code path that 404s.
- [ ] Update copy across landing/search/event-creation/signup to remove AI promises. Voice: truthful & modest.
  - Landing: replace "AI organizes them" with concrete value ("Organize, search by filename, share with clients").
  - Search page: "Search every photo by filename. Smart search coming soon."
  - Event creation: drop "Helps AI choose scene categories and stacking strategy".
- [ ] Mark Modal env vars in `.env.example` as "optional, future feature".
- [ ] Keep pgvector columns + migrations — reactivation-ready.

**Acceptance:** App fully usable with `ENABLE_AI=false`. No "AI" word visible in any user-facing copy. No 404s to Modal. No broken AI UI shells.

---

## Phase 3+ — Deferred items knocked out [DONE]
Session 2 picked up the items deliberately deferred during the
original Phase 3 + Phase 4 pass.

### Photographer star (migration 017)
- [x] `images.starred` boolean column + partial index on `event_id` WHERE starred = true.
- [x] PUT `/api/images/[imageId]/star` (toggle or set), `PATCH /api/images/batch` adds `"star"` / `"unstar"` actions.
- [x] Lightbox `Star` action with F shortcut + filled/outline state.
- [x] `Set as event cover` action with C shortcut on the lightbox.
- [x] Grid corner indicator (amber star, top-right).
- [x] Toolbar toggle on event page filters the grid to starred only.
- [x] F-key on grid selection now toggles `starred` instead of auto-creating a public share (closes the audit's loudest UX hazard).

### Dashboard recent activity
- [x] New `<RecentActivity>` strip on the dashboard (top 5 client events with friendly summaries + relative time). Self-hides on empty.
- [x] New lightweight `/api/dashboard/recent-activity` endpoint that batches the event-name join.

### First-run onboarding
- [x] `<OnboardingPrompt>` modal triggers on dashboard mount when `display_name` and `business_name` are both empty. Stores dismissal in localStorage. Skip-friendly.

### Pre-flight share checklist
- [x] `<ShareChecklist>` (already existed in ShareModal) now also rendered above the email compose on `/events/[eventId]/share`.

### Janitor
- [x] `POST /api/admin/janitor` (ADMIN_EMAILS-gated). Sweeps orphan `pending` images older than N hours. Best-effort R2 delete + DB delete. Supports `dryRun: true`. Caps to 500/run with `hadMore` flag.

### Bulk ZIP streaming refactor
- [x] Switched from `response.arrayBuffer()` → `Readable.fromWeb()` so archiver drains R2 incrementally. Memory peak bounded to a single chunk regardless of file size.
- [x] Dedupes filename collisions ("IMG_4532.jpg" twice → "IMG_4532 (2).jpg").
- [x] archiver warnings logged but no longer abort the whole download.

### Aesthetic finishes
- [x] `<PixelMosaic>` component extracted from the gallery-footer signature. Applied to dashboard / search / event empty states — the elephant-pattern thread now runs through every empty surface.
- [x] `<Divider>` primitive (replaces three ad-hoc patterns going forward).
- [x] Toast restyle: 2px emerald accent rail (red for errors), squared corners, editorial typography.
- [x] Squared SectionedGallery tabs already done in Phase 4.
- [x] Selection feedback (dim unselected) already done in Phase 4.

### Misc polish + security finishes
- [x] Forgot-password 600ms response-time floor — closes the email-enumeration timing oracle.
- [x] `/api/gallery/[slug]/track` validates that `imageId` belongs to the share's event (was a fake-imageId log-spam vector); rate-limited to 120/hour per IP+slug.
- [x] Event tab title now uses RLS-bound client (no event-name leak via document.title for non-owners).
- [x] Gallery `<slug>` layout sets meaningful `<title>` + OG title; password-protected shares fall back to "Private Gallery" matching the OG image gate.
- [x] ImageGrid tile button gains descriptive `aria-label` + `aria-pressed`.
- [x] Marketing pricing copy: drops "All AI Features" / "Natural Language Search" / RAW+AI storage caveats to match the truthful Phase 2 voice.
- [x] ShortcutsHelp overlay reflects new lightbox shortcuts (F star, C cover, ⌫ delete).

### Still deferred (good follow-ups)
- [-] Lightbox "Add to section" action (needs a section-picker popover; out of scope here).
- [-] Truly canonical share UI — ShareModal + share page still coexist. Worth a design pass.
- [-] Demo-event seed for first-run.
- [-] Sweep `text-[clamp(…)]` usage to the new display-xl/lg/md/sm tokens (low-risk migration any time).

---

## Phase 3 — Make the Core Experience World Class [SUBSTANTIALLY DONE]
**Goal:** UX consolidation. Pixeltrunk starts to feel premium.

### Navigation & structure [DONE]
- [x] `<AppNav>` with logo · Events · Search · Analytics · Templates · Account · Sign out. Replaces 8 inconsistent per-page nav arrangements. Mobile collapses the secondary links (still reachable via ⌘K).
- [x] ⌘K command palette now lists Search, Analytics, Email Templates (was just Dashboard/New Event/Account/Sign Out).

### Sharing flow [DEFERRED]
- [-] Single canonical share UI: deferred. Both surfaces stay; the modal handles "share this selection" and the page handles full compose. Worth a focused design pass.
- [-] Decouple photographer star vs public favorite: deferred. Needs a `photographer_starred` column and a UX decision on whether F means private star or share-favorite.
- [-] Pre-publish checklist: deferred.

### Lightbox [DONE — first pass]
- [x] Photographer actions API on `<Lightbox>` (`actions={[…]}` prop) + Delete wired with Delete-key shortcut + destructive styling on the event detail page. Pattern ready for set-as-cover, add-to-section, photographer star follow-ons.
- [x] Mobile nav arrows visible (were `max-md:hidden`). Smaller (36px) on mobile; image area gets `px-12 md:px-16` so the photo actually has room.
- [x] Metadata prefetch already in place (useLightbox.prefetchDetail).

### Onboarding [DEFERRED]
- [-] First-run modal: deferred. Design-heavy; needs tone calibration. Notable that ClientIdentityModal pattern (Phase 1) is the template.
- [-] Demo-event seed: deferred.

### Account / billing [DONE]
- [x] Storage meter on `/account` Billing tab — used vs plan limit, progress bar, amber at 80%, red at 95% + upgrade link. New `/api/account/storage` endpoint.

### Search [DONE — relevant items]
- [x] Deep-link search results to specific image via `?image=<id>` — event page auto-opens the lightbox at that image.
- [x] `/api/search` sanitizes query input (strips `,()` that would break PostgREST `.or()`).

### Downloads [DEFERRED]
- [-] Bulk ZIP refactor: deferred. Current implementation streams from R2 already; the per-image buffer is the main fragility. Not blocking real usage.

### Misc
- [-] Pixel-mosaic empty states: deferred (small, can land any time).

---

## Phase 4 — Aesthetic Refinement [PARTIAL]
**Goal:** Editorial coherence. Make every page feel crafted.

### Typography [DONE — tokens added; sweep deferred]
- [x] `display-xl/lg/md/sm` utility classes in globals.css with documented sizes + line-heights and body/lead/micro vocabulary in comments.
- [-] Sweep existing `text-[clamp(...)]` headings to use tokens: deferred (low-risk migration any time).

### Color & components [PARTIAL]
- [x] BrandButton retires the rainbow — only emerald is honoured. `color` prop kept for back-compat but ignored.
- [x] StatCard normalized to stone-only palette (was raw blue-50 / orange-50).
- [x] Squared SectionedGallery tabs with bottom hairline (replaces rounded-full pills).
- [-] One `<Divider />` primitive: deferred.
- [-] Toast restyle: deferred.

### Gallery & lightbox [DONE — relevant items]
- [x] Selection feedback inverted: unselected dim to 40% (60% on hover) instead of tinting selected emerald. Drops the green-overlay layer.
- [-] SmartStack aspect: deferred.
- [-] Touch target review: deferred (tile is the click target, checkbox is decoration).

### Brand moments [DEFERRED]
- [-] Pixel-mosaic ornament in empty states: deferred.

---

## Phase 5 — Reactivate AI [DEFERRED]
Not part of this work cycle. When the foundation is solid:

- [ ] Fix Modal status state machine; atomic result persistence via SQL function.
- [ ] Idempotent face/burst stacks; name-preserving reclustering (match new clusters against existing person centroids).
- [ ] Response schema validation (zod) on every Modal call; per-error classification.
- [ ] Timeout/retry/auth on Modal calls.
- [ ] Cost guards (per-event Modal spend cap; abort if exceeded; email admin).
- [ ] Cache text embeddings.
- [ ] Match Modal scene-tag dictionary to `src/lib/ai/types.ts`.
- [ ] Fix `MODAL_API_URL` — separate endpoints for process_image and embed_text.
- [ ] Roll out as opt-in beta to owner's own account first.

---

## Cross-Cutting Improvements (consider during phases above)

- **Presigned URL TTL:** Reduce from 4h to 5-10 min for originals; serve thumbnails through a CDN-cached endpoint that revalidates auth.
- **Activity log surfacing:** Wire a dismissible "recent activity" strip on the dashboard (3-4 lines).
- **SPS architecture:** Long-term, refactor SPS integration so SPS calls Archive as a service (not as a JWT user). Archive verifies R2 keys against trusted SPS DB.
- **Comments policy:** Strip dead/obsolete comments and `AI_HIDDEN` tags as files are touched.

---

## Open Questions to Revisit

- Should `/dev/buttons` ship in production at all (currently public)? Probably move to dev-only with the others.
- Mobile UX warrants its own polish pass — flagged but not yet scoped.
- Email template starter seeds: should we ship 3–4 starter templates (welcome / proof / final-delivery) on signup?
- Analytics dashboard is currently unreachable from in-app nav and unstyled — Phase 3 should fix nav; Phase 4 should refine visuals.

---

## Review

_To be filled in as phases complete._
