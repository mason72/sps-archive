/**
 * Steven Hughes's bad DAIS 26 rows — approved by Mason 2026-08-16 with the
 * proviso that the "twin" pair only goes if byte-identical.
 *
 * THE GATE FIRED. DAIS_3409 " 1"/" 2".jpg share a byte count (1,220,406) and
 * dimensions, but sha256 differs AND the decoded pixel hashes differ — they
 * are a burst pair from the same second (taken_at 15:28:18 both), not copies.
 * BOTH STAY. The lesson: matching size + dimensions is strong evidence and
 * still not identity; the cheap hash is what separates a burst from a dupe.
 *
 * So this deletes only the three 31×25-pixel thumbnails (DAIS_3402 9/10/11),
 * which are not photographs. Mirrors the app's own delete lane
 * (api/images/batch): locked-section guard, DB row delete (links and faces
 * cascade), then deleteImageAssets for the R2 objects.
 *
 *   npx tsx scripts/triage/delete-steven-bad-rows.ts          # dry run
 *   npx tsx scripts/triage/delete-steven-bad-rows.ts --apply  # do it
 */
import fs from "node:fs";
import crypto from "node:crypto";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const TWIN_KEEP = "b8cf474f-b0bb-42da-be86-fa917e63fb84"; // DAIS_3409 2.jpg
const TWIN_DELETE = "1d5275dd-dcde-42b5-b937-d5be1326ddbb"; // DAIS_3409 1.jpg
const JUNK = [
  "31033a11-5753-4624-a331-52f18c9fc20a", // DAIS_3402 10.jpg  31×25
  "17cab040-298a-4cc8-91ab-d8695988fbc7", // DAIS_3402 11.jpg  31×25
  "66d2a708-d5af-4ecb-b698-26a457cdb2b5", // DAIS_3402 9.jpg   31×25
];

async function sha256Of(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getPresignedDownloadUrl, deleteImageAssets } = await import("../../src/lib/r2/client");
  const supabase = createServiceClient();

  const ids = [TWIN_KEEP, TWIN_DELETE, ...JUNK];
  const { data: rows, error } = await supabase
    .from("images")
    .select("id, r2_key, original_filename, file_size, width, height, media_type, site_published_at")
    .in("id", ids);
  if (error) throw error;
  if ((rows ?? []).length !== 5) {
    throw new Error(`Expected 5 rows, found ${rows?.length} — ids have drifted, stopping.`);
  }
  const byId = new Map(rows!.map((r) => [r.id, r]));
  for (const r of rows!) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.original_filename}  ${r.file_size}b ${r.width}x${r.height}`);
    if (r.site_published_at) throw new Error(`${r.original_filename} is site-published — stopping.`);
  }

  // The burst pair stays — reassert they still differ, so a future run of
  // this script cannot silently delete a frame if the ids get reused/edited.
  const keep = byId.get(TWIN_KEEP)!;
  const del = byId.get(TWIN_DELETE)!;
  const [hashKeep, hashDel] = await Promise.all([
    sha256Of(await getPresignedDownloadUrl(keep.r2_key, 600)),
    sha256Of(await getPresignedDownloadUrl(del.r2_key, 600)),
  ]);
  if (hashKeep === hashDel) {
    throw new Error(
      "The burst pair now hashes IDENTICAL — that contradicts the finding this script encodes. Stopping; re-investigate."
    );
  }
  console.log(`\nburst pair confirmed distinct (${hashKeep.slice(0, 12)}… vs ${hashDel.slice(0, 12)}…) — both stay ✓`);

  // Gate — nothing may live in a locked section (the app's own rule).
  const deleteIds = [...JUNK];
  const { data: lockedLinks, error: lockErr } = await supabase
    .from("section_images")
    .select("image_id, sections!inner(name, locked)")
    .in("image_id", deleteIds)
    .eq("sections.locked", true);
  if (lockErr) throw lockErr;
  if (lockedLinks && lockedLinks.length > 0) {
    throw new Error(`Locked-section membership found (${lockedLinks.length}) — stopping.`);
  }
  console.log("no locked-section membership ✓");

  if (!apply) {
    console.log(`\nDRY RUN — would delete ${deleteIds.length} rows. Re-run with --apply.`);
    return;
  }

  // Delete rows (links + faces cascade), then the R2 objects.
  const { error: delErr } = await supabase.from("images").delete().in("id", deleteIds);
  if (delErr) throw delErr;
  for (const id of deleteIds) {
    const r = byId.get(id)!;
    await deleteImageAssets(r.r2_key, r.media_type);
    console.log(`deleted ${r.original_filename}`);
  }

  // Verify — the durable record, not the intention.
  const { data: after } = await supabase.from("images").select("id").in("id", deleteIds);
  console.log(`\nrows remaining of the ${deleteIds.length}: ${after?.length ?? "?"} (want 0)`);
  const { count } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", (await supabase.from("images").select("event_id").eq("id", TWIN_KEEP).single()).data!.event_id)
    .eq("processing_status", "complete")
    .or("parsed_name.ilike.%Hughes%,original_filename.ilike.%Hughes%");
  console.log(`Steven-matching complete rows in DAIS now: ${count} (want 184 — burst pair kept)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
