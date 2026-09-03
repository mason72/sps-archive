# Site Integration — Public Marketing Lane (v2: the "TDP Website" gallery)

How the **Two Dudes Photo** marketing website pulls curated imagery the team
manages inside Pixeltrunk — without ever exposing private client galleries.

> **v2 (2026-06-09).** The v1 per-image `site_scene` tag model was retired —
> tags were write-easy but read-impossible ("can't backtrace what's assigned
> where"). The site is now **one dedicated gallery whose sections ARE the
> site**: open the TDP Website gallery and you see the entire site's imagery,
> organized by where it appears. **Membership = publication.** The site-facing
> API contract is unchanged (plus `focalX`/`focalY`).

## Mental model: two lanes

| | Private client galleries | Public marketing lane |
|---|---|---|
| Bucket | `sps-prism` (private) | `sps-public` (public) |
| URLs | Per-request **presigned**, 4h expiry | **Public, non-expiring** via `R2_PUBLIC_LANE_URL` |
| Who sees it | Anyone with the share slug | Anyone (it's a public website) |
| What's in it | Every client's photos | **Only** images in a TDP Website gallery section |

The two lanes are independent. Client-gallery sharing (permanent slug links +
presigned image URLs) is unchanged. An image becomes publicly reachable **only**
when a team member adds it to a section of the website gallery — at which point
its display and thumbnail variants are copied into `sps-public` and
`site_published_at` is stamped. Remove it from its last website section and the
public copies are deleted. Deleting the image outright also cleans up its
public copies.

We never publish the raw full-resolution original to the public bucket — only
the `thumb-md` (400px) and the display variant (the web-viewable original for
JPEG/PNG, or the 800px `thumb-lg` for non-web formats like TIFF).

## The TDP Website gallery

A regular Pixeltrunk event (slug `tdp-website`, `settings.website = true`)
whose sections are the site's content slots. Each website section carries a
`sections.site_scene_key` matching the registry in
[`src/lib/site/scenes.ts`](../src/lib/site/scenes.ts) — the single source of
truth. The gallery and any missing sections are scaffolded automatically on
first use; **adding a scene is a one-line registry change, no migration**
(coordinate with the website's `src/lib/scenes.ts`).

Sections hold **references to the original images in their source events**
(cross-event membership, zero copies). That source pointer is what powers
Featured Work captions: `event` name and `city` come from the image's home
event.

### Three kinds of section

- **Pool** (rotating grids): the site gets the whole curated set and
  rotates/selects on its own. Ordering: `featured` first, then the section's
  drag order, then newest.
- **Ordered** (position-mapped sets — benefits strips, story, about, quote):
  image N fills position N on the page, so the API returns **exact drag
  order** — no featured boost, no rotation. The registry's `positions` says
  how many the page uses; the editor hints when a section holds extras.
- **Slot** (`slot/*` — explicit single-image positions): the **first image by
  drag order wins** and is the only one the API returns. Extras are ignored
  (the editor shows a hint when a slot section holds more than one image).

### Scene keys

| Key | Kind | Implied `service` |
|---|---|---|
| `hero` | pool | — |
| `featured-work` | pool | — |
| `backgrounds` | pool | — |
| `service/headshot-booth` | pool | `headshot-booth` |
| `service/photo-booth` | pool | `photo-booth` |
| `photo-booth/overhead` | pool | `photo-booth` |
| `photo-booth/bw-glam` | pool | `photo-booth` |
| `photo-booth/custom-sets` | pool | `photo-booth` |
| `service/anti-booth` | pool | `anti-booth` |
| `service/event-photography` | pool | `event-photography` |
| `service/video` | pool | `video` |
| `service/environmental-portraits` | pool | `environmental-portraits` |
| `service/office-headshots` | pool | `office-headshots` |
| `service/drop-in-sessions` | pool | `drop-in-sessions` |
| `slot/slice-1` … `slot/slice-6` | slot | the slice's service |
| `slot/hero/{service-slug}` (all 8 services) | slot | that service |
| `benefits/{service-slug}` (7 services, no environmental-portraits) | ordered ×6 | that service |
| `how-it-works` | ordered ×3 | `headshot-booth` |
| `story` | ordered ×3 | — |
| `about-values` | ordered ×4 | — |
| `quote` | ordered ×2 | — |

## Team workflow

1. Work inside the TDP Website gallery: upload (or copy) images in, then the
   normal section tools (copy/move, drag to reorder) maintain publication
   automatically. Drag order is the site's display order; in slot sections
   the first image is THE image.
2. **Delete follows the "copies" model** (one button, no separate
   remove-from-section gesture): with a section open, deleting a photo that
   also lives in other sections only removes THIS section's copy — in a
   website section that takes it off the site (public copies cleaned up,
   original untouched in its source event). Deleting a photo's LAST copy
   deletes the photo itself. In "All Images" delete is always permanent. The
   confirm step states which applies; the toast reports what happened.
   There is no separate website gesture anymore (the v1 globe tag picker and
   its v2 "remove from website" successor are both retired;
   `POST`/`DELETE /api/site/gallery` remain for programmatic use).
3. **Focal point** (any website section): select a single image → crosshair
   icon in the toolbar → click the subject → Save. The site maps it to CSS
   `object-position` and crops focal-aware everywhere (hero, story, values,
   benefits, quote — not just slots), so set it on anything that will be
   cropped tight. When face detection finds a single confident subject, the
   marker is pre-placed at eye level — saving is one click. (Face-based
   AUTO-fill on add remains slot-only.)
4. **Website details** (captions/ordering metadata): select image(s) in the
   TDP Website gallery or any website section → captions icon in the toolbar
   → edit source-event name + city (event-level — applies to every photo from
   that event), service, and the featured flag. Multi-select applies
   service/featured to all selected; when the selection spans several source
   events, city can be set for all of them at once.

**Section locks**: any section can be locked (toggle in the sidebar row) as a
soft guard against inadvertent edits — locked sections reject membership
changes, reordering, uploads, section deletion, and hard-deletes of their
member images (HTTP 423 with the section name; enforced server-side in every
mutation route, surfaced as toasts/banners in the editor). Not security — one
click unlocks; the point is that editing becomes deliberate. `sections.locked`,
migration 021.

Defaults keep editing rare: `images.service` auto-fills from the scene on add,
and images added to a **slot** section with no focal point get one auto-filled
from face detection (exactly one confident face → eye-level point; written
into null only, never over a manual pick or deliberate clear). Slot tiles show
a small crosshair badge when their focal point is set.

Edits go live on their own: every website-gallery mutation (membership,
reorder, metadata, focal) pings the site's revalidate webhook (trailing 4s
debounce, after the public-bucket copy completes), and the site refetches
within ~60s. Configured via `TDP_SITE_REVALIDATE_URL` +
`TDP_SITE_REVALIDATE_SECRET` (unset = silently skipped, e.g. dev). Mutations
in client galleries never ping — the gate is website-section membership
(`site_published_at` / `site_scene_key`) at each call site.

Curation metadata:

- `sections.site_scene_key` — which scene a website section feeds
- `section_images.sort_order` — display order (drag in the editor)
- `images.service` — auto-filled from the scene's implied service on add
  (never overwrites a manual value); read-time fallback uses the scene's
  implied service for captions
- `images.featured` — featured images sort first in pool scenes
- `images.focal_x` / `focal_y` — focal point, 0–100 percentages (null = unset)
- `images.site_published_at` — when public variants were last copied
  (null = not in the lane); the API only serves stamped images
- `events.city` — read per-image via the image's **source** event
- `images.site_scene` — **deprecated** (v1); ignored by app code, kept as an
  audit trail until a future drop

## Site-facing API

### `GET /api/site/scene/{key}`

Returns the curated images for a scene with **public, non-expiring** URLs.
Catch-all path, so namespaced keys work directly:
`/api/site/scene/slot/hero/photo-booth`.

**Auth:** shared secret header.

```
X-SPS-Key: <SPS_INTEGRATION_KEY>
```

**Ordering:** pools — `featured` desc, then drag order, then newest first.
Slots — drag order only, and only the winning image is returned (`count` ≤ 1).

**Response** (v1 shape + `focalX`/`focalY`):

```jsonc
{
  "scene": "service/photo-booth",
  "count": 12,
  "images": [
    {
      "id": "uuid",
      "event": "Acme Holiday Party",   // source event name (caption)
      "city": "Boston",                // source event city (caption)
      "service": "photo-booth",
      "featured": true,
      "width": 4000,
      "height": 6000,
      "thumbUrl": "https://<public-lane>/events/<id>/thumbnails/thumb-md/<file>.jpg",
      "fullUrl": "https://<public-lane>/events/<id>/originals/<file>.jpg",
      "focalX": 33.3,                  // 0-100 % or null — CSS object-position
      "focalY": 25
    }
  ]
}
```

The response is cacheable by the authenticated consumer only
(`Cache-Control: private, max-age=300`). It must never be `public` /
`s-maxage`: shared caches (Vercel's edge CDN) don't key on `X-SPS-Key`, so a
shared-cacheable 200 would be served to unauthenticated requests, silently
bypassing the 401 contract.

**Example:**

```bash
curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" \
  https://app.pixeltrunk.com/api/site/scene/service/photo-booth
```

Each returned `thumbUrl` / `fullUrl` must `200` with **no** auth header and must
not expire.

### `GET /api/site/jobs`

The website's Featured Work is job-based: each tile is a job that opens an
infosheet ("job sheet") with project data and quote CTAs. Jobs live in a
second dedicated gallery, **TDP Work** (slug `tdp-work`,
`settings.work = true`, scaffolded by migration 022), where **each section is
one job**: its images are the job's gallery, the **first image by drag order
is the cover**, and section order is the order jobs lead on the site.

Job sections carry `site_scene_key = "job/<slug>"` — same column as scenes, so
the whole public lane applies unchanged: membership = publication (public
copies on add, deletion on remove), the focal tool, section locks, and the
revalidate webhook all just work. The slug is **frozen at creation** (derived
from the section name) so renaming a job never moves its site URL; the job
form can still edit the slug deliberately (uniqueness enforced, 409 on
collision).

Job metadata is one editor form per job, stored as `sections.job_meta`
(jsonb), validated by [`src/lib/site/jobs.ts`](../src/lib/site/jobs.ts) —
the single source of truth shared by the form, the PATCH route, and the API.
Fields: `client`, `anonymize` + `alias`, `eventName`, `city`, `venue`,
`services` (multi-select of the site's 7 service slugs — note this is NOT
`SITE_SERVICES`, which includes the non-bookable environmental-portraits),
`eventSize` / `duration` / `teams` / `ballpark` / `industry`
(+ `industryOther` when "other") / `year` as enums mirroring the website's
`src/lib/jobs.ts`, and `touchups` (hair + makeup artists on site — a plain
checkbox; always serialized as a boolean, false when unset, and the site
shows a TOUCHUPS spec row when true).

**Anonymity contract:** when `anonymize` is true the API returns the `alias`
and a **null `client`** — the client name never leaves the server (enforced
in one place, `serializeJob`). When false, `alias` is null (the site renders
`alias ?? client`).

**Draft state:** a job missing required fields (client — or alias when
anonymized —, city, ≥1 service, event size, duration, teams, industry) or
without a published image is **omitted** from the API. The editor shows a
live/draft dot on the section row and a status banner with the exact missing
fields; the form footer says the same.

Auth, caching, and image shape are identical to the scene API:

```bash
curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" https://app.pixeltrunk.com/api/site/jobs
```

```jsonc
{
  "count": 1,
  "jobs": [{
    "slug": "servicenow-knowledge-25",
    "client": "ServiceNow",          // null when anonymized
    "alias": null,                    // set only when anonymized
    "eventName": "Knowledge 25", "city": "Las Vegas", "venue": "MGM Grand",
    "services": ["headshot-booth", "event-photography"],
    "eventSize": "2000-10000", "duration": "2-3-days", "teams": "3",
    "ballpark": "24-48k",             // null = row hidden on the site
    "industry": "tech", "industryOther": null, "year": 2025,
    "touchups": true,                 // never null — false when unset
    "images": [ /* scene-shaped: id, event, city, service, featured,
                   width, height, thumbUrl, fullUrl, focalX, focalY —
                   first image = cover */ ]
  }]
}
```

The webhook fires on every job mutation: metadata/slug saves (sections
PATCH), membership and image-order changes (the standard publication sync),
and job reordering (`PUT /api/sections/reorder` pings only for the work
gallery). Mutations in client galleries still never ping.
`/api/site/scene/featured-work` is untouched — the site falls back to it
until jobs exist.

Editor affordances in the TDP Work gallery: the sidebar input reads "New
job…" and creating one opens the job form immediately; the form prefills
city/year from the job's own photos (source-event city, EXIF capture year)
and suggests industry + an anonymized alias for well-known brands (a small
curated map; composed from size + industry otherwise); the first tile shows
a "Cover" chip.

### Team-facing: `POST` / `DELETE` / `GET /api/site/gallery`

Programmatic curation (logged-in users only — no UI uses these anymore).
`POST {sceneKey, imageIds}` adds to a scene's section and publishes;
`DELETE {imageIds}` removes from every website section and unpublishes;
`GET` returns the gallery's event id.

## Video

Videos ride the same model as images — one library, one membership-is-
publication lifecycle, the same locks/focal/revalidate machinery — with two
publishing lanes chosen automatically at publish time:

| Lane | Which videos | What's published | Playback |
|---|---|---|---|
| **R2 public lane** (`kind: "video"`) | ≤ 60s AND muted (loops) | poster `thumb-md`/`thumb-lg` + the web-playable mp4 | `videoUrl` = public mp4 |
| **Cloudflare Stream** (`kind: "stream"`) | > 60s OR sound-on (showcase reels w/ voiceover) | posters via R2; the video is ingested into Stream on first publish (`stream_uid`) | `videoUrl` = HLS manifest, `iframeUrl` = hosted player |

**Upload → poster pipeline.** The uploader accepts MP4/MOV (H.264, AAC-or-
silent audio) up to 500 MB. On upload-complete an Inngest job
(`video/uploaded`) calls the Modal ffmpeg function
(`modal/video_pipeline.py`), which ffprobes the original (duration,
rotation-aware dimensions, audio presence, codec validation) and writes the
poster into the **normal thumbnail key scheme**
(`events/{id}/thumbnails/{variant}/{file}.jpg`) — so `thumbnail_generated`
keeps gating display and publication for both media types. `.mov` originals
also get a lossless `-c copy` remux to `events/{id}/video/{file}.mp4`
(Firefox won't play QuickTime containers). Unsupported codecs politely fail
the row (`processing_status: failed` + human-readable `processing_error`).

**Stream lifecycle.** Stream ingestion happens at *publish* time (membership
sync), so only website videos cost Stream minutes; unpublishing deletes the
Stream copy and clears `stream_uid`, symmetric with the R2 lane. If Stream
env vars are missing, publishing a stream-lane video fails loudly (and is
retried by the next sync) rather than silently serving a 400 MB mp4.

**API shape.** Scene + jobs entries gain — image entries are unchanged, with
inert nulls:

```jsonc
{
  // ...existing image fields; for videos fullUrl = large poster (always <img>-safe)
  "kind": "stream",          // "image" | "video" | "stream"
  "duration": 182.5,         // seconds, null for images
  "posterUrl": "https://<public-lane>/events/<id>/thumbnails/thumb-lg/<file>.jpg",
  "videoUrl": "https://customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8",
  "iframeUrl": "https://customer-<code>.cloudflarestream.com/<uid>/iframe",  // stream only
  "streamUid": "<uid>"       // stream only
}
```

**One-time setup (human):**

1. `modal secret create video-pipeline VIDEO_PIPELINE_KEY=<random>` then
   `modal deploy modal/video_pipeline.py` → set the printed endpoint URL as
   `VIDEO_PIPELINE_URL` (+ the same secret as `VIDEO_PIPELINE_KEY`).
2. Enable Cloudflare Stream on the account (the $5/mo tier covers 1,000
   minutes stored). Create an API token with **Stream:Edit** →
   `CLOUDFLARE_STREAM_API_TOKEN`. The customer code (the `customer-XXXX`
   playback subdomain, shown on any Stream video page) →
   `CLOUDFLARE_STREAM_CUSTOMER_CODE`.

## Environment variables

Add to `.env.local` and Vercel (the `.env.example` is git-protected — copy these
lines in manually):

```bash
# Public marketing lane (SEPARATE public bucket — curated website imagery only).
# The account-wide R2 token must have read on sps-prism + write on sps-public.
R2_PUBLIC_BUCKET_NAME=sps-public
# Public base URL for sps-public (non-expiring). Currently the r2.dev dev URL;
# swap for a custom domain later (e.g. https://cdn.pixeltrunk.com) with no code change.
R2_PUBLIC_LANE_URL=https://pub-d26e68845d7742259c52f68cbb95e72e.r2.dev

# Video: poster/probe pipeline (Modal) — see "Video" above.
VIDEO_PIPELINE_URL=https://<workspace>--sps-archive-video-process-video.modal.run
VIDEO_PIPELINE_KEY=<same value as the Modal video-pipeline secret>

# Focal suggestions: on-demand face detection (modal deploy modal/face_pipeline.py).
# Shares VIDEO_PIPELINE_KEY. Used by POST /api/sections/[id]/suggest-focal — the
# editor's bulk "Suggest all" — which detects + persists faces for images the
# shelved AI pipeline never scanned.
FACE_PIPELINE_URL=https://<workspace>--sps-archive-faces-detect-faces.modal.run

# Video: Cloudflare Stream (long / sound-on videos). Account id falls back to
# R2_ACCOUNT_ID (same Cloudflare account), so only these two are required:
CLOUDFLARE_STREAM_API_TOKEN=<token with Stream:Edit>
CLOUDFLARE_STREAM_CUSTOMER_CODE=<customer-subdomain code>
```

`SPS_INTEGRATION_KEY` already exists and is reused as the site API secret.

## One-time Cloudflare setup (human, dashboard)

Done for launch (account `aa3ce5fa7edd5346e777d23a4c34fe17`): `sps-public`
bucket ✅, r2.dev public URL ✅, R2 token broadened to both buckets ✅, Vercel
env vars ✅. To upgrade to `cdn.pixeltrunk.com` later: add the zone to
Cloudflare, connect it as a Custom Domain on the bucket, and update
`R2_PUBLIC_LANE_URL` — no code change. (r2.dev is rate-limited; fine for
launch, revisit for high traffic.)

## Verifying end to end (v2)

1. Apply `supabase/migrations/020_website_gallery.sql` to the live project
   (hfusdrtrizabzzcdhnyy). It adds `sections.site_scene_key` +
   `images.focal_x/focal_y`, scaffolds the TDP Website gallery, and migrates
   all v1 `site_scene` tags into section membership (publication state is
   preserved — already-published images stay live with no R2 churn).
2. In the app, copy an image into a TDP Website gallery section (e.g. **Photo
   Booth**) via the section tools, or `POST /api/site/gallery`.
3. `curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" .../api/site/scene/service/photo-booth`
   → expect the image, with source event/city and `focalX/focalY: null`.
4. `curl -I` a returned `fullUrl` → `HTTP 200`, no auth.
5. Set a focal point on a slot image (slot section → select → crosshair) →
   re-curl that `slot/*` scene → `focalX`/`focalY` populated, `count: 1`.
6. Remove the image from its website section(s) → re-curl → gone, and the
   `fullUrl` from step 4 now `404`s.

## Verifying jobs end to end

1. Apply `supabase/migrations/022_jobs_gallery.sql` (adds `sections.job_meta`,
   scaffolds the TDP Work gallery).
2. Open TDP Work, type a job name into "New job…" — the job form opens; fill
   the required fields and Save (footer reports live/missing state).
3. Add photos to the job section; drag your cover to position 1.
4. `curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" .../api/site/jobs` → the job,
   cover first, public URLs that `200` without auth.
5. Toggle Anonymize (alias suggested) and Save → re-curl → `client: null`,
   alias present, the client name nowhere in the payload.
6. Clear a required field and Save → re-curl → the job is omitted (draft).
7. `/api/site/scene/featured-work` still returns its curated set unchanged.

## Verifying video end to end

1. Apply `supabase/migrations/023_video_support.sql`; deploy the Modal
   pipeline and set the video env vars (see above).
2. Upload a short muted mp4 (≤60s) to any event → within seconds the grid
   tile shows its poster with a ▶ duration badge.
3. Add it to a website section → `curl` that scene → entry has
   `kind: "video"`, `videoUrl` is a public mp4 that `200`s without auth,
   `posterUrl`/`thumbUrl` are poster JPEGs.
4. Upload a multi-minute reel (or any clip with audio) and add it to a
   section → re-curl → `kind: "stream"`, `videoUrl` is an HLS manifest on
   `customer-<code>.cloudflarestream.com` (give Stream a minute to encode on
   first publish), posters still on the public lane.
5. Remove both from their sections → re-curl → gone; the mp4 URL `404`s and
   the Stream video is deleted from the dashboard.
6. Re-curl an image-only scene → byte-identical fields as before, plus inert
   `kind: "image"` / null video fields.
