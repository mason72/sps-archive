/**
 * Backfill face-based focal points for a whole EVENT's images.
 *
 * The gallery grid and stack cards honour focal_x/focal_y, but headshot events
 * have none (they were never scanned — only cover images were), so tall tiles
 * crop through faces and we fall back to a fixed upward bias. This writes true
 * eye-level anchors where a single confident subject exists.
 *
 * Reuses ensureAutoFocal, so the contract is identical to the editor sweep and
 * the cover job: FILL NULLS ONLY, never touch a manual pick. Since
 * 2026-08-10 group shots get a union-box/mean-eye-level anchor too.
 *
 * Detection runs on Modal CPU (no GPU) against the 800px thumb, so this is
 * cents, not dollars — but it is a real production write, hence dry-run first.
 *
 *   npx tsx scripts/backfill-event-focal.ts "Appfolio Headshots // Goleta office"
 *   npx tsx scripts/backfill-event-focal.ts <event-uuid> --write   # names are not unique
 *   npx tsx scripts/backfill-event-focal.ts "Appfolio Headshots // Goleta office" --write
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const WRITE = process.argv.includes("--write");
const EVENT_NAME = process.argv.slice(2).find((a) => !a.startsWith("--"));
/** Modal's endpoint caps a call at 200 images. */
const SCAN_CAP = 200;

async function main() {
  if (!EVENT_NAME) {
    console.error('Usage: npx tsx scripts/backfill-event-focal.ts "<event name>" [--write]');
    process.exit(1);
  }
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { ensureAutoFocal } = await import("../src/lib/faces/ensure-focal");
  const { isFaceDetectionConfigured } = await import("../src/lib/faces/detect");
  const supabase = createServiceClient();

  if (!isFaceDetectionConfigured()) {
    console.error("FACE_PIPELINE_URL not configured — nothing to do.");
    process.exit(1);
  }

  // Accept an id OR a name. Names are NOT unique — the archive has two events
  // called "COLLEGEBOARD // NASAI", one empty and one with 2,542 photos — and a
  // .single() lookup errors on the duplicate and reports it as "not found",
  // which silently skipped the real event in a backfill run. Ambiguity must be
  // surfaced, never guessed at.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    EVENT_NAME
  );
  const { data: matches, error: lookupErr } = isUuid
    ? await supabase.from("events").select("id, name").eq("id", EVENT_NAME)
    : await supabase.from("events").select("id, name").eq("name", EVENT_NAME);
  if (lookupErr) throw lookupErr;
  if (!matches?.length) {
    console.error(`No event matching ${EVENT_NAME}`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`${matches.length} events named "${EVENT_NAME}" — re-run with an id:`);
    for (const m of matches) {
      const { count } = await supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", m.id);
      console.error(`  ${m.id}  (${count ?? 0} images)`);
    }
    process.exit(1);
  }
  const event = matches[0];

  // Every image still missing an anchor, paged (PostgREST caps at 1000).
  const pending: Array<{ id: string; r2_key: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("images")
      .select("id, r2_key")
      .eq("event_id", event.id)
      .is("focal_x", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    pending.push(...data);
    if (data.length < 1000) break;
  }

  console.log(`${event.name}: ${pending.length} images without a focal point`);
  if (pending.length === 0) return;
  if (!WRITE) {
    console.log(`DRY RUN — pass --write to detect and persist. Would scan in ${Math.ceil(pending.length / SCAN_CAP)} batches of ${SCAN_CAP}.`);
    return;
  }

  const t0 = Date.now();
  let written = 0;
  let scanned = 0;
  for (let i = 0; i < pending.length; i += SCAN_CAP) {
    const batch = pending.slice(i, i + SCAN_CAP);
    const bt = Date.now();
    const n = await ensureAutoFocal(supabase, batch, { scanCap: SCAN_CAP });
    written += n;
    scanned += batch.length;
    const secs = (Date.now() - bt) / 1000;
    console.log(
      `  batch ${i / SCAN_CAP + 1}: ${batch.length} scanned, ${n} anchors written, ` +
        `${secs.toFixed(1)}s (${(secs / batch.length).toFixed(3)}s/image)`
    );
  }
  const total = (Date.now() - t0) / 1000;
  console.log(
    `\nDone: ${written}/${scanned} images anchored (${Math.round((written / scanned) * 100)}% coverage) ` +
      `in ${total.toFixed(1)}s — ${(total / scanned).toFixed(3)}s/image measured.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
