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

## Phase 0 — Stop the Bleeding [TODO]
**Goal:** Close every P0 security gap and the upload/processing race. Single commit. May invalidate active gallery cookies and force one-time password re-entry (acceptable per owner — few real users).

### Auth architecture refactor
- [ ] Refactor `src/lib/auth/helpers.ts` `getAuthUser()` to return `{ user, supabase }` where `supabase` is the **cookie-bound RLS client**. Add a separate named `getServiceClient()` for Stripe webhook, thumbnails, Inngest worker.
- [ ] Audit every route under `src/app/api/` for service-client usage. Routes that need service-role privilege must use the new named import; everything else gets the RLS-bound client.

### IDOR sweep (add `user_id` filter or join through events)
- [ ] `GET /api/events/[eventId]/route.ts`
- [ ] `GET /api/images/[imageId]/route.ts`
- [ ] `POST /api/images/batch/route.ts`
- [ ] `GET /api/search/route.ts` (filter by `event_id IN (SELECT id FROM events WHERE user_id = $userId)`; update `search_images_by_embedding` RPC to require event IDs)
- [ ] `GET/POST /api/shares/route.ts`
- [ ] `PUT/DELETE /api/shares/[shareId]/route.ts`
- [ ] `POST /api/stacks/[stackId]/cover/route.ts`
- [ ] `GET /api/events/[eventId]/favorites/route.ts`
- [ ] `POST /api/sections/[sectionId]/images/route.ts` (validate every imageId belongs to user)
- [ ] `POST /api/upload/route.ts` (validate eventId + sectionId ownership)
- [ ] All `POST /api/events/[eventId]/*` and `GET /api/events/[eventId]/*` companion routes (processing-status, retry-processing, duplicate, share-readiness, emails)

### Authenticate `/api/upload/complete`
- [ ] Require auth + verify image's parent event belongs to user
- [ ] Set status to `pending` (not `complete`) — Inngest owns processing-state transitions

### Share-system hardening
- [ ] Drop the `"Anyone can read active shares"` RLS policy. Replace with `SECURITY DEFINER` RPC `resolve_share_by_slug(slug)` that returns only safe columns (id, share_type, event_id, public flags) and never `password_hash` or `download_pin`.
- [ ] Drop `"Anyone can view favorites"` and `"Anyone can delete own favorites"` RLS policies. Route all favorite reads/deletes through the API.
- [ ] Replace gallery cookie auth (`gallery_auth_${slug} = share.id`) with HMAC-signed token bound to slug + expiry. Cookie value never exposes the share ID.
- [ ] Branch `/api/gallery/[slug]` and `/api/gallery/[slug]/download` on `share_type`: `section` joins via `section_images`; `person` joins via faces.
- [ ] Gate `originalUrl` behind `allow_download` and `require_pin_individual`. Map `download_quality` → thumbnail tier server-side.
- [ ] Re-hash all existing share passwords with PBKDF2 (≥600k iters) or Argon2id. Migration that nulls old hashes — affected shares get one-time email asking photographer to reset.
- [ ] `crypto.timingSafeEqual` on PIN and password compares.
- [ ] Move PIN out of URL query string into POST body / signed cookie.
- [ ] Rate-limit verify, verify-pin, signup, forgot-password (in-memory LRU; Upstash Redis later).
- [ ] OG image route: when `share.password_hash` is set, return a generic OG card (no cover, no couple's name).

### SPS integration tightening
- [ ] `crypto.timingSafeEqual` on API key compare.
- [ ] `/api/sps/import`: validate every `r2Key` is prefixed with an SPS event the calling user owns; ideally accept SPS image IDs and resolve r2Keys server-side from a trusted SPS reference.
- [ ] Cap import payload size (≤5000 images per request).

### Stripe hardening
- [ ] New migration `012_subscriptions.sql` with explicit RLS + service-role policy.
- [ ] New `stripe_events(event_id PK)` table; webhook handler dedupes by event.id.
- [ ] Allow-list price IDs against env-configured set; refuse unknown (no `|| "pro"` fallback).
- [ ] Webhook returns 500 on handler error (let Stripe retry).
- [ ] Resolve user from `customer` → `subscriptions.stripe_customer_id`, not `metadata.supabase_user_id` blind trust.

### Open-redirect / SSRF fixes
- [ ] `forgot-password`: use `NEXT_PUBLIC_APP_URL` only, refuse if unset.
- [ ] `login?redirect=`: only accept paths starting with `/` (reject `//`).
- [ ] `auth/callback?next=`: same rule.

### Misc
- [ ] Reject SVG logo uploads (or sanitize via DOMPurify + serve with `Content-Disposition: attachment` and strict CSP).
- [ ] Add CSP header to `next.config.ts`.
- [ ] HTML-escape `fullName` in admin signup notification email.
- [ ] Whitelist mime types in `/api/upload` (`image/jpeg|png|webp|heic`).
- [ ] Lock `Image` remotePatterns to specific R2 hostname, not wildcard.
- [ ] Restrict `/api/admin/batch-thumbnails` to env-configured admin emails.
- [ ] Fix `/api/stats` query (`shares.user_id` column doesn't exist — join through events).
- [ ] Move `/dev`, `/playground`, `/mockups` behind `NODE_ENV === "development"` (currently `/playground` leaks one event's photos to every logged-in user).

**Acceptance:** Run a manual IDOR test from User-B's session against User-A's event/image/share/stack/section UUIDs — every endpoint returns 404 or 403.

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
