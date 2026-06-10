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

### Two kinds of section

- **Pool** (rotating grids): the site gets the whole curated set and
  rotates/selects on its own. Ordering: `featured` first, then the section's
  drag order, then newest.
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

## Team workflow

1. Open any event, select images, click the **globe** icon in the selection
   toolbar → pick a Pool or Slot. This adds them to that section of the TDP
   Website gallery and publishes them. "Remove from website" pulls the
   selection out of **every** website section (and unpublishes).
2. Or work inside the TDP Website gallery directly: the normal section tools
   (copy/move/remove, drag to reorder) all maintain publication automatically.
   Drag order is the site's display order; in slot sections the first image is
   THE image.
3. **Focal point** (slot sections): select a single image in a slot section →
   crosshair icon in the toolbar → click the subject → Save. The site maps it
   to CSS `object-position` so art-directed crops keep the subject in frame.
   When face detection finds a single confident subject, the marker is
   pre-placed at eye level — saving is one click.
4. **Website details** (captions/ordering metadata): select image(s) in the
   TDP Website gallery or any website section → captions icon in the toolbar
   → edit source-event name + city (event-level — applies to every photo from
   that event), service, and the featured flag. Multi-select applies
   service/featured to all selected; when the selection spans several source
   events, city can be set for all of them at once.

Defaults keep editing rare: `images.service` auto-fills from the scene on add,
and images added to a **slot** section with no focal point get one auto-filled
from face detection (exactly one confident face → eye-level point; written
into null only, never over a manual pick or deliberate clear). Slot tiles show
a small crosshair badge when their focal point is set.

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

### Team-facing: `POST` / `DELETE` / `GET /api/site/gallery`

Used by the globe gesture (logged-in users only). `POST {sceneKey, imageIds}`
adds to a scene's section and publishes; `DELETE {imageIds}` removes from every
website section and unpublishes; `GET` returns the gallery's event id.

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
2. In the app, select an image in any event → globe → e.g. **Photo Booth**.
3. `curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" .../api/site/scene/service/photo-booth`
   → expect the image, with source event/city and `focalX/focalY: null`.
4. `curl -I` a returned `fullUrl` → `HTTP 200`, no auth.
5. Set a focal point on a slot image (slot section → select → crosshair) →
   re-curl that `slot/*` scene → `focalX`/`focalY` populated, `count: 1`.
6. Remove the image from the website (globe → Remove from website) → re-curl →
   gone, and the `fullUrl` from step 4 now `404`s.
