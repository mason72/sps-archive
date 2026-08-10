/**
 * One-off backfill: the 35 frames that live on SPS event `fou26` but were never
 * uploaded to Pixeltrunk event "Future of Us Festival" (693eda99…).
 *
 * Why a script and not the import lane: `src/lib/sps-integration/import.ts`
 * assumes SPS and Archive share an R2 bucket, so it only mints metadata rows
 * pointing at existing keys. That is NOT true for this event — SPS serves from
 * its own public lane (pub-7363d57d….r2.dev) while the archive stores in
 * `sps-prism`. So the bytes genuinely have to move.
 *
 * Quality caveat, deliberate and accepted: SPS re-compresses on ingest. For
 * frames present on both sides the archive copy is ~3x the bytes at identical
 * pixel dimensions. These 35 therefore land visibly lighter than their
 * neighbours and are tracked in tasks/sps-fou26-backfill.md for replacement
 * with the photographer's originals.
 *
 * Mirrors the real upload path (POST /api/upload → PUT → POST /api/upload/complete)
 * rather than hand-rolling inserts: same key layout, same section-link invariant,
 * same thumbnail + EXIF work, same settlement events.
 *
 * Idempotent — a frame whose original_filename already exists in the target
 * event is skipped, so a partial run is safe to repeat.
 *
 *   npx tsx scripts/backfill-sps-fou26.ts            # dry run (default)
 *   npx tsx scripts/backfill-sps-fou26.ts --apply    # writes to PRODUCTION
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const APPLY = process.argv.includes("--apply");

interface ManifestImage {
  frame: number;
  name: string;
  url: string;
  spsSize: number;
  w: number;
  h: number;
}

interface Manifest {
  archiveEventId: string;
  archiveSectionId: string;
  archiveSectionName: string;
  images: ManifestImage[];
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { buildImageKey, uploadToR2 } = await import("../src/lib/r2/client");
  const { generateThumbnailsFromBuffer } = await import(
    "../src/lib/thumbnails/generate"
  );
  const { parseFilename, extractExif } = await import(
    "../src/lib/upload/parse-filename"
  );
  const { inngest } = await import("../src/lib/inngest/client");

  const manifest: Manifest = JSON.parse(
    fs.readFileSync("scripts/data/sps-fou26-backfill.json", "utf8")
  );
  const { archiveEventId: eventId, archiveSectionId: sectionId } = manifest;
  const supabase = createServiceClient();

  console.log(
    `\n${APPLY ? "APPLY" : "DRY RUN"} — ${manifest.images.length} frames → event ${eventId}, section "${manifest.archiveSectionName}"\n`
  );

  // Guard: the target section must exist, belong to this event, and be unlocked
  // (the upload route refuses locked sections; so do we).
  const { data: section, error: sectionErr } = await supabase
    .from("sections")
    .select("id, name, locked, event_id")
    .eq("id", sectionId)
    .single();
  if (sectionErr || !section) throw sectionErr || new Error("Section not found");
  if (section.event_id !== eventId)
    throw new Error("Section does not belong to the target event");
  if (section.locked) throw new Error(`Section "${section.name}" is locked`);

  // Idempotency: which of these filenames are already in the event?
  const { data: existing, error: existingErr } = await supabase
    .from("images")
    .select("original_filename")
    .eq("event_id", eventId);
  if (existingErr) throw existingErr;
  const present = new Set((existing ?? []).map((r) => r.original_filename));

  const todo = manifest.images.filter((i) => !present.has(i.name));
  console.log(
    `${present.size} distinct filenames already in event; ${todo.length} to add, ${manifest.images.length - todo.length} skipped as present.\n`
  );
  if (!todo.length) return;

  // Append after the existing run — Full Set is in upload order, not filename
  // order, so appending matches how the section already reads.
  const { data: tail, error: tailErr } = await supabase
    .from("section_images")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (tailErr) throw tailErr;
  let nextSort = (tail?.[0]?.sort_order ?? -1) + 1;

  const done: { id: string; frame: number; name: string; bytes: number }[] = [];
  const failed: { frame: number; name: string; reason: string }[] = [];

  for (const img of todo) {
    const label = `frame ${String(img.frame).padStart(4, "0")}`;
    try {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`source fetch ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.startsWith("image/")) throw new Error(`source type ${ct}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.byteLength < 1024) throw new Error("source too small");

      if (!APPLY) {
        console.log(
          `  would add ${label}  ${img.name}  ${(buffer.byteLength / 1e6).toFixed(2)} MB`
        );
        done.push({ id: "(dry)", frame: img.frame, name: img.name, bytes: buffer.byteLength });
        continue;
      }

      const id = randomUUID();
      const parsed = parseFilename(img.name);
      const filename = `${id}.${parsed.extension}`;
      const r2Key = buildImageKey(eventId, filename);

      // 1. bytes first — a row without an object is a ghost tile (lessons #21–23).
      await uploadToR2(r2Key, buffer, "image/jpeg");

      // 2. metadata row
      const { error: insertErr } = await supabase.from("images").insert({
        id,
        event_id: eventId,
        filename,
        original_filename: img.name,
        r2_key: r2Key,
        file_size: buffer.byteLength,
        mime_type: "image/jpeg",
        media_type: "image",
        parsed_name: parsed.name,
        processing_status: "pending",
      });
      if (insertErr) throw insertErr;

      // 3. section link — no orphans, ever. Roll the row back if this fails.
      const { error: linkErr } = await supabase.from("section_images").insert({
        section_id: sectionId,
        image_id: id,
        sort_order: nextSort++,
      });
      if (linkErr) {
        await supabase.from("images").delete().eq("id", id);
        throw linkErr;
      }

      // 4. thumbnails + EXIF, then mark complete (what /api/upload/complete does)
      const update: Record<string, unknown> = { processing_status: "complete" };

      const thumbs = await generateThumbnailsFromBuffer(buffer, eventId, filename);
      update.thumbnail_generated = true;
      update.thumb_bytes = thumbs.thumbBytes;
      if (thumbs.width) update.width = thumbs.width;
      if (thumbs.height) update.height = thumbs.height;
      if (thumbs.dominantColor) update.dominant_color = thumbs.dominantColor;

      const exif = await extractExif(arrayBuffer);
      if (exif) {
        if (exif.takenAt) update.taken_at = exif.takenAt;
        if (exif.cameraMake) update.camera_make = exif.cameraMake;
        if (exif.cameraModel) update.camera_model = exif.cameraModel;
        if (exif.lens) update.lens = exif.lens;
        if (exif.focalLength) update.focal_length = exif.focalLength;
        if (exif.aperture) update.aperture = exif.aperture;
        if (exif.shutterSpeed) update.shutter_speed = exif.shutterSpeed;
        if (exif.iso) update.iso = exif.iso;
        if (exif.gpsLat) update.gps_lat = exif.gpsLat;
        if (exif.gpsLng) update.gps_lng = exif.gpsLng;
      }

      const { error: updateErr } = await supabase
        .from("images")
        .update(update)
        .eq("id", id);
      if (updateErr) throw updateErr;

      done.push({ id, frame: img.frame, name: img.name, bytes: buffer.byteLength });
      console.log(
        `  ✓ ${label}  ${(buffer.byteLength / 1e6).toFixed(2)} MB  ${thumbs.width}×${thumbs.height}  ${id}`
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ frame: img.frame, name: img.name, reason });
      console.error(`  ✗ ${label}  ${reason}`);
    }
  }

  // Receipt first: the image IDs are the only cheap way to find these rows
  // again for the originals swap, so they must survive anything downstream.
  if (APPLY && done.length) {
    fs.writeFileSync(
      "scripts/data/sps-fou26-backfill-result.json",
      JSON.stringify({ eventId, sectionId, added: done }, null, 2)
    );
    console.log(
      "\nWrote scripts/data/sps-fou26-backfill-result.json (image IDs for the later originals swap)."
    );
  }

  // Settlement-triggered lanes, same as the upload path fires — and, like the
  // upload path, fire-and-forget. A local run has no INNGEST_EVENT_KEY, and a
  // failed nicety must never look like a failed backfill.
  if (APPLY && done.length) {
    try {
      await inngest.send({ name: "focal/auto.suggest", data: { eventId } });
      await inngest.send({ name: "ai/index.requested", data: { eventId } });
      console.log("Dispatched focal/auto.suggest + ai/index.requested.");
    } catch (err) {
      console.warn(
        `Inngest dispatch failed (${err instanceof Error ? err.message : String(err)}).\n` +
          "  Rows are complete — run scripts/backfill-ai-index.ts for indexing, " +
          "or re-fire the events from an environment holding INNGEST_EVENT_KEY."
      );
    }
  }

  console.log(
    `\n${APPLY ? "Added" : "Would add"} ${done.length}, failed ${failed.length}.`
  );
  if (failed.length) {
    console.log("Failures:");
    failed.forEach((f) => console.log(`  ${f.frame} ${f.name} — ${f.reason}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
