# SPS → Pixeltrunk pull: build plan

Written 2026-08-11. Contract: `tasks/sps-archive-pull-spec.md` (authoritative —
read it first). This file is the Pixeltrunk-side build order and the design
decisions behind it.

Verified against the SPS source while planning (`spsv2` @ `2855f4c`), not just
the spec:

- The four endpoints exist at `apps/admin/src/app/api/integrations/archive/`.
- SPS's own Settings card is gated off behind `NEXT_PUBLIC_ENABLE_PIXELTRUNK`
  (`ab7f839`) because minting a key with nowhere to paste it reads as a
  finished flow and silently isn't. **So there is no token to test with until
  that flag is flipped** — the connection screen here ships first, then the flag.
- The manifest carries **no thumbnail URL** — only `url`, the full original.
  This is the one thing the contract is missing; see "Review thumbnails" below.

## Order of work

### 0. Connection screen — `/settings/connections`

Spec `e3282fd` decided this: per-user row in this DB, not an env var, because
SPS mints per `user_id` and an env var pins the whole install to one SPS account.

- **Migration 046** — `sps_connections`: `user_id` PK → `auth.users`, `token`
  (plaintext, unavoidable: we must *present* it on every request), `token_prefix`,
  `connected_at`, `last_pull_at`, `revoked_at`. RLS enabled, **no policies** —
  service-role only, so a leaked anon key reads nothing.
- `POST /api/sps/connection` — accepts the pasted token, **validates by calling
  `GET /events` before storing**, returns `{ eventCount, tokenPrefix }`. A
  truncated paste must fail at the paste, not at the first import.
- `GET` returns `{ connected, tokenPrefix, connectedAt, lastPullAt }`. Never the
  token. `DELETE` revokes.
- Reader `getSpsToken(userId)` in `src/lib/sps-integration/connection.ts` is the
  only thing that touches the plaintext column, and it is server-only.
- UI: masked prefix, "Connected · N events available", re-paste to replace.
  Linked from `/account` beside Email settings.

Credential hygiene: the token never enters a log line, an error body, a
`system_errors` detail blob, or an argv. `reportSystemError` details get the
event id and the HTTP status, never the header.

### 1. Manifest client — `src/lib/sps-integration/pull-client.ts`

Typed, thin, page-driven:

- `listEvents(token)`, `fetchManifestPage(token, eventId, offset)`,
  `confirmPulled(token, eventId, imageIds)` (chunked at 500).
- Pages until `nextOffset` is absent. **Never `event.imageCount`** — it counts
  the AI copies the manifest excludes.
- Maps status honestly: 401 → "token rejected, re-paste", 404 → "not this
  account's event", 5xx → retryable.
- URLs are used within seconds of the page that produced them (see below), so
  there is no URL cache to expire.

### 2. Byte mover — `src/lib/sps-integration/pull-event.ts` + Inngest lane

Replaces `importFromSPS`. **Driven by manifest page, not by a flat id list** —
that single choice solves URL expiry (URLs are always minutes old), gives free
resumability (`next_offset` on the job row), and needs no id→URL bookkeeping.

Per image, ordered so a failure can never leave a ghost tile:

1. `fetch(url)` → buffer. Reject non-`image/*`, reject < 1KB.
2. `uploadToR2(buildImageKey(eventId, `${id}.${ext}`), buffer, mime)` — **bytes
   before row**. A row without an object is a ghost tile; an object without a row
   is invisible garbage, and we delete it on the failure path anyway.
3. Insert the `images` row (`processing_status: "pending"`), carrying
   `sps_image_id`, `sps_quality`, `file_size` = *our* byte length (SPS
   deliberately doesn't report one — its `file_size` sums six variants).
4. `section_images` link — no orphans, ever. Roll back row + object if it fails.
5. Thumbnails from the buffer we already hold + EXIF, then flip to `complete`.
   Same work `/api/upload/complete` does, minus a second download of the file.

Then per page: `POST /pulled` with the ids whose bytes are durable, and stamp
`images.sps_pulled_at`. **Confirm after durability, in page-sized batches** — a
crash keeps the confirmations already earned, and an unconfirmed image just
keeps its SPS copy for the rest of the 30 days.

Deliberate deviation from the spec's wording: the spec says "through Pixeltrunk's
own presign + `/api/upload/reconcile` path". Presign exists so a *browser* can
reach R2 without passing bytes through Vercel — and it is the reason rows exist
before their binaries. Server-side we already hold the buffer, so presigning
would add a round trip *and* re-create the ghost-row window that reconcile was
built to clean up. We keep every invariant the upload lane enforces (key layout,
section link, duplicate identity, thumbnails, settlement events) and skip the
window. `scripts/backfill-sps-fou26.ts` already proved this shape.

**Where it runs:** Inngest `sps/pull.requested`, one step per chunk of ~60
images (6-way concurrency inside a step, ~30–60s), self-continuing via
`step.sendEvent` after ~40 chunks so run state stays bounded on a 6,000-photo
event. `sps_pull_jobs` row holds `status`, `next_offset`, `expected_total`,
`images_done`, `images_failed`, `bytes_copied`, `confirmed`, `failures` (capped),
so the UI polls one row and a resume is a re-trigger with the same `jobId`.

Cost/time to state out loud before Mason runs it on a real event: a
6,000-frame event is ~30 GB moved, roughly 1–2 hours wall clock, and about
$0.45/month of added R2 storage.

### 3. Review UI — `/events/import`

1. Event list: completed SPS events, newest first, with "already imported" marked
   (we hold `spsEventId` in `events.settings` — one key, one home, via
   `readSpsEventId`).
2. Review grid: manifest pages loaded lazily, thumbnails, `quality` badge on
   anything `lossy`, `alreadyPulled` marked.
3. **Selection is an exclusion set.** Everything is selected by default, the
   photographer deselects; the client sends only the deselected ids. The import
   therefore never depends on how far he scrolled, and the server re-pages the
   manifest itself to decide what "everything" means — the client's list is a
   view, never the authority.
4. Import → creates the event (linked via `spsEventLinkPatch`), lands photos in
   the `Unsorted` intake section (never `Highlights` — that's the curated
   best-of), starts the job, then shows live progress.

### 4. Verification — `scripts/verify-sps-pull.ts`

The spec's required check, as a repeatable script: take an imported image with
`sps_quality = 'archive'`, fetch a fresh manifest URL, sha256 both sides, assert
equal. Plus vitest coverage for pagination termination, the exclusion-set math,
and the rollback paths.

### 5. Delete the zero-copy push lane

`importFromSPS`, `POST /api/sps/import`, the `event/imported` event and
`processImportedEvent` (nothing else sends it; `retry-processing` already fans
out `image/uploaded` directly). Nothing in `spsv2` calls the push route —
checked. Leaving a live endpoint that mints unreadable rows is worse than
deleting it. `generateEnhancements` stays.

## Schema (migration 046)

- `images.sps_image_id uuid`, `images.sps_quality text` check
  `('archive','lossy')`, `images.sps_pulled_at timestamptz`.
- `unique (event_id, sps_image_id) where sps_image_id is not null` — DB-level
  idempotency, so a double-run or a resumed job cannot duplicate a frame.
- `sps_connections`, `sps_pull_jobs` as above.

Provenance lives on the image, not on the job: it must outlive the import, it is
what makes a lossy frame findable later, and it is the idempotency key.

## Open question

**Review thumbnails.** The manifest returns only `url` — the full original. A
6,000-photo review grid at full res is ~30 GB of client egress, so it can't be
rendered directly. SPS already stores a 200px `thumbnail_url` and a 1200px
`medium_url` per image (`packages`/`images` schema, `IMAGE_SIZES`), so exposing
one is ~2 lines in the manifest route. Until that lands, the fallback is a
Pixeltrunk-side proxy that downloads the original server-side and resizes —
correct, but it pulls the whole event through Vercel just to draw the grid.
The client will prefer `image.thumbUrl` and fall back to the proxy, so the UI
ships either way and gets fast when the field appears.
