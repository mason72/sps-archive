# Importing an event from SPS — the pull contract

Written 2026-08-11 from the SPS side (`mason72/spsv2`, commit `baa2f6f`, live on
`admin2.simplephotoshare.com`). The SPS half is built, deployed and verified.
**Nothing in this document is planned — it all exists and answers today.** What
remains is the Pixeltrunk half described under "What to build".

## Why this exists

Mason wants finished SPS events to land in Pixeltrunk, and wants to stop the
two-pass shooting workflow (low-res at the event, high-res re-export afterwards
for archiving). For that, Pixeltrunk has to receive real camera files.

Two things were in the way, and both are now resolved:

1. **`import.ts` mints metadata rows and copies nothing.** Still true, still
   broken — an import must move bytes. See its header.
2. **"SPS re-compresses on ingest, so it is a lossy source."** *This was wrong.*
   SPS `f406ee7` (2026-05-05) added a passthrough branch: a JPEG upload with no
   test-mode watermark and no branding overlay is stored **byte-for-byte** as
   `original.jpg`. Verified by sha256 round-trip. The FoU26 frames that produced
   the 32–36% measurement were uploaded before that fix.

So for the common case, the good copy has been sitting in SPS all along.

## The model: two routes to archive quality

Do not try to infer quality. SPS states it per image. But understand why there
are two sources, because it explains the API:

| Route | SPS column | Lifetime |
|---|---|---|
| `original.jpg` **is** the camera file (passthrough fired) | `original_is_camera_file = true` | permanent |
| A separate `archive.jpg` was kept (passthrough could not fire) | `archive_saved_at` set | transient — released on pull, or after 30 days |

Passthrough covers most uploads at zero extra storage. The separate copy is
written only for test-mode events, branded events (12 of 192 as of writing), and
HEIC/PNG/WebP uploads.

> **CORRECTED 2026-08-11.** This paragraph used to end "— and, in future,
> anything the SPS desktop app downsizes because venue wifi was bad."
> **That is impossible and must not be built from.** The separate copy exists for
> images SPS *receives* whole and then re-encodes for display. If the desktop app
> downsized before uploading, SPS would never receive the camera file, so there
> would be nothing to keep — you cannot archive bytes that never arrived. Such an
> event would be permanently `lossy` with no recovery path.
>
> Two further facts, measured rather than assumed (2026-08-11): the desktop app
> does **no** downsizing today — it uploads the original verbatim ("no compression
> needed since we bypass Vercel") — and the booth's real demand is **under
> 1 Mbps** (2.3–3.2 uploads/min at ~2.4 MB across DAIS 26, HDC 2026 and Island
> HQ), which no venue connection fails to meet. Flakiness, not throughput, is the
> venue problem, and the desktop queue already answers it with retry, per-upload
> timeouts and bounded concurrency.
>
> If a venue ever does defeat that queue, the correct design is **fast lane +
> deferred original** — upload a small copy so guests aren't waiting, then the
> camera file in the background, with SPS marking the image archive-grade only
> once the original lands. Note what that is: an automated two-pass upload, i.e.
> the workflow this integration exists to eliminate, moved into the app. Worth
> building only against a real failure, never pre-emptively.

`quality` in the manifest already combines both. **Trust the field.** An image
reporting `archive` is a camera file regardless of which route produced it.

## Auth

Mason mints a token in SPS at **Settings → Pixeltrunk**. It looks like
`spsa_…`, is shown exactly once, and SPS stores only its sha256. Send it on
every request:

```
X-SPS-Archive-Token: spsa_...
```

Re-minting in SPS immediately invalidates the previous token. A revoked or
unknown token gets `401`; a valid token pointed at another host's event gets
`404` (not `403` — SPS deliberately refuses to confirm the event exists).

### Where the token lives here — NOT an env var

**This needs UI, and it is step 1 of the build.** SPS mints the token per user
(`archive_connections` is keyed by `user_id`), so Pixeltrunk must store it per
user too: a row in this database, entered by the photographer in
**Settings → Connections**. An env var would pin the entire install to one SPS
account, which holds only while Mason is the sole person connecting — and
Pixeltrunk is a multi-tenant product with real photographers on it.

Note the asymmetry, because it decides how carefully this is handled: SPS only
ever *verifies* the token, so it stores a sha256 and can afford to. Pixeltrunk
must *present* it on every request, so it has to retain the plaintext. That
makes this a stored credential — service-role-only table, RLS enabled with no
policies, never returned to the browser. Show a masked prefix (`spsa_AwOrxqN…`)
the way SPS's own settings panel does.

**Validate on save.** Take the pasted token, immediately call
`GET /events` with it, and show the photographer how many events came back.
The token is displayed exactly once on the SPS side, so a mistyped or truncated
paste that only surfaces at the first import is a genuinely bad experience — and
the failure would look like "the integration is broken" rather than "the paste
was short".

Until this screen exists there is nowhere to put a token, and any instruction to
paste one is pointing at nothing. SPS's own Settings card is gated off behind
`NEXT_PUBLIC_ENABLE_PIXELTRUNK` for exactly that reason; flip it on there once
this ships.

Base URL: `https://admin2.simplephotoshare.com/api/integrations/archive`

## Endpoints

### `GET /events`

Events available to pull. **Completed events only** — a live event is still
being shot, and importing it captures a partial take.

```json
{ "events": [
  { "id": "uuid", "name": "…", "slug": "…",
    "completedAt": "2026-08-01T…Z", "imageCount": 5902, "archiveEnabled": true }
]}
```

### `GET /events/{eventId}/manifest?offset=0`

Paginated, **500 images per page**. `nextOffset` is present only when more
remain; a short page is the terminator.

```json
{
  "event": { "id": "…", "name": "…", "slug": "…", "date": "…", "completedAt": "…",
             "imageCount": 5902, "archiveEnabled": true },
  "images": [
    { "id": "uuid",
      "originalFilename": "JohnSmith_0142.jpg",
      "width": 3200, "height": 4800,
      "mimeType": "image/jpeg",
      "capturedAt": "2026-08-01T…Z",
      "boothId": "uuid|null",
      "quality": "archive",
      "alreadyPulled": false,
      "url": "https://…"
    }
  ],
  "nextOffset": 500
}
```

Notes that will bite if ignored:

- **`url` expires in 1 hour.** For `quality: "archive"` backed by a separate
  copy it is a presigned R2 GET; otherwise it is the public `original.jpg`.
  Re-fetch the manifest page rather than holding URLs across a long import.
- **There is deliberately no `fileSize`.** SPS's `images.file_size` is the sum
  of all six variants, roughly 3× the object behind `url` — reporting it would
  hand you an authoritative-looking wrong number. Take the length from your own
  response.
- **AI copies are excluded** (rows with `source_image_id`). They are generated
  renders with no camera file behind them.
- Only `processing_status = 'ready'` images appear.
- `imageCount` on the event includes the excluded AI copies, so **never use it
  to decide whether the import is complete.** Page until `nextOffset` is absent.

### Scope: going forward only (decided by Mason, 2026-08-11)

**Do not build backfill of historical events into this.** The import is for
events completed from the connection onward. Older events can still be pulled by
hand if a specific need comes up, but the UI should not invite it.

Why it's the right default rather than a limitation:

- Pre-connection events have no separate archive copy — nothing was being kept —
  so they return `quality: "lossy"`. Offering them makes the common path deliver
  the worse copy.
- It's the FoU26 failure mode by another name. That backfill re-imported 35
  frames as degraded neighbours *and* four setup photos Mason had already
  deleted, because it treated everything present in SPS as something the archive
  was missing. A forward-only import never has to guess which.

One fact to keep in your back pocket rather than act on: images uploaded between
SPS `f406ee7` (2026-05-05) and `baa2f6f` (2026-08-11) very likely **are** camera
files — passthrough was live — but SPS wasn't recording provenance yet, so their
`original_is_camera_file` is `NULL` and the manifest honestly reports them
`lossy`. That's roughly three months of events whose originals are better than
the flag admits. It could be inferred retroactively from `mime_type`,
`is_watermarked` and the event's overlay setting, but `overlay_enabled` reflects
the event's state *now*, not at upload time, so the inference has a real failure
mode. For an archive, under-promising is the safe direction — leave them `lossy`
unless Mason asks for that window specifically.

### `POST /events/{eventId}/pulled`

```json
{ "imageIds": ["uuid", "…"] }   →   { "confirmed": 12 }
```

Max 500 ids per call. `confirmed` counts only rows that actually had a separate
archive copy to release — a passthrough image returns nothing to confirm, and
that is correct, not an error.

> **Ordering rule — the one that can lose data.** Confirm only after the bytes
> are **durable** on the Pixeltrunk side. This call is what makes SPS's copy
> eligible for immediate deletion. Confirming on receipt rather than on write
> gives you an archive that believes it holds a file it never persisted, with
> SPS's copy already gone. Confirm in batches as you drain, so a crash
> mid-import does not lose the confirmations already earned.

## Timing

SPS holds an unclaimed `archive.jpg` for **30 days** from upload, then releases
it and the image falls back to its `original.jpg`. Passthrough images are
unaffected — they stay archive-grade forever.

Practically: import within 30 days of an event completing and you get
everything. Later than that, images that needed a separate copy come back as
`quality: "lossy"`. Nothing breaks; you just receive the re-encode.

## What to build here

1. **Replace `import.ts`.** It must move bytes through Pixeltrunk's own presign
   + `/api/upload/reconcile` path, not mint rows pointing at foreign keys. The
   existing `scripts/backfill-sps-fou26.ts` is the working reference for the
   byte-moving half.
2. **Manifest client** — paginate, handle URL expiry, record `quality` on each
   imported row so a lossy import is visible later rather than silently mixed in
   with good frames.
3. **Import review UI — required, not polish.** The SPS gallery is the *live
   feed*: setup frames, test shots, calibration. The archive is the *curated*
   version. Show thumbnails, everything selected by default, let the
   photographer deselect. The FoU26 backfill re-imported four setup photos Mason
   had already deleted because it treated a curation gap as a data gap.
4. **Confirm via `/pulled`** after durable write, per the ordering rule above.

Watch the local hazards while doing it: `getAuthUser()` hands back the SERVICE
client, so every query needs an ownership filter (this shipped as an IDOR twice
— lessons #2 and #14); upload rows are presign-created before their binary
exists, so every new exit path must clean up or you get ghost tiles (lessons
#21–23).

## Verification worth repeating

The SPS side was proven by sha256, not by inspection. Do the same here: import
one event, pull one `quality: "archive"` image, and confirm the bytes you stored
hash identically to what SPS served. That single check is what caught the stale
lossy-source claim in the first place.
