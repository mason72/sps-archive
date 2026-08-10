# Pixeltrunk — Product Requirements Document

**Status:** In active development. Core archive + gallery sharing works end to end. AI features are built but dormant (see §5).
**Last updated:** 2026-05-30

---

## 1. What Pixeltrunk Is

Pixeltrunk is a photo archive and client-gallery tool for professional photographers. It is the sister product to **SimplePhotoShare (SPS/spsv2)**.

The app does five concrete jobs today:

1. **Create events** — a photographer creates an event (one event = one shoot: name, type, date).
2. **Upload photos into sections** — drag-and-drop upload puts photos into a section of the event.
3. **Store files + metadata** — the photo binary (JPEG/PNG/etc.) goes to Cloudflare R2; a metadata row (filename, size, dimensions, EXIF, R2 key, processing status) goes to Supabase (Postgres). Display uses presigned GET URLs from R2.
4. **Organize into sections** — every event is divided into named sections (e.g. "Ceremony", "Reception"). Photos are reordered, moved, and grouped by section.
5. **Share client galleries** — the photographer publishes a public gallery link (optionally password/PIN protected) where clients view, favorite, and download photos.

**One-line pitch:** A place to archive and deliver client galleries — upload a shoot, organize it into sections, and share it.

---

## 2. Target Users

- Professional event photographers (weddings, corporate, schools, sports)
- Portrait/headshot studios
- Photography businesses that archive and re-deliver past shoots

---

## 3. Core Concepts

### Events
The top-level container. One event = one shoot. Has a name, optional date, optional type, a cover image, and one or more sections.

### Sections (hard rules — these are invariants enforced in code)
- Every event **always has at least one section**.
- Every photo belongs to **at least one real section** — there are no orphaned photos.
- **"All Images" is a derived view** (the union of every section). It is never a stored row, is not writable, and cannot be deleted.
- New events seed a default section named **"Highlights"**. It is fully renamable, and deletable once other sections exist — it is not otherwise special.
- You can delete any section **except the last one**. Deleting a section that holds the only copy of a photo reassigns that photo to another section first, so deletion never orphans photos.
- Uploads always target a real section. When the photographer is viewing "All Images," uploads land in the default (first) section.

### Images
One row per uploaded photo. The row holds filename, size, dimensions, MIME type, EXIF, the R2 key for the binary, and a processing status. The actual file lives in R2.

### Shares
A public gallery link for a client. Optional password or PIN, configurable download permission and quality, optional client favoriting, and basic view tracking.

---

## 4. Primary Flows (working today)

### Flow 1: New event -> upload -> organize
```
Create event (name, type, date)
  -> "Highlights" section is seeded
  -> Drag & drop photos into a section
  -> Browser uploads bytes to R2; metadata saved to Supabase; EXIF extracted client-side
  -> Photographer renames/adds sections and reorders photos
```

### Flow 2: Share a client gallery
```
Open event -> Share -> set permissions (download, favorites, quality) + optional password/PIN
  -> Public share link generated
  -> Client opens the link, browses by section, favorites and downloads photos
  -> Photographer sees view count and client favorites
```

---

## 5. AI Features — built but NOT active

The codebase contains a full AI design (CLIP semantic search, ArcFace face clustering, Smart Stacks, Auto Sections, aesthetic scoring) and a Modal GPU pipeline (`modal/ai_pipeline.py`). **None of this is active in production.** The Modal backend is not configured and the UI surfaces are hidden. Treat everything below as FUTURE / NOT YET ACTIVE.

> **Sequencing decision (2026-07-02, Mason):** ramp up base-product adoption FIRST; the AI pipeline stays dormant deliberately until real usage data justifies which AI features to build. Do not treat AI-gated backlog items as pending work.

- **Smart Stacks** — group similar/burst/same-person shots and surface a best shot. (dormant)
- **Semantic search** — CLIP vector search over natural-language queries like "first dance." (dormant)
- **Face clustering / face search** — ArcFace embeddings to group photos by person. (dormant)
- **Auto Sections** — generate sections automatically from AI scene tags. (dormant)
- **Aesthetic scoring** — sharpness/exposure/composite quality per image. (dormant)

What works in search today: **filename search** over original/parsed filenames. Semantic search requires the Modal pipeline.

The design notes for these features are preserved in `docs/TECHNICAL.md` sections 5-7 — kept intentionally so the work can be wired up later.

---

## 6. SPS Integration — partial

Import was designed around both products sharing one R2 bucket (zero-copy: Archive creates metadata rows pointing at existing R2 keys). **That premise is false as of 2026-08-10** — SPS v2 serves from its own bucket, so an import must copy bytes, and SPS's re-compression makes it a lossy source. See `docs/TECHNICAL.md` and `tasks/sps-fou26-backfill.md`. Import (`/api/sps/import`) and an enhancements endpoint (`/api/sps/enhancements/[eventId]`) exist. The enhancement payloads depend on the dormant AI pipeline, so the round-trip is not fully live yet.

---

## 7. Non-Goals (for now)

- Photo editing
- Video
- Real-time multi-photographer collaboration
- Direct print ordering
- Native mobile app (web-first, responsive)

---

## 8. Open Questions

1. **Authentication boundary** — share the Supabase project with SPS, or stay separate with SSO? (Currently separate; Pixeltrunk has its own email/password auth via Supabase.)
2. **AI activation** — when to stand up and configure the Modal pipeline so the dormant AI features go live.

---

## 9. Pricing & Storage

Tiered subscription by storage volume. Free 10 GB, Solo 100 GB, Pro 750 GB, Studio 2 TB; additional storage $5/100 GB on Studio. Full strategy in `docs/PRICING.md`.

> Note: the pricing doc currently advertises AI features (Smart Stacks, semantic search, face search) as included on every tier. Those are not active yet — see section 5. Reconcile marketing copy with shipped capability before launch.
