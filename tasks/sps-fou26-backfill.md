# FoU26 backfill — 35 frames pulled from SPS (2026-08-10)

**Status:** done, but the 35 images are **degraded copies pending replacement**.

## What happened

`app.pixeltrunk.com/gallery/khmd_k518b` ("Future of Us Festival",
event `693eda99-4545-4638-b370-3c6d87f855db`) was missing 35 frames that are
live on the SPS gallery `photos2.simplephotoshare.com/twodudesphoto/fou26`
(SPS event `aac1c99b-2036-4fc1-b183-0816ac961f4b`).

These two galleries were **independent uploads of the same shoot**, not an
import — which is why the drift ran in both directions:

| | before | after |
|---|---|---|
| SPS distinct frames | 302 | 302 |
| Archive distinct frames | 318 | **353** |
| On SPS, absent from archive | **35** | 0 |
| In archive, absent from SPS | 51 | 51 |

The 51 archive-only frames are genuine extras (the photographer put more of the
take into the archive) — nothing to do there.

Separately, the gallery's landing section is **Highlights (63)**, with
**Full Set** behind a "More" dropdown. That is why the gallery *read* as far more
incomplete than it was. The 63 Highlights are re-exports of 63 frames that already
exist in Full Set — duplicate bytes, not extra content.

## The catch — these 35 are low-quality copies

SPS re-compresses on ingest, so its stored "original" is well below the archive's.
Measured on frames present in both galleries, identical pixel dimensions:

| frame | archive bytes | SPS bytes | ratio |
|---|---|---|---|
| 0036 | 3,674,820 | 1,335,222 | 36% |
| 0072 | 2,904,755 | 944,172 | 32% |

The 35 backfilled frames therefore sit at roughly a third the file size of their
neighbours in Full Set. Pixel dimensions are correct (4800×3200 / 3200×4800) and
EXIF survived, so they display fine — but they are **not archive-grade**.

## 🎯 Open item — swap in the photographer's originals

Ask Two Dudes Photo to re-export these 35 frames from the original catalog, then
replace the R2 objects for the image IDs listed in
`scripts/data/sps-fou26-backfill-result.json`.

Frame numbers to request:

```
31, 33, 34, 35, 41, 44, 118, 152, 154, 172, 177, 178, 179, 180, 181, 189, 194,
213, 215, 217, 223, 228, 229, 230, 235, 238, 268, 271, 300, 301, 313, 320, 362,
387, 464
```

Note frames 31, 189 and 217 came from SPS's `" 1.jpg"` duplicate-name variants;
35, 213 and 215 had a `" 1"` sibling that was skipped. Every `" 1"` pair shared
pixel dimensions with its twin, so one copy per frame was imported — 35 files,
not 41.

## How it was done

- `scripts/data/sps-fou26-backfill.json` — source manifest (35 SPS URLs).
- `scripts/backfill-sps-fou26.ts` — dry-run by default, `--apply` to write.
  Idempotent: skips any `original_filename` already in the event.
- `scripts/data/sps-fou26-backfill-result.json` — receipt: image IDs + R2 keys.

The script mirrors the real upload path (bytes to R2 first, then the row, then
the section link with rollback, then thumbnails + EXIF, then `complete`) rather
than hand-rolling inserts.

Verified after the run:
- 35/35 rows `complete`, with thumbnails, dimensions, dominant colour and EXIF.
- 140/140 R2 objects present (original + 3 thumbnail variants each) — no ghost tiles.
- SPS frame set is now a strict subset of the archive's.
- AI indexing: 35 indexed, 76 faces; clustering merged 57 into existing people,
  created 1 new person, renamed nobody.
- Live gallery renders **Full Set 353**.

## Gotcha this exposed

`src/lib/sps-integration/import.ts` (and the docs) claim SPS and Archive share
one R2 bucket, making imports zero-copy. **Not true for SPS v2** — it serves from
its own public lane (`pub-7363d57d….r2.dev`) while the archive stores in
`sps-prism`. A probe of `sps-prism` for the SPS key prefix returned 0 objects.
Any real import has to move bytes. See `tasks/lessons.md`.
