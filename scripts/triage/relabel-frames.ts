/**
 * Relabel a run of frames the booth filed under the wrong name.
 *
 * Francisca Dedei Afutu's day-two frames at HR Florida (2026-09-02) were
 * named "Morgan Joseph": the face probe put all 18 at 0.74–0.84 to her
 * day-one face, no other frame in the event carries that name, and the
 * side-by-side matched her badge selfie. Renames original_filename by
 * prefix, re-derives parsed_name, and moves the section link into the
 * letter section her name belongs to. Dry run unless --apply.
 *
 *   npx tsx scripts/triage/relabel-frames.ts <eventId> "<fromPrefix>" "<toPrefix>" <toSectionId> [--apply]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const [eventId, fromPrefix, toPrefix, toSection] = process.argv.slice(2);
  const apply = process.argv.includes("--apply");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");
  const db = createServiceClient();
  const { data: rows, error } = await db.from("images").select("id, original_filename").eq("event_id", eventId).like("original_filename", `${fromPrefix}_%`).order("original_filename");
  if (error) throw error;
  console.log(`${rows?.length ?? 0} frame(s) under "${fromPrefix}"`);
  for (const r of rows ?? []) {
    const to = toPrefix + r.original_filename.slice(fromPrefix.length);
    console.log(`  ${r.original_filename} → ${to}  [${parseFilename(to).name}]`);
    if (!apply) continue;
    let u = await db.from("images").update({ original_filename: to, parsed_name: parseFilename(to).name }).eq("id", r.id).eq("event_id", eventId);
    if (u.error) throw u.error;
    const { data: links } = await db.from("section_images").select("section_id, sort_order").eq("image_id", r.id);
    for (const l of links ?? []) {
      if (l.section_id === toSection) continue;
      u = await db.from("section_images").delete().eq("section_id", l.section_id).eq("image_id", r.id);
      if (u.error) throw u.error;
      u = await db.from("section_images").upsert({ section_id: toSection, image_id: r.id, sort_order: l.sort_order }, { onConflict: "section_id,image_id" });
      if (u.error) throw u.error;
    }
  }
  console.log(apply ? "applied" : "DRY RUN — add --apply");
})().catch((e) => { console.error(e); process.exit(1); });
