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

## Review thumbnails — RESOLVED 2026-08-11

The manifest originally returned only `url`, the full original, which made a
6,000-photo review grid ~30 GB of client egress — unrenderable, and a review step
that can't render is a review step that gets skipped.

Mason approved adding it to SPS. `spsv2 d19b118` now sends
`thumbUrl: thumbnail_url ?? medium_url` (200px, else 1200px) — both variants
already existed and are already public, so it cost nothing. Deployed to
admin2.simplephotoshare.com. The grid resolves `previewUrl = thumbUrl || url` in
the manifest proxy, so a row with no variant still renders (from the original)
and the UI says why scrolling is slow. No Pixeltrunk-side resize proxy was
needed.

## Proven at scale — DAIS 26, 2026-08-11

**9,104 photos · 21.7 GB · zero failures · 218 minutes.** Both multi-run handoffs
fired (4,000 and 8,000) and resumed at exactly the right offset; an 8-image
sha256 sample came back byte-identical. Throughput was flat at 0.70 photos/sec
across every event imported, regardless of file size — the cost is per-photo
sharp thumbnailing, not bandwidth, which is the number to plan against.

One frame of 9,104 lost its thumbnail to a transient R2 error and behaved as
designed: bytes safe, row complete, AI pipeline unblocked, self-healing on view.
Notably the alert named the failure instead of `[object Object]` — that fix
landed hours earlier and paid for itself on its first real fault.

Deselection verified separately on eBay Intern Photo Booth: 199 captures, 4
unchecked, 195 imported, and **none of the four leaked in**. SPS was told about
exactly the 195 that landed.

## State — 2026-08-11

**Shipped and verified live.** Pixeltrunk `70b0774` on app.pixeltrunk.com (all
six `/api/sps/*` routes present in the production build log, `/api/sps/import`
absent); spsv2 `d19b118` on admin2 (archive API answers 401 to a bad token);
migration 046 applied to production and columns confirmed; 434 tests pass;
`next build` clean.

`NEXT_PUBLIC_ENABLE_PIXELTRUNK=true` is set on sps-admin production and the app
was redeployed afterwards — a `NEXT_PUBLIC_*` var is inlined at build time, so
setting it without a redeploy would have left the Connect card invisible while
looking configured.

**Open, and needs Mason:** mint a token in SPS (Settings → Pixeltrunk) and paste
it at app.pixeltrunk.com/settings/connections. Entering a credential into a form
is his to do, not the agent's. Then the spec's required proof can run:

```bash
npx tsx scripts/verify-sps-pull.ts <archiveEventId>
```

Until a real import has run, the byte-moving path has been proven by build,
types, unit tests and inspection — **not** by a sha256 round-trip against a real
SPS event, which is the only evidence that counts for the quality claim.
