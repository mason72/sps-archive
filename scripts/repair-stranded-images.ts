import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/**
 * Repair rows whose bytes are in R2 but whose display work never finished.
 *
 *   npx tsx scripts/repair-stranded-images.ts <eventId>           # DRY RUN
 *   npx tsx scripts/repair-stranded-images.ts <eventId> --apply
 *   npx tsx scripts/repair-stranded-images.ts --all --apply       # whole archive
 *   npx tsx scripts/repair-stranded-images.ts <eventId> --apply --publish
 *
 * A stranded row is `thumbnail_generated = false` with an `r2_key` — the
 * photograph exists and is paid for, and nothing points at it. It renders as a
 * ghost tile and, while it is younger than PENDING_UPLOAD_STALE_MINUTES, it
 * also blocks the event's ENTIRE AI pipeline (`countPendingUploads` gates it).
 *
 * Works from R2 rather than from the source ZIP on purpose: the bytes in the
 * bucket are the thing the gallery serves, so repairing from them proves the
 * object is really there. A row whose object is MISSING is left alone and
 * reported — deleting it is the reconciler's job and a different decision.
 *
 * `--publish` exists because of a gap this incident exposed: the Pixieset
 * ingest only publishes on a CLEAN run (`if (!failed)`), which is the right
 * instinct — a half-imported gallery should not go live. But once the repair
 * has filled the gaps the gallery IS complete, and nothing would ever publish
 * it. It reuses the ingest's own `publishGallery`, never a re-inlined share
 * insert: CLAUDE.md is explicit that PIN inheritance breaks precisely when a
 * new call site rolls its own.
 *
 * Display fields and camera metadata are written SEPARATELY, because writing
 * them together is what stranded these rows in the first place: one
 * unconvertible EXIF value (a GPS DMS tuple against a double-precision column)
 * failed the whole update and took `processing_status` with it.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const eventId = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;
  if (!all && !eventId) {
    console.error("usage: repair-stranded-images.ts <eventId>|--all [--apply]");
    process.exit(1);
  }

  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { getPresignedDownloadUrl } = await import("../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import("../src/lib/thumbnails/generate");
  const { extractExif } = await import("../src/lib/upload/parse-filename");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const db = createServiceClient() as any;

  let q = db
    .from("images")
    .select("id, event_id, filename, original_filename, r2_key, media_type")
    .eq("thumbnail_generated", false)
    .not("r2_key", "is", null)
    .eq("media_type", "image");
  if (!all) q = q.eq("event_id", eventId);

  /**
   * Publishing runs even when there was nothing to repair.
   *
   * The first version returned early on zero stranded rows, so an event that
   * had ALREADY been repaired could never be published — which is the exact
   * state this script leaves behind, and would have made `--publish` useless
   * on the one gallery it was written for.
   */
  const publishIfWhole = async () => {
    if (!process.argv.includes("--publish") || !apply || !eventId) return;
    const { count: stillBad } = await db
      .from("images")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("thumbnail_generated", false);
    if (stillBad) {
      console.log(`NOT publishing — ${stillBad} row(s) still have no thumbnail.`);
      return;
    }
    const { publishGallery } = await import("./pixieset-ingest");
    const { resolveSharePins } = await import("../src/types/event-settings");
    const { nanoid } = await import("nanoid");
    await publishGallery(db, eventId, resolveSharePins as never, nanoid);
  };

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  console.log(`${rows?.length ?? 0} stranded row(s)${apply ? "" : "  — DRY RUN"}\n`);
  if (!rows?.length) {
    await publishIfWhole();
    return;
  }

  let fixed = 0, missing = 0, failed = 0, noExif = 0;

  for (const r of rows) {
    try {
      // Fetch the object the gallery would serve. A 404 here means the row is
      // a ghost with no bytes — a different problem, and not this script's.
      const url = await getPresignedDownloadUrl(r.r2_key, 600);
      const res = await fetch(url);
      if (!res.ok) {
        missing++;
        console.log(`  ⌀ ${r.original_filename} — object missing in R2 (${res.status}), left for the reconciler`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      const display: Record<string, unknown> = { processing_status: "complete" };
      const thumbs = await generateThumbnailsFromBuffer(buffer, r.event_id, r.filename);
      display.thumbnail_generated = true;
      display.thumb_bytes = thumbs.thumbBytes;
      if (thumbs.width) display.width = thumbs.width;
      if (thumbs.height) display.height = thumbs.height;
      if (thumbs.dominantColor) display.dominant_color = thumbs.dominantColor;

      const exif = await extractExif(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      );
      const meta: Record<string, unknown> = {};
      if (exif) {
        if (exif.takenAt) meta.taken_at = exif.takenAt;
        if (exif.cameraMake) meta.camera_make = exif.cameraMake;
        if (exif.cameraModel) meta.camera_model = exif.cameraModel;
        if (exif.lens) meta.lens = exif.lens;
        if (exif.focalLength) meta.focal_length = exif.focalLength;
        if (exif.aperture) meta.aperture = exif.aperture;
        if (exif.shutterSpeed) meta.shutter_speed = exif.shutterSpeed;
        if (exif.iso) meta.iso = exif.iso;
        if (exif.gpsLat != null) meta.gps_lat = exif.gpsLat;
        if (exif.gpsLng != null) meta.gps_lng = exif.gpsLng;
      }

      if (!apply) {
        console.log(`  ~ ${r.original_filename} → ${thumbs.width}×${thumbs.height}` +
          (Object.keys(meta).length ? `, ${Object.keys(meta).length} exif field(s)` : ", no exif"));
        fixed++;
        continue;
      }

      const { error: dErr } = await db.from("images").update(display).eq("id", r.id);
      if (dErr) throw dErr;

      if (Object.keys(meta).length) {
        const { error: mErr } = await db.from("images").update(meta).eq("id", r.id);
        if (mErr) {
          noExif++;
          console.log(`  ⚠ ${r.original_filename} repaired, metadata skipped: ${mErr.message}`);
        }
      }
      fixed++;
      if (fixed % 20 === 0) console.log(`  ${fixed} / ${rows.length}`);
    } catch (err) {
      failed++;
      const msg =
        err instanceof Error ? err.message
        : err && typeof err === "object" ? JSON.stringify(err)
        : String(err);
      console.error(`  ✗ ${r.original_filename}: ${msg}`);
    }
  }

  console.log(
    `\n${fixed} repaired · ${missing} missing in R2 · ${failed} failed` +
    (noExif ? ` · ${noExif} without camera metadata` : "")
  );

  await publishIfWhole();

  if (!apply) console.log("dry run — re-run with --apply");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
