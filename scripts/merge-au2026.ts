/**
 * Fold "AU2026" into the delivered "Autodesk University 2026" gallery, then
 * delete the copy (Mason, 2026-09-24).
 *
 * The delivered gallery came in by SPS pull on 09-18 and is shared with the
 * client (3 live links, 1 email). "AU2026" is a direct upload of the same
 * Capture One export made on 09-22. Measured before writing this:
 *
 *   - Same frames, different clocks: every filename match sits exactly 7 hours
 *     apart (one path stored Pacific time as UTC), so capture-second matching
 *     against the raw column finds only 58 of ~6,100. Twins here are matched by
 *     FILENAME, or by capture second after the 7-hour shift.
 *   - The copy's 87 extra rows are mostly not new photos: 256 are duplicate
 *     uploads of one filename, ~66 are renames of delivered frames (the
 *     delivered names carry " 1" suffixes and one garbled "Kat Diaz.jpg4kVert…"
 *     stem). Only 8 frames exist nowhere in the delivered gallery.
 *   - The copy is a higher JPEG-quality export (~q98 vs ~q92, 1.5x the bytes,
 *     same pixels, same EXIF). Not a visible difference; not kept.
 *
 * What this does, in order:
 *   1. Moves the 8 new frames into the delivered gallery (row re-pointed, same
 *      R2 object — event delete removes files per ROW, never by prefix, so the
 *      file is safe under the copy's folder). Faces dropped and AI reset so the
 *      30-minute sweep re-indexes them into this event's clusters. Each lands in
 *      the first-name section its person's other frames already use.
 *   2. Fixes Kat Diaz in the delivered gallery: her 9 frames carried a garbled
 *      filename, which put them in "Misc" instead of J–K. Renamed to the clean
 *      name the copy carries, re-parsed, relinked to J–K; "Misc" held only
 *      them and is removed once empty.
 *   3. Deletes the AU2026 event and awaits every R2 delete (the app's DELETE
 *      route fires those and forgets, which a serverless function can drop).
 *
 *   npx tsx scripts/merge-au2026.ts            # dry run — writes nothing
 *   npx tsx scripts/merge-au2026.ts --apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const KEEP = "edaa6e4e-31c3-402f-a1f2-8e919f25284f"; // Autodesk University 2026
const COPY = "708f74ff-ea63-464b-9532-ac4b64e2b860"; // AU2026
const CLOCK_SHIFT_MS = 7 * 3600 * 1000; // copy.taken_at = keep.taken_at + 7h
const EXPECTED_NEW = 8;
const APPLY = process.argv.includes("--apply");

interface Img {
  id: string;
  original_filename: string;
  taken_at: string | null;
  file_size: number | null;
  r2_key: string;
  media_type: string | null;
  created_at: string;
}

(async () => {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { deleteImageAssets, objectExistsInR2 } = await import("../src/lib/r2/client");
  const { parseFilename } = await import("../src/lib/upload/parse-filename");
  const db = createServiceClient();

  async function loadImages(eventId: string): Promise<Img[]> {
    const out: Img[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("images")
        .select("id, original_filename, taken_at, file_size, r2_key, media_type, created_at")
        .eq("event_id", eventId)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      out.push(...((data ?? []) as Img[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  const { data: evs, error: evErr } = await db.from("events").select("id, name, user_id").in("id", [KEEP, COPY]);
  if (evErr) throw evErr;
  const keepEv = evs?.find((e) => e.id === KEEP);
  const copyEv = evs?.find((e) => e.id === COPY);
  if (!keepEv || !copyEv) throw new Error("both events must exist");
  if (keepEv.user_id !== copyEv.user_id) throw new Error("different owners — refusing");

  const [keepImgs, copyImgs] = await Promise.all([loadImages(KEEP), loadImages(COPY)]);
  const keepNames = new Set(keepImgs.map((k) => k.original_filename.toLowerCase()));
  const keepSeconds = new Set(keepImgs.filter((k) => k.taken_at).map((k) => Date.parse(k.taken_at!)));

  // 1. The frames the delivered gallery does not have, one row per filename.
  const newByName = new Map<string, Img>();
  for (const c of [...copyImgs].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const name = c.original_filename.toLowerCase();
    if (keepNames.has(name)) continue;
    if (c.taken_at && keepSeconds.has(Date.parse(c.taken_at) - CLOCK_SHIFT_MS)) continue; // a rename
    if (!newByName.has(name)) newByName.set(name, c);
  }
  const newFrames = [...newByName.values()];
  if (newFrames.length !== EXPECTED_NEW) {
    throw new Error(`expected ${EXPECTED_NEW} new frames, found ${newFrames.length} — the copy changed; re-measure`);
  }

  // Sections are first-letter ranges ("A–B", "J–K"); pick by the person's first letter.
  const { data: sections, error: secErr } = await db
    .from("sections")
    .select("id, name")
    .eq("event_id", KEEP)
    .order("sort_order");
  if (secErr) throw secErr;
  const ranges = (sections ?? [])
    .map((s) => ({ ...s, m: s.name.match(/^([A-Z])–([A-Z])$/) }))
    .filter((s) => s.m)
    .map((s) => ({ id: s.id, name: s.name, lo: s.m![1], hi: s.m![2] }));
  const sectionFor = (filename: string) => {
    const first = filename.trim()[0]?.toUpperCase() ?? "";
    const hit = ranges.find((r) => first >= r.lo && first <= r.hi);
    if (!hit) throw new Error(`no letter section for ${filename}`);
    return hit;
  };
  const misc = (sections ?? []).find((s) => s.name === "Misc");

  // 2. Kat Diaz's garbled rows in the delivered gallery.
  const garbled = keepImgs.filter((k) => k.original_filename.startsWith("Kat Diaz.jpg"));
  const katFixes = garbled.map((k) => {
    const frame = k.original_filename.match(/_(\d{2}-\d{2}-\d{2}_AU2026_\d+\.jpg)$/);
    if (!frame) throw new Error(`cannot derive a clean name for ${k.original_filename}`);
    const clean = `Kat Diaz_${frame[1]}`;
    return { id: k.id, from: k.original_filename, to: clean, parsed_name: parseFilename(clean).name };
  });
  const cleanNames = new Set(katFixes.map((f) => f.to.toLowerCase()));
  if (katFixes.some((f) => keepNames.has(f.to.toLowerCase())) || cleanNames.size !== katFixes.length) {
    throw new Error("a clean Kat Diaz name would collide — refusing");
  }
  const jk = sectionFor("Kat");

  const plan = {
    keep: `${keepEv.name} (${keepImgs.length})`,
    copy: `${copyEv.name} (${copyImgs.length})`,
    move: newFrames.map((f) => `${f.original_filename} → ${sectionFor(f.original_filename).name}`),
    katRename: katFixes.length,
    katSection: `${misc?.name ?? "(no Misc)"} → ${jk.name}`,
    deleteCopyRows: copyImgs.length - newFrames.length,
    keepAfter: keepImgs.length + newFrames.length,
  };
  console.log(JSON.stringify(plan, null, 2));
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }

  const ledger: Record<string, unknown> = { at: new Date().toISOString(), plan, katFixes, moved: newFrames.map((f) => f.id) };
  const ledgerPath = `tasks/merge-au2026-${Date.now()}.json`;
  const saveLedger = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  saveLedger();

  // Step 1: move.
  const ids = newFrames.map((f) => f.id);
  let r = await db.from("faces").delete().in("image_id", ids);
  if (r.error) throw r.error;
  r = await db.from("section_images").delete().in("image_id", ids);
  if (r.error) throw r.error;
  r = await db
    .from("images")
    .update({ event_id: KEEP, ai_indexed_at: null, ai_index_attempts: 0, ai_index_failed_at: null, ai_index_error: null })
    .in("id", ids)
    .eq("event_id", COPY);
  if (r.error) throw r.error;
  r = await db.from("section_images").insert(
    newFrames.map((f, i) => ({ section_id: sectionFor(f.original_filename).id, image_id: f.id, sort_order: 100000 + i })),
  );
  if (r.error) throw r.error;

  // Step 2: Kat Diaz.
  for (const f of katFixes) {
    const u = await db.from("images").update({ original_filename: f.to, parsed_name: f.parsed_name }).eq("id", f.id).eq("event_id", KEEP);
    if (u.error) throw u.error;
  }
  if (misc && katFixes.length) {
    const katIds = katFixes.map((f) => f.id);
    r = await db.from("section_images").delete().eq("section_id", misc.id).in("image_id", katIds);
    if (r.error) throw r.error;
    r = await db.from("section_images").upsert(
      katIds.map((image_id, i) => ({ section_id: jk.id, image_id, sort_order: 100100 + i })),
      { onConflict: "section_id,image_id" },
    );
    if (r.error) throw r.error;
    const { count: left, error: leftErr } = await db
      .from("section_images")
      .select("image_id", { count: "exact", head: true })
      .eq("section_id", misc.id);
    if (leftErr) throw leftErr;
    if (left === 0) {
      r = await db.from("sections").delete().eq("id", misc.id).eq("event_id", KEEP);
      if (r.error) throw r.error;
      ledger.miscRemoved = misc.id;
    }
  }
  saveLedger();

  // Step 3: delete the copy. Assets first (ordered read), then the row, then files — awaited.
  const remaining = await loadImages(COPY);
  if (remaining.length !== copyImgs.length - newFrames.length) throw new Error("copy row count moved underneath us — stopping before delete");
  if (remaining.some((x) => !x.r2_key.startsWith(`events/${COPY}/`))) throw new Error("copy row outside its folder — refusing");
  const del = await db.from("events").delete().eq("id", COPY).eq("user_id", copyEv.user_id);
  if (del.error) throw del.error;
  let failed = 0;
  for (let i = 0; i < remaining.length; i += 32) {
    const slice = remaining.slice(i, i + 32);
    const results = await Promise.allSettled(slice.map((x) => deleteImageAssets(x.r2_key, x.media_type)));
    failed += results.filter((x) => x.status === "rejected").length;
  }
  ledger.copyRowsDeleted = remaining.length;
  ledger.r2DeleteFailures = failed;

  // Verify.
  const { count: keepAfter } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", KEEP);
  const { data: copyGone } = await db.from("events").select("id").eq("id", COPY);
  const movedFileStays = await objectExistsInR2(newFrames[0].r2_key);
  const deletedFileGone = !(await objectExistsInR2(remaining[0].r2_key));
  const { data: sectionCounts } = await db.from("sections").select("name, section_images(count)").eq("event_id", KEEP).order("sort_order");
  const ok = keepAfter === plan.keepAfter && (copyGone ?? []).length === 0 && movedFileStays && deletedFileGone && failed === 0;
  Object.assign(ledger, { keepAfter, copyEventGone: (copyGone ?? []).length === 0, movedFileStays, deletedFileGone, sectionCounts, ok });
  saveLedger();
  console.log("APPLIED", JSON.stringify({ keepAfter, expected: plan.keepAfter, movedFileStays, deletedFileGone, r2DeleteFailures: failed, ok }));
  console.log(JSON.stringify(sectionCounts));
  console.log(`ledger: ${ledgerPath}`);

  const { rebuildPeopleIndexSnapshot } = await import("../src/lib/people/index-cache");
  console.log("people index:", JSON.stringify(await rebuildPeopleIndexSnapshot(db, keepEv.user_id)));
  if (!ok) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
