/**
 * Finish SPS-pulled photos that got stuck "pending".
 *
 * A pulled photo is written in order: bytes to R2, then its row, then its
 * section link, then the write that adds thumbnails and capture time and
 * flips it to "complete". When that last write failed on a connection blip
 * (31 photos across three imports on 2026-11-20), the photo had its bytes,
 * row and link but stayed pending and thumbless. The closing sweep looks for
 * ROWS, so it counted these as present and never came back to them. The
 * nightly reconciler would eventually complete them, but it never reads EXIF,
 * so they would have lost their capture time.
 *
 * This re-runs the importer's own finish (`finishImportedPhoto`) on each one,
 * reading the original back out of R2. Read-only unless --apply.
 *
 *   npx tsx scripts/sps-pull-finish-pending.ts            # list them
 *   npx tsx scripts/sps-pull-finish-pending.ts --apply    # finish them
 *   npx tsx scripts/sps-pull-finish-pending.ts --event <eventId> [--apply]
 *
 * Only rows older than 30 minutes, so a photo an import is finishing right
 * now is never touched. Videos are left to the nightly reconciler, which
 * re-queues their poster pipeline.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const STALE_MINUTES = 30;

async function main() {
  const apply = process.argv.includes("--apply");
  const eventFlag = process.argv.indexOf("--event");
  const eventId = eventFlag !== -1 ? process.argv[eventFlag + 1] : null;

  const { createServiceClient } = await import("@/lib/supabase/server");
  const { getObjectBuffer } = await import("@/lib/r2/client");
  const { finishImportedPhoto } = await import("@/lib/sps-integration/pull-event");
  const supabase = createServiceClient();

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  let query = supabase
    .from("images")
    .select("id, event_id, filename, original_filename, r2_key, sps_image_id, width, height, created_at")
    .eq("processing_status", "pending")
    .eq("media_type", "image")
    .not("sps_image_id", "is", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1000);
  if (eventId) query = query.eq("event_id", eventId);
  const { data: rows, error } = await query;
  if (error) throw error;
  if (rows.length === 1000) {
    console.log("1,000 rows, the response cap: run again after this pass for the rest.");
  }

  console.log(`${rows.length} pulled photo(s) stuck pending for over ${STALE_MINUTES} min${apply ? "" : " (dry run; --apply to finish)"}`);
  let finished = 0;
  let failed = 0;
  for (const row of rows) {
    const label = `${row.original_filename ?? row.filename} [${row.id}]`;
    if (!apply) {
      console.log(`  ${row.created_at}  ${label}`);
      continue;
    }
    try {
      const buffer = await getObjectBuffer(row.r2_key);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;
      await finishImportedPhoto(supabase, {
        id: row.id,
        eventId: row.event_id,
        filename: row.filename,
        buffer,
        arrayBuffer,
        spsImageId: row.sps_image_id!,
        width: row.width,
        height: row.height,
        capturedAt: null,
      });
      // Read it back: the finish reporting success is not the proof.
      const { data: after, error: readErr } = await supabase
        .from("images")
        .select("processing_status, thumbnail_generated, taken_at")
        .eq("id", row.id)
        .single();
      if (readErr) throw readErr;
      if (after.processing_status !== "complete") throw new Error(`still ${after.processing_status}`);
      finished++;
      console.log(`  done  ${label}  thumbs=${after.thumbnail_generated} taken_at=${after.taken_at ?? "none"}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${label}  ${err instanceof Error ? err.message : JSON.stringify(err)}`);
    }
  }
  if (apply) console.log(`finished ${finished}, failed ${failed}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
