/**
 * Split "ebay // Private Gallery" into one gallery per party (Mason, 2026-09-28:
 * "one gallery for Cindy and one for Anat and her husband").
 *
 *   npx tsx scripts/split-cindy-headshots.ts            # dry run
 *   npx tsx scripts/split-cindy-headshots.ts --apply    # does it, writes a ledger
 *
 * Follows scripts/split-ebay-private.ts, which put all three into one gallery.
 * The FILENAMES cannot decide this split: most "Cindy" Gels frames are the Peron
 * family, and all 17 "anat peron" frames are a group of five that includes Cindy.
 * So each frame is assigned by the face clusters the private gallery minted for
 * itself after the move (fresh, not RCG's mixed-up ones), checked by eye:
 *   Cindy 'b8e447a8', Came '5f3800e9', Anat '2701e0ae', their daughter '5c377dfc'.
 *
 *   Cindy, no Peron        → MOVE to Cindy's Headshots / Headshots        (25)
 *   Cindy AND a Peron      → COPY to Cindy's Headshots / Group Shots,     (17)
 *                            and move to the Peron gallery's Group Shots tab
 *   everything else        → stays with the Perons (Came, family, booth)  (60)
 *                            incl. Cindy_…_Gels_0678, no face: Came in silhouette
 *
 * Move and copy work exactly as in split-ebay-private.ts: a moved frame drops its
 * faces and resets AI so the sweep re-indexes it where it now lives; a copy gets
 * its own four R2 objects, bytes before the row.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";

type ImageInsert = Database["public"]["Tables"]["images"]["Insert"];

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const PERON = "60cfeb50-c13d-47f4-b39c-c10e61235098"; // was ebay // Private Gallery
const CINDY = "ea1bb900-09a3-4e54-8f62-43f905cdc6e8"; // Cindy's Headshots (new, empty)
const PERON_NAME = "Anat & Came Peron's Headshots";
const CINDY_CLUSTER = "b8e447a8";
const PERON_CLUSTERS = ["5f3800e9", "2701e0ae", "5c377dfc"];
const EXPECT = { cindyOnly: 25, both: 17, total: 102 };
const APPLY = process.argv.includes("--apply");

type Row = Record<string, unknown> & { id: string; original_filename: string; r2_key: string; filename: string; taken_at: string | null };

(async () => {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { getObjectBuffer, uploadToR2, buildImageKey, getThumbnailKey, objectExistsInR2 } = await import("../src/lib/r2/client");
  const db = createServiceClient();

  const { data: imgs, error: imgErr } = await db.from("images").select("*").eq("event_id", PERON).order("id").range(0, 999);
  if (imgErr) throw imgErr;
  const rows = (imgs ?? []) as Row[];
  if (rows.length !== EXPECT.total) throw new Error(`expected ${EXPECT.total} photos, found ${rows.length}`);
  const { data: faces, error: faceErr } = await db.from("faces").select("image_id, person_id").in("image_id", rows.map((r) => r.id));
  if (faceErr) throw faceErr;
  const people = new Map<string, Set<string>>();
  for (const f of faces ?? []) {
    if (!f.person_id) continue;
    const set = people.get(f.image_id) ?? new Set<string>();
    set.add(f.person_id.slice(0, 8));
    people.set(f.image_id, set);
  }
  const has = (id: string, prefix: string) => people.get(id)?.has(prefix) ?? false;
  const cindyOnly = rows.filter((r) => has(r.id, CINDY_CLUSTER) && !PERON_CLUSTERS.some((p) => has(r.id, p)));
  const both = rows.filter((r) => has(r.id, CINDY_CLUSTER) && PERON_CLUSTERS.some((p) => has(r.id, p)));
  if (cindyOnly.length !== EXPECT.cindyOnly || both.length !== EXPECT.both)
    throw new Error(`classification moved: cindyOnly ${cindyOnly.length}, both ${both.length}`);

  const sections = async (eventId: string) => {
    const { data, error } = await db.from("sections").select("id, name, sort_order").eq("event_id", eventId).order("sort_order");
    if (error) throw error;
    return data ?? [];
  };
  const pSecs = await sections(PERON);
  const cSecs = await sections(CINDY);
  const pHead = pSecs.find((s) => s.name === "Headshots");
  const cHead = cSecs.find((s) => s.name === "Headshots");
  const cGroup = cSecs.find((s) => s.name === "Group Shots");
  if (!pHead || !cHead || !cGroup) throw new Error("expected Headshots/Group Shots sections are missing");
  const { count: cindyNow } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", CINDY);
  if (cindyNow !== 0) throw new Error(`Cindy's gallery is not empty (${cindyNow})`);

  const byTime = (a: Row, b: Row) =>
    (a.taken_at ?? "").localeCompare(b.taken_at ?? "") || a.original_filename.localeCompare(b.original_filename);
  const plan = {
    moveToCindy: cindyOnly.length,
    copyGroupShots: both.length,
    staysWithPerons: rows.length - cindyOnly.length,
    peronAfter: rows.length - cindyOnly.length,
    cindyAfter: cindyOnly.length + both.length,
  };
  console.log(APPLY ? "APPLYING" : "DRY RUN", JSON.stringify(plan));
  if (!APPLY) return;
  const ledger: Record<string, unknown> = { at: new Date().toISOString(), plan, moved: cindyOnly.map((r) => r.id), groupShots: both.map((r) => r.id) };

  // 1. The Peron gallery: rename, and give the group shots their own tab.
  let r = await db.from("events").update({ name: PERON_NAME }).eq("id", PERON);
  if (r.error) throw r.error;
  for (const s of pSecs) {
    if (s.id !== pHead.id && s.sort_order >= 1) {
      r = await db.from("sections").update({ sort_order: s.sort_order + 1 }).eq("id", s.id).eq("event_id", PERON);
      if (r.error) throw r.error;
    }
  }
  const { data: pGroup, error: pgErr } = await db.from("sections")
    .insert({ event_id: PERON, name: "Group Shots", sort_order: 1, is_auto: false, sort_mode: "manual" }).select("id").single();
  if (pgErr) throw pgErr;
  const bothIds = both.map((b) => b.id);
  r = await db.from("section_images").delete().eq("section_id", pHead.id).in("image_id", bothIds);
  if (r.error) throw r.error;
  r = await db.from("section_images").insert([...both].sort(byTime).map((b, i) => ({ section_id: pGroup!.id, image_id: b.id, sort_order: i })));
  if (r.error) throw r.error;

  // 2. Copy the group shots into Cindy's gallery: files first, then rows.
  const copies: { from: string; to: string; key: string }[] = [];
  for (const src of [...both].sort(byTime)) {
    const id = randomUUID();
    const filename = `${id}.${src.filename.split(".").pop() ?? "jpg"}`;
    const key = buildImageKey(CINDY, filename);
    await uploadToR2(key, await getObjectBuffer(src.r2_key), (src.mime_type as string | null) ?? "image/jpeg");
    for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) {
      await uploadToR2(getThumbnailKey(key, v), await getObjectBuffer(getThumbnailKey(src.r2_key, v)), "image/jpeg");
    }
    const row: Record<string, unknown> = { ...src };
    for (const k of ["created_at", "updated_at", "siglip_embedding", "embedding_model", "stack_id", "stack_rank",
      "site_scene", "site_published_at", "featured", "display_order", "sps_image_id", "sps_source_image_id",
      "sps_quality", "sps_pulled_at"]) delete row[k];
    Object.assign(row, { id, event_id: CINDY, filename, r2_key: key,
      ai_indexed_at: null, ai_index_attempts: 0, ai_index_failed_at: null, ai_index_error: null });
    // Every key is a real column: `row` began as a full `select("*")` of this table.
    const ins = await db.from("images").insert(row as ImageInsert);
    if (ins.error) throw ins.error;
    copies.push({ from: src.id, to: id, key });
  }
  ledger.copies = copies;
  r = await db.from("section_images").insert(copies.map((c, i) => ({ section_id: cGroup.id, image_id: c.to, sort_order: i })));
  if (r.error) throw r.error;

  // 3. Move Cindy's own frames.
  const moveIds = cindyOnly.map((m) => m.id);
  r = await db.from("faces").delete().in("image_id", moveIds);
  if (r.error) throw r.error;
  r = await db.from("section_images").delete().in("image_id", moveIds);
  if (r.error) throw r.error;
  r = await db.from("images")
    .update({ event_id: CINDY, ai_indexed_at: null, ai_index_attempts: 0, ai_index_failed_at: null, ai_index_error: null })
    .in("id", moveIds).eq("event_id", PERON);
  if (r.error) throw r.error;
  r = await db.from("section_images").insert([...cindyOnly].sort(byTime).map((m, i) => ({ section_id: cHead.id, image_id: m.id, sort_order: i })));
  if (r.error) throw r.error;

  // 4. Verify from the durable record.
  const count = async (eventId: string) => {
    const { count: c, error } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    if (error) throw error;
    return c;
  };
  const peronAfter = await count(PERON);
  const cindyAfter = await count(CINDY);
  const copiedFilesPresent = (await Promise.all(copies.map((c) => objectExistsInR2(getThumbnailKey(c.key, "thumb-lg"))))).every(Boolean);
  const ok = peronAfter === plan.peronAfter && cindyAfter === plan.cindyAfter && copiedFilesPresent;
  Object.assign(ledger, { peronAfter, cindyAfter, copiedFilesPresent, ok });
  fs.writeFileSync("tasks/split-cindy-headshots-2026-09-28.json", JSON.stringify(ledger, null, 2));
  console.log("APPLIED", JSON.stringify({ peronAfter, cindyAfter, copiedFilesPresent, ok }));
  if (!ok) process.exit(1);
})();
