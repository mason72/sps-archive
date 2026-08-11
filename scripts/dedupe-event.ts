/**
 * Remove byte-identical duplicate uploads from an event.
 *
 * DRY RUN BY DEFAULT — prints exactly what it would delete and why, and
 * changes nothing until you pass --apply.
 *
 *   npx tsx scripts/dedupe-event.ts <eventId>            # report only
 *   npx tsx scripts/dedupe-event.ts <eventId> --apply    # delete
 *
 * A duplicate group is (event, original_filename, file_size) with more than
 * one row. Same name but a DIFFERENT size is a re-edit, not a duplicate — the
 * photographer re-exported that frame, and both versions are real. Those are
 * reported and never touched.
 *
 * Which copy survives is not "the newest": it's whichever copy the rest of the
 * system already points at. A row can be an event's cover, a member of several
 * sections, inside a selection share's image_ids, or somebody's favorite —
 * deleting that one and keeping a pristine orphan would silently break a live
 * gallery. Rows are scored by those references first, recency last.
 *
 * R2 objects are deliberately LEFT IN PLACE. Storage is $0.015/GB-month and
 * this is reversible only while the bytes exist; a follow-up sweep can reclaim
 * them once the result has been seen in the UI.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const eventId = process.argv[2];
const APPLY = process.argv.includes("--apply");

async function main() {
  if (!eventId || eventId.startsWith("--")) {
    throw new Error("usage: npx tsx scripts/dedupe-event.ts <eventId> [--apply]");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: event } = await supabase
    .from("events")
    .select("id, name, settings")
    .eq("id", eventId)
    .single();
  if (!event) throw new Error("event not found");
  console.log(`Event: ${(event as { name: string }).name}\n`);

  // ── Every image row ──
  type Row = {
    id: string;
    original_filename: string;
    file_size: number | null;
    created_at: string;
    processing_status: string | null;
    ai_indexed_at: string | null;
  };
  const rows: Row[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("images")
      .select("id, original_filename, file_size, created_at, processing_status, ai_indexed_at")
      .eq("event_id", eventId)
      .range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  // ── What points at each row ──
  const sectionCount = new Map<string, number>();
  const sectionsByImage = new Map<string, Set<string>>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("section_images")
      .select("image_id, section_id, sections!inner(event_id)")
      .eq("sections.event_id", eventId)
      .range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as { image_id: string; section_id: string }[]) {
      sectionCount.set(r.image_id, (sectionCount.get(r.image_id) ?? 0) + 1);
      sectionsByImage.set(
        r.image_id,
        (sectionsByImage.get(r.image_id) ?? new Set()).add(r.section_id)
      );
    }
    if (data.length < 1000) break;
  }

  const favorited = new Set<string>();
  {
    const { data } = await supabase
      .from("favorites")
      .select("image_id")
      .eq("event_id", eventId);
    for (const r of (data ?? []) as { image_id: string }[]) favorited.add(r.image_id);
  }

  const inShare = new Set<string>();
  {
    const { data } = await supabase
      .from("shares")
      .select("image_ids")
      .eq("event_id", eventId);
    for (const r of (data ?? []) as unknown as { image_ids: string[] | null }[]) {
      for (const id of r.image_ids ?? []) inShare.add(id);
    }
  }

  const coverId =
    ((event as { settings: { cover?: { imageId?: string } } | null }).settings
      ?.cover?.imageId ?? null);

  /** Higher wins. References first — deleting a referenced row breaks a live
   *  surface; recency only breaks a tie between equally-orphaned copies. */
  const score = (r: Row) =>
    (r.id === coverId ? 10_000 : 0) +
    (inShare.has(r.id) ? 1_000 : 0) +
    (favorited.has(r.id) ? 500 : 0) +
    (sectionCount.get(r.id) ?? 0) * 100 +
    (r.ai_indexed_at ? 50 : 0) +
    (r.processing_status === "complete" ? 25 : 0) +
    new Date(r.created_at).getTime() / 1e13;

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    // A null size can't be proven identical to anything — leave it alone.
    if (r.file_size == null) continue;
    const k = `${r.original_filename}|${r.file_size}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const doomed: Row[] = [];
  /** survivor id → the section ids it must inherit from the copies it replaces. */
  const inherit = new Map<string, Set<string>>();
  let dupGroups = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    dupGroups += 1;
    const ranked = [...group].sort((a, b) => score(b) - score(a));
    const keeper = ranked[0];
    for (const loser of ranked.slice(1)) {
      doomed.push(loser);
      // THE hazard of deduping by row: copies of one photo are often in
      // DIFFERENT sections (each upload session dropped into whatever was
      // active). Delete the loser without moving its memberships and that
      // photo silently vanishes from those sections — the gallery looks
      // pruned for no reason the photographer can see.
      for (const sid of sectionsByImage.get(loser.id) ?? []) {
        inherit.set(keeper.id, (inherit.get(keeper.id) ?? new Set()).add(sid));
      }
    }
  }
  // Only sections the keeper isn't already in.
  let membershipsToMove = 0;
  for (const [keeperId, sids] of inherit) {
    const already = sectionsByImage.get(keeperId) ?? new Set<string>();
    for (const sid of sids) if (!already.has(sid)) membershipsToMove += 1;
  }

  // Same name, different bytes = a re-export. Reported, never deleted.
  const byName = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.file_size == null) continue;
    byName.set(
      r.original_filename,
      (byName.get(r.original_filename) ?? new Set()).add(r.file_size)
    );
  }
  const reEdits = [...byName.values()].filter((sizes) => sizes.size > 1).length;

  const rescuedRefs = doomed.filter(
    (r) =>
      r.id === coverId ||
      inShare.has(r.id) ||
      favorited.has(r.id) ||
      (sectionCount.get(r.id) ?? 0) > 0
  );

  console.log(`rows:               ${rows.length.toLocaleString()}`);
  console.log(`identical groups:   ${dupGroups.toLocaleString()}`);
  console.log(`would delete:       ${doomed.length.toLocaleString()}`);
  console.log(`would remain:       ${(rows.length - doomed.length).toLocaleString()}`);
  console.log(`re-edits kept:      ${reEdits} filenames with differing bytes`);
  console.log(`section links moved: ${membershipsToMove.toLocaleString()} (survivors inherit their copies' sections FIRST — otherwise photos vanish from sections the loser was in)`);
  console.log(
    `of the doomed, still referenced somewhere: ${rescuedRefs.length} ` +
      `(every group keeps its most-referenced copy, so these are extra links to the SAME photo)`
  );
  console.log("\nsample of what goes:");
  for (const r of doomed.slice(0, 8)) {
    console.log(
      `  ${r.original_filename}  ${r.created_at.slice(0, 19)}  ` +
        `sections=${sectionCount.get(r.id) ?? 0} fav=${favorited.has(r.id) ? "y" : "n"}`
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete.");
    return;
  }

  // Move memberships BEFORE deleting: a crash between the two must leave
  // extra links, never missing ones.
  const links: { section_id: string; image_id: string; sort_order: number }[] = [];
  for (const [keeperId, sids] of inherit) {
    const already = sectionsByImage.get(keeperId) ?? new Set<string>();
    for (const sid of sids) {
      if (!already.has(sid)) links.push({ section_id: sid, image_id: keeperId, sort_order: 0 });
    }
  }
  if (links.length > 0) {
    console.log(`\nMoving ${links.length.toLocaleString()} section memberships…`);
    for (let i = 0; i < links.length; i += 500) {
      const { error } = await supabase
        .from("section_images")
        .upsert(links.slice(i, i + 500), { onConflict: "section_id,image_id" });
      if (error) throw error;
    }
  }

  console.log("\nDeleting…");
  let done = 0;
  for (let i = 0; i < doomed.length; i += 200) {
    const batch = doomed.slice(i, i + 200).map((r) => r.id);
    const { error } = await supabase.from("images").delete().in("id", batch);
    if (error) throw error;
    done += batch.length;
    console.log(`  ${done}/${doomed.length}`);
  }
  console.log(
    `\nDone. ${done.toLocaleString()} duplicate rows removed. R2 objects left in ` +
      `place — reclaim them separately once you've seen the gallery.`
  );
}

main().catch((e) => {
  console.error("FAILED:", e.message ?? e);
  process.exit(1);
});
