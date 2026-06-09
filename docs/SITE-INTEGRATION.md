# Site Integration — Public Marketing Lane

How the **Two Dudes Photo** marketing website pulls rotating, curated imagery
that the team manages inside Pixeltrunk — without ever exposing private client
galleries.

## Mental model: two lanes

| | Private client galleries | Public marketing lane |
|---|---|---|
| Bucket | `sps-prism` (private) | `sps-public` (public) |
| URLs | Per-request **presigned**, 4h expiry | **Public, non-expiring** via `cdn.pixeltrunk.com` |
| Who sees it | Anyone with the share slug | Anyone (it's a public website) |
| What's in it | Every client's photos | **Only** images tagged into a website scene |

The two lanes are independent. Client-gallery sharing (permanent slug links +
presigned image URLs) is unchanged. An image becomes publicly reachable **only**
when a team member explicitly tags it into a scene — at which point its display
and thumbnail variants are copied into `sps-public`. Untag it and those copies
are removed.

We never publish the raw full-resolution original to the public bucket — only the
`thumb-md` (400px) and the display variant (the web-viewable original for
JPEG/PNG, or the 800px `thumb-lg` for non-web formats like TIFF).

## Scene keys

A "scene" is a named slot on the website. Source of truth:
[`src/lib/site/scenes.ts`](../src/lib/site/scenes.ts).

| Key | Implied `service` |
|---|---|
| `hero` | — |
| `featured-work` | — |
| `backgrounds` | — |
| `service/headshot-booth` | `headshot-booth` |
| `service/photo-booth` | `photo-booth` |
| `service/anti-booth` | `anti-booth` |
| `service/event-photography` | `event-photography` |
| `service/video` | `video` |
| `service/environmental-portraits` | `environmental-portraits` |

Adding a scene is a one-line change to that file — no migration needed.

## Tagging images into a scene (team workflow)

1. Open an event in Pixeltrunk and select one or more images.
2. In the selection toolbar (bottom bar), click the **globe** icon → **Add to
   website scene** → pick a scene. "Remove from website" untags.
3. Tagging copies the public variants into `sps-public` and stamps
   `site_published_at`. For `service/*` scenes the image's `service` is
   auto-filled from the scene.

Curation metadata (single source of truth, per image unless noted):

- `images.site_scene` — which scene (null = not on the site)
- `images.service` — auto-derived from `service/*` scenes, or set manually
- `images.featured` — boolean; featured images sort first in the API
- `images.display_order` — manual ordering within a scene (ascending)
- `events.city` — the city, read per-image via the event (for "Recent Work")

## Site-facing API

### `GET /api/site/scene/{key}`

Returns the curated images for a scene with **public, non-expiring** URLs.
Catch-all path, so namespaced keys work directly:
`/api/site/scene/service/photo-booth`.

**Auth:** shared secret header.

```
X-SPS-Key: <SPS_INTEGRATION_KEY>
```

**Ordering:** `featured` desc, then `display_order` asc, then newest first.

**Response:**

```jsonc
{
  "scene": "service/photo-booth",
  "count": 12,
  "images": [
    {
      "id": "uuid",
      "event": "Acme Holiday Party",
      "city": "Boston",
      "service": "photo-booth",
      "featured": true,
      "width": 4000,
      "height": 6000,
      "thumbUrl": "https://cdn.pixeltrunk.com/events/<id>/thumbnails/thumb-md/<file>.jpg",
      "fullUrl": "https://cdn.pixeltrunk.com/events/<id>/originals/<file>.jpg"
    }
  ]
}
```

The website is responsible for rotation/selection — it gets the full curated set
and rotates client-side. The response is cacheable
(`Cache-Control: public, max-age=60, s-maxage=300`).

**Example:**

```bash
curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" \
  https://app.pixeltrunk.com/api/site/scene/service/photo-booth
```

Each returned `thumbUrl` / `fullUrl` must `200` with **no** auth header and must
not expire:

```bash
curl -I "https://cdn.pixeltrunk.com/events/<id>/thumbnails/thumb-md/<file>.jpg"
# → HTTP/2 200
```

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

The bucket + public domain can't be created from this repo. In the Cloudflare
dashboard (account `aa3ce5fa7edd5346e777d23a4c34fe17`):

1. **R2 → Create bucket** → name `sps-public`. Same region as `sps-prism`. ✅ done
2. **Public URL.** `pixeltrunk.com` is NOT a Cloudflare zone on this account, so
   an R2 custom domain isn't available without moving the domain's nameservers to
   Cloudflare. We use the **Public Development URL** (r2.dev) instead:
   **sps-public → Settings → Public Development URL → Enable** (type `allow`).
   Current value: `https://pub-d26e68845d7742259c52f68cbb95e72e.r2.dev` ✅ done.
   To upgrade to `cdn.pixeltrunk.com` later: add the zone to Cloudflare, connect
   it as a Custom Domain on this bucket, and update `R2_PUBLIC_LANE_URL` — no code
   change. (r2.dev is rate-limited; fine for launch, revisit for high traffic.)
3. **R2 API token:** ensure the token behind `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY` has **Object Read & Write** on **both** `sps-prism` and
   `sps-public` (needed for the server-side bucket-to-bucket copy on tag). If
   it's bucket-scoped to `sps-prism` only, broaden it to both buckets.
4. Set `R2_PUBLIC_BUCKET_NAME` and `R2_PUBLIC_LANE_URL` in Vercel (Production +
   Preview) and redeploy.

## Verifying end to end

After the Cloudflare setup + env are in place:

1. Apply the migration `supabase/migrations/019_site_scenes.sql` (already applied
   to the live project hfusdrtrizabzzcdhnyy).
2. In the app, tag a few images into `service/photo-booth`.
3. `curl -H "X-SPS-Key: $SPS_INTEGRATION_KEY" .../api/site/scene/service/photo-booth`
   → expect the tagged images.
4. `curl -I` one of the returned `fullUrl`s → expect `HTTP 200` with no auth.
