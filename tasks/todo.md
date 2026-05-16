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

## Phase 1 — Make the Core Flow Bulletproof [TODO]
**Goal:** Stability sprint. Eliminate silent failures, fix the upload/processing state machine, surface real errors, kill dead code.

### Upload + processing state machine
- [ ] Single source of truth for `processing_status`. Proposed states: `pending` → `uploaded` → `thumbnailing` → `ready` → `failed`. No `complete`/`processing` ping-pong.
- [ ] Add `last_error TEXT` column on `images`. Populate from Inngest `onFailure` and any caught exception.
- [ ] Real upload progress (XHR with `progress` events, not `fetch`). Per-file % bar.
- [ ] Thumbnail generation: convert fire-and-forget to an Inngest function with retries + error logging; sequential variant generation to avoid OOM on 50MB originals.
- [ ] `useProcessingStatus`: single combined count query, exponential backoff, restart on new uploads.
- [ ] Janitor: cron Inngest function deleting `pending` images older than 24h with no R2 object.

### Observability
- [ ] Wire Sentry (server + client). Free tier.
- [ ] Structured logging helper with `eventId`/`imageId`/`userId` tags. Replace `console.error` throughout.
- [ ] Health endpoint `/api/admin/health` exposing: images stuck in processing > 10 min, Inngest queue depth, recent error rate.

### Dead code purge
- [ ] **Wire** `ClientIdentityModal` into `gallery/[slug]/page.tsx:165` favorite flow. First favorite per session prompts for name + email, persists to localStorage, posts `clientName`/`clientEmail` to favorites API.
- [ ] **Delete** unused: `ActivitiesPanel.tsx`, `SectionManager.tsx`, `EventSettingsPanel.tsx`, `SharingTab.tsx`, `MoreMenu.tsx` (and any imports they referenced).
- [ ] **Fix broken routes**: `/sign-in` → `/login` (analytics page), `/dashboard/settings` → `/account` (ShareChecklist), all `/g/{slug}` references → `/gallery/{slug}` (email vars, ActivitiesPanel before deletion).
- [ ] Replace `/dashboard` and `/events` redirect pages with `next.config.ts` rewrites.

### Race & state bugs
- [ ] Inngest `event/processing.complete` debounce: ensure exactly one fire per event-completion. Either delete stacks/sections at start of `buildEventStacks` or use Inngest singleton/debounce key.
- [ ] `buildFaceStacks` and `buildBurstStacks`: idempotent. Delete existing stacks at start, OR upsert keyed on (event_id, person_id) and (event_id, burst_window_start).
- [ ] Fix the React state issue in `events/[eventId]/page.tsx`: `selection` in dependency array re-renders every render.
- [ ] Cover-rank swap in `/api/stacks/[stackId]/cover` becomes a single transaction (or CASE update).

**Acceptance:** Upload 500 photos to a test event. Every image lands in `ready` state with thumbnails generated. No fire-and-forget errors are silent. Sentry shows zero unhandled errors.

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

## Phase 3 — Make the Core Experience World Class [TODO]
**Goal:** UX consolidation. Pixeltrunk starts to feel premium.

### Navigation & structure
- [ ] Build a persistent global `<Nav />` with: logo · Events · Search · Analytics · Templates · Account · ⌘K · Sign Out. Replace 9 different per-page nav arrangements.
- [ ] Add ⌘K command palette entries for: Search, Analytics, Email Templates, Account.

### Sharing flow
- [ ] Single canonical share UI: keep `/events/[id]/share` as the full experience. Retire `ShareModal` or scope it strictly to "share this selection".
- [ ] Decouple photographer star/favorite from public client favorite. `F` in lightbox is a private organizational mark; public favorites only exist via the share viewer.
- [ ] Pre-publish checklist for shares: name set, cover set, password set-or-skipped, downloads reviewed, custom message. Today the share page dumps you into a compose form.

### Lightbox
- [ ] Photographer actions inside the lightbox: favorite (private), set-as-best (stack cover), add-to-section, delete.
- [ ] Keyboard-driven: `J/K` next/prev, `F` favorite, `D` delete, `S` set-as-best, `Esc` close, `I` info panel.
- [ ] Mobile: visible nav arrows + swipe support.
- [ ] Prefetch metadata for next image when info panel is open.

### Onboarding
- [ ] First-run modal on first dashboard visit if profile incomplete: display name, business name, optional logo, branding colors (3-step).
- [ ] Seed a demo event (30 stock photos, hand-organized) so the empty product has something tangible to click — solves the cold-start problem without AI.

### Account / billing
- [ ] Storage-quota meter on `/account` Billing tab: used vs plan limit, progress bar, link to upgrade.
- [ ] Subscription state visible regardless of `stripe_customer_id` existence.

### Search
- [ ] Deep-link search results to the specific image (open lightbox at that image), not the event top.
- [ ] Validate `/api/search` query (no commas/dots/parens that break PostgREST `.or()`).

### Downloads
- [ ] Bulk ZIP download: stream through R2 (no full in-memory buffer), single signed URL response, auth-gated.

### Misc
- [ ] Better empty states using the pixel-mosaic SVG ornament. Apply to dashboard, event-empty, search-empty, gallery-empty, no-favorites.

**Acceptance:** A new photographer can sign up, complete onboarding, upload a wedding shoot, organize into sections, send a password-protected share to a client, and see the client's favorites by name + email — all without hitting a 404 or a confusing state.

---

## Phase 4 — Aesthetic Refinement [TODO]
**Goal:** Editorial coherence. Make every page feel crafted.

### Typography
- [ ] Define a real type scale in `globals.css`: `display-xl/lg/md/sm`, three body sizes (lead 15, body 13, micro 11), one caption italic. Add as Tailwind plugin or `@layer utilities`.
- [ ] Replace `text-[15px]` / `text-[clamp(...)]` one-offs across the audited files.
- [ ] Unify H1 sizing across landing, dashboard, event, account, marketing, pricing.

### Color & components
- [ ] Retire all `BrandButton` colors except emerald (and stone-900 squared `Button variant="primary"`). One CTA color in the whole system. Move the rainbow into `/dev/buttons` reference.
- [ ] Stone-palette enforcement on analytics: stat cards, status pills, warning banners. No raw blue/orange/red in app surfaces.
- [ ] One `<Divider />` primitive replacing `editorial-divider` / inline borders / opacity rules. Applied across footer, marketing, gallery, event sections.
- [ ] Replace `SectionedGallery` rounded-full pill tabs with squared chips + bottom hairline rule.
- [ ] Re-style the Toast: 2px accent left-rule, italic emphasis on counts.

### Gallery & lightbox
- [ ] Selection feedback: dim unselected to 60% opacity rather than tinting selected emerald.
- [ ] SmartStack cover respects native aspect ratio (no forced `aspect-[3/4]`).
- [ ] Touch targets ≥44px on SmartStack and grid checkboxes.

### Brand moments
- [ ] Use the pixel-mosaic SVG (currently in gallery footer) as the ornament in: dashboard empty state, event empty state, lightbox loading placeholder, password gate, login/signup corner ornament.

**Acceptance:** Quick visual sweep of landing → signup → onboarding → dashboard → event → lightbox → share → public gallery feels like one coherent product. No "Tailwind starter" smells. Mobile parity confirmed.

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
