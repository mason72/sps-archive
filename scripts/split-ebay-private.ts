/**
 * Split three guests out of "ebay // RCG MiniCon" into "ebay // Private Gallery"
 * (Mason, 2026-09-27, relaying Joey: "Anat and Cindy don't want to be in the RCG
 * gallery, they would like their own separate gallery instead").
 *
 *   npx tsx scripts/split-ebay-private.ts            # dry run: prints the plan
 *   npx tsx scripts/split-ebay-private.ts --apply    # does it, writes a ledger
 *
 * Mason's rule: HEADSHOTS move; photo booth frames they appear in stay in RCG and
 * are COPIED into the private gallery.
 *
 * Headshots = every file named "anat peron_", "came peron_" or "cindy_". The
 * names are not reliable about who is IN a frame (all 17 "anat peron" frames are
 * one group of five women; most "Cindy" Gels frames are the Peron family), but
 * every such frame belongs to this request, so the name is a safe selector. Face
 * clusters were NOT used to widen it: in this event they merge different people
 * (one carries Laura Poore's name inside Anat's group shots).
 *
 * Booth frames were picked by eye from a contact sheet of all 94: 0042-0047 and
 * 0105-0110. 0111-0114 (a girl in a Viking helmet with a friend) were left out.
 *
 * Move: faces are dropped and AI is reset so the 30-minute sweep re-indexes the
 * frames inside the private gallery (same as scripts/merge-au2026.ts), and the
 * files stay where they are: event delete purges key by key, never by prefix.
 *
 * Copy: `images.r2_key` is UNIQUE and a single-photo delete removes its files
 * without asking who else points at them, so a copy gets its OWN four objects
 * (original + three thumbnails) under the private event. Bytes land before the
 * row exists.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Database } from "../src/lib/supabase/database.types";

type ImageInsert = Database["public"]["Tables"]["images"]["Insert"];

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const RCG = "f9839b6f-ad93-4b81-944a-5e02842d9dd3"; // ebay // RCG MiniCon
const PRIVATE = "60cfeb50-c13d-47f4-b39c-c10e61235098"; // ebay // Private Gallery
const HEADSHOT_PREFIXES = ["anat peron_", "came peron_", "cindy_"];
const BOOTH_NUMBERS = [42, 43, 44, 45, 46, 47, 105, 106, 107, 108, 109, 110];
const EXPECTED_MOVE = 90;
const APPLY = process.argv.includes("--apply");

type Row = Record<string, unknown> & {
  id: string;
  original_filename: string;
  r2_key: string;
  filename: string;
  taken_at: string | null;
};

(async () => {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { getObjectBuffer, uploadToR2, buildImageKey, getThumbnailKey, objectExistsInR2 } =
    await import("../src/lib/r2/client");
  const db = createServiceClient();

  // ── Read ──
  const rcg: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("images")
      .select("*")
      .eq("event_id", RCG)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    rcg.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const lower = (s: string) => s.toLowerCase();
  const move = rcg.filter((r) => HEADSHOT_PREFIXES.some((p) => lower(r.original_filename).startsWith(p)));
  const booth = rcg.filter((r) => {
    const m = r.original_filename.match(/^260924_RCG_MiniCon_Photobooth_(\d+)\./);
    return !!m && BOOTH_NUMBERS.includes(Number(m[1]));
  });
  if (move.length !== EXPECTED_MOVE) throw new Error(`expected ${EXPECTED_MOVE} headshots, found ${move.length}`);
  if (booth.length !== BOOTH_NUMBERS.length) throw new Error(`expected ${BOOTH_NUMBERS.length} booth frames, found ${booth.length}`);

  const moveIds = move.map((r) => r.id);
  const { data: links, error: linkErr } = await db
    .from("section_images")
    .select("section_id, image_id, sections!inner(event_id, name)")
    .in("image_id", moveIds);
  if (linkErr) throw linkErr;
  const foreign = (links ?? []).filter(
    (l) => (l.sections as unknown as { event_id: string }).event_id !== RCG
  );
  if (foreign.length > 0) throw new Error(`${foreign.length} headshot links live outside RCG — stopping`);

  const { data: secs, error: secErr } = await db
    .from("sections")
    .select("id, name, sort_order")
    .eq("event_id", PRIVATE)
    .order("sort_order");
  if (secErr) throw secErr;
  const intake = (secs ?? []).find((s) => s.name === "Unsorted" || s.name === "Headshots");
  if (!intake) throw new Error("private gallery has no Unsorted/Headshots section");
  const { count: privateNow, error: cntErr } = await db
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", PRIVATE);
  if (cntErr) throw cntErr;

  const byTime = (a: Row, b: Row) =>
    (a.taken_at ?? "").localeCompare(b.taken_at ?? "") || a.original_filename.localeCompare(b.original_filename);
  const plan = {
    move: move.length,
    moveByName: HEADSHOT_PREFIXES.map((p) => [p, move.filter((r) => lower(r.original_filename).startsWith(p)).length]),
    rcgLinksRemoved: (links ?? []).length,
    boothCopies: booth.map((r) => r.original_filename).sort(),
    privateImagesBefore: privateNow,
    privateImagesAfter: (privateNow ?? 0) + move.length + booth.length,
    rcgImagesAfter: rcg.length - move.length,
  };
  console.log(APPLY ? "APPLYING" : "DRY RUN", JSON.stringify(plan, null, 2));
  if (!APPLY) return;

  const ledger: Record<string, unknown> = { at: new Date().toISOString(), plan, moved: moveIds };

  // ── 1. Sections: "Headshots" first, then "Photo Booth" ──
  let r = await db.from("sections").update({ name: "Headshots", sort_order: 0, is_auto: false, sort_mode: "manual" }).eq("id", intake.id).eq("event_id", PRIVATE);
  if (r.error) throw r.error;
  const { data: pbSec, error: pbErr } = await db
    .from("sections")
    .insert({ event_id: PRIVATE, name: "Photo Booth", sort_order: 1, is_auto: false, sort_mode: "manual" })
    .select("id")
    .single();
  if (pbErr) throw pbErr;
  for (const s of secs ?? []) {
    if (s.id !== intake.id && s.sort_order < 2) {
      r = await db.from("sections").update({ sort_order: 2 }).eq("id", s.id).eq("event_id", PRIVATE);
      if (r.error) throw r.error;
    }
  }

  // ── 2. Copy booth frames: files first, then rows ──
  const copies: { from: string; to: string; key: string }[] = [];
  for (const src of [...booth].sort(byTime)) {
    const id = randomUUID();
    const ext = src.filename.split(".").pop() ?? "jpg";
    const filename = `${id}.${ext}`;
    const key = buildImageKey(PRIVATE, filename);
    const mime = (src.mime_type as string | null) ?? "image/jpeg";
    await uploadToR2(key, await getObjectBuffer(src.r2_key), mime);
    for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) {
      await uploadToR2(getThumbnailKey(key, v), await getObjectBuffer(getThumbnailKey(src.r2_key, v)), "image/jpeg");
    }
    const row: Record<string, unknown> = { ...src };
    for (const k of ["created_at", "updated_at", "siglip_embedding", "embedding_model", "stack_id", "stack_rank",
      "site_scene", "site_published_at", "featured", "display_order", "sps_image_id", "sps_source_image_id",
      "sps_quality", "sps_pulled_at"]) delete row[k];
    Object.assign(row, {
      id, event_id: PRIVATE, filename, r2_key: key,
      ai_indexed_at: null, ai_index_attempts: 0, ai_index_failed_at: null, ai_index_error: null,
    });
    // Every key is a real column: `row` began as a full `select("*")` of this table.
    const ins = await db.from("images").insert(row as ImageInsert);
    if (ins.error) throw ins.error;
    copies.push({ from: src.id, to: id, key });
  }
  ledger.copies = copies;
  r = await db.from("section_images").insert(copies.map((c, i) => ({ section_id: pbSec!.id, image_id: c.to, sort_order: i })));
  if (r.error) throw r.error;

  // ── 3. Move headshots ──
  r = await db.from("faces").delete().in("image_id", moveIds);
  if (r.error) throw r.error;
  r = await db.from("section_images").delete().in("image_id", moveIds);
  if (r.error) throw r.error;
  r = await db
    .from("images")
    .update({ event_id: PRIVATE, ai_indexed_at: null, ai_index_attempts: 0, ai_index_failed_at: null, ai_index_error: null })
    .in("id", moveIds)
    .eq("event_id", RCG);
  if (r.error) throw r.error;
  r = await db.from("section_images").insert([...move].sort(byTime).map((m, i) => ({ section_id: intake.id, image_id: m.id, sort_order: i })));
  if (r.error) throw r.error;

  // ── 4. Verify from the durable record ──
  const count = async (eventId: string) => {
    const { count: c, error } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    if (error) throw error;
    return c;
  };
  const privateAfter = await count(PRIVATE);
  const rcgAfter = await count(RCG);
  const copiedFilesPresent = (await Promise.all(copies.map((c) => objectExistsInR2(getThumbnailKey(c.key, "thumb-lg"))))).every(Boolean);
  const boothStillInRcg = (await Promise.all(booth.map((b) => objectExistsInR2(b.r2_key)))).every(Boolean);
  const ok = privateAfter === plan.privateImagesAfter && rcgAfter === plan.rcgImagesAfter && copiedFilesPresent && boothStillInRcg;
  Object.assign(ledger, { privateAfter, rcgAfter, copiedFilesPresent, boothStillInRcg, ok });
  fs.writeFileSync("tasks/split-ebay-private-2026-09-27.json", JSON.stringify(ledger, null, 2));
  console.log("APPLIED", JSON.stringify({ privateAfter, rcgAfter, copiedFilesPresent, boothStillInRcg, ok }));
  if (!ok) process.exit(1);
})();
