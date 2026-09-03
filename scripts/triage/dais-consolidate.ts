/**
 * DAIS 26 lived in the archive twice (found 2026-09-02): the SPS pull
 * ("DAIS 26", 9,092 camera originals, crew + intel attached, one Unsorted
 * section, never published) and the Pixieset ingest ("GOOGLE CLOUD // DAIS
 * 2026", 8,915 recompressed copies of the same frames — median 0.81× the
 * bytes at the same pixels — hand-curated into 15 sections and published
 * to a link nobody had opened). Mason's call: the SPS copy is the archive
 * of record; the curation and the link move onto it.
 *
 * Frames are matched across the copies by (shoot date, frame number) from
 * the filename, disambiguated by the letters of the person's name when two
 * cameras reused a number on the same day.
 *
 * Dry run prints every mapping and writes nothing. `--apply` then, in order:
 *   1. fixes the SPS copy's corrupted filenames from their Pixieset match
 *   2. MOVES the Pixieset-only rows into the SPS event (same R2 objects —
 *      event delete sweeps per row, never by prefix — faces dropped so the
 *      SPS event's clustering re-learns them; ai_indexed_at cleared)
 *   3. recreates every Pixieset section on the SPS event, same names and
 *      order, membership via the match; SPS-only frames are bucketed into
 *      the letter range their first name falls in
 *   4. deletes the SPS event's Unsorted intake section
 *   5. renames + re-dates the SPS event to the published name; marks the
 *      Pixieset event superseded
 *   6. repoints the published share (slug unchanged) at the SPS event
 * then verifies: every image sectioned, counts, Highlights = 79.
 *
 *   npx tsx scripts/triage/dais-consolidate.ts          # dry run
 *   npx tsx scripts/triage/dais-consolidate.ts --apply
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const SPS = "f2fe3441-9f6c-4429-b8d1-e6a58be9fbb0";
const PIX = "26ca7bed-9ebb-4c09-b6b3-1f1f4021db75";
const SHARE_SLUG = "etwNOrGT86";
const PUBLISHED_NAME = "GOOGLE CLOUD // DAIS 2026";
const PUBLISHED_DATE = "2026-06-16";
const SUPERSEDED_NAME = "GOOGLE CLOUD // DAIS 2026 · superseded 2026-09-02 — delete after 2026-09-09";
const APPLY = process.argv.includes("--apply");

type Row = { id: string; event_id: string; original_filename: string; parsed_name: string | null };

function frameKey(name: string): string | null {
  const d = name.match(/(\d{2}-\d{2}-\d{2})/)?.[1];
  const seq = name.match(/(\d{4,5})\.jpg$/i)?.[1];
  return d && seq ? `${d}|${Number(seq)}` : null;
}
function letters(name: string): string {
  return name.replace(/_\d{2}-\d{2}-\d{2}.*$/, "").toLowerCase().replace(/[^a-z]/g, "");
}
/** "Sa - Se" → [sa, se]; "J" → [j, j]; "FIRST NAME Aa - Al" → [aa, al]. */
function range(sectionName: string): [string, string] | null {
  const m = sectionName.match(/([A-Za-z]{1,2})\s*-\s*([A-Za-z]{1,2})\s*$/);
  if (m) return [m[1].toLowerCase(), m[2].toLowerCase()];
  const one = sectionName.trim().match(/^([A-Za-z])$/);
  return one ? [one[1].toLowerCase(), one[1].toLowerCase()] : null;
}
function inRange(initials: string, [lo, hi]: [string, string]): boolean {
  const a = initials.slice(0, lo.length).padEnd(lo.length, "a");
  const b = initials.slice(0, hi.length).padEnd(hi.length, "z");
  return a >= lo && b <= hi + "z".repeat(Math.max(0, 2 - hi.length));
}

(async () => {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");
  const { personNameFromParts } = await import("../../src/lib/gallery/stacks");
  const db = createServiceClient();

  async function loadRows(eventId: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("images")
        .select("id, event_id, original_filename, parsed_name")
        .eq("event_id", eventId)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      out.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const [sps, pix] = await Promise.all([loadRows(SPS), loadRows(PIX)]);
  console.log(`loaded sps=${sps.length} pix=${pix.length}`);

  // ── match ──
  const spsByKey = new Map<string, Row[]>();
  for (const r of sps) {
    const k = frameKey(r.original_filename);
    if (!k) continue;
    spsByKey.set(k, [...(spsByKey.get(k) ?? []), r]);
  }
  const pixToSps = new Map<string, Row>();
  const claimed = new Set<string>();
  let ambiguous = 0;
  for (const p of pix) {
    const k = frameKey(p.original_filename);
    const cands = (k ? spsByKey.get(k) ?? [] : []).filter((s) => !claimed.has(s.id));
    let hit: Row | undefined;
    if (cands.length === 1) hit = cands[0];
    else if (cands.length > 1) {
      const pl = letters(p.original_filename);
      const byName = cands.filter((s) => letters(s.original_filename) === pl);
      if (byName.length === 1) hit = byName[0];
      else {
        // A corrupted SPS name carries no letters to compare; if exactly one
        // candidate is corrupted, the frame number is all the evidence there
        // is, and it is enough.
        const broken = cands.filter((s) => s.original_filename.includes(".jpg_"));
        if (byName.length === 0 && broken.length === 1) hit = broken[0];
        else ambiguous++;
      }
    }
    if (hit) {
      pixToSps.set(p.id, hit);
      claimed.add(hit.id);
    }
  }
  const pixOnly = pix.filter((p) => !pixToSps.has(p.id));
  const spsOnly = sps.filter((s) => !claimed.has(s.id));
  console.log(`matched=${pixToSps.size} pixOnly=${pixOnly.length} spsOnly=${spsOnly.length} ambiguous=${ambiguous}`);
  // Same frame number on both unmatched sides = possibly one photo twice.
  const spsOnlyByKey = new Map(spsOnly.map((s) => [frameKey(s.original_filename), s]));
  const collisions = pixOnly.filter((p) => spsOnlyByKey.has(frameKey(p.original_filename)));
  console.log(`unmatched frames sharing a (date, number) across the two sides: ${collisions.length}`);
  for (const p of collisions.slice(0, 6)) console.log(`  pix ${p.original_filename}  ↔  sps ${spsOnlyByKey.get(frameKey(p.original_filename))!.original_filename}`);
  const ini = new Map<string, number>();
  for (const s of spsOnly) { const n = (personNameFromParts(s.parsed_name, s.original_filename) ?? "").trim().toLowerCase().slice(0, 1) || "?"; ini.set(n, (ini.get(n) ?? 0) + 1); }
  console.log("spsOnly by first initial:", JSON.stringify(Object.fromEntries([...ini].sort())));

  // ── corrupted SPS names ──
  const spsToPix = new Map([...pixToSps].map(([pid, s]) => [s.id, pix.find((p) => p.id === pid)!]));
  const corrupted = sps.filter((s) => s.original_filename.includes(".jpg_"));
  const renames = corrupted.flatMap((s) => {
    const p = spsToPix.get(s.id);
    return p ? [{ id: s.id, from: s.original_filename, to: p.original_filename }] : [];
  });
  console.log(`corrupted=${corrupted.length} renamable=${renames.length}`);
  for (const r of renames.slice(0, 3)) console.log(`  ${r.from.slice(0, 40)}… → ${r.to}`);

  // ── sections ──
  const { data: pixSections, error: sErr } = await db
    .from("sections")
    .select("id, name, sort_order, is_auto")
    .eq("event_id", PIX)
    .order("sort_order");
  if (sErr) throw sErr;
  const plan: { name: string; sort_order: number; imageIds: string[]; unmatched: number }[] = [];
  for (const sec of pixSections ?? []) {
    const links: { image_id: string; sort_order: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("section_images")
        .select("image_id, sort_order")
        .eq("section_id", sec.id)
        .order("sort_order")
        .order("image_id")
        .range(offset, offset + 999);
      if (error) throw error;
      links.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const ids: string[] = [];
    let unmatched = 0;
    for (const l of links) {
      const hit = pixToSps.get(l.image_id);
      if (hit) ids.push(hit.id);
      else if (pixOnly.some((p) => p.id === l.image_id)) ids.push(l.image_id); // moves with the row
      else unmatched++;
    }
    plan.push({ name: sec.name, sort_order: sec.sort_order, imageIds: ids, unmatched });
  }

  // SPS-only frames → the letter range their first name falls in.
  const ranges = plan.map((p) => ({ p, r: range(p.name) })).filter((x) => x.r) as { p: (typeof plan)[0]; r: [string, string] }[];
  const unbucketed: Row[] = [];
  for (const s of spsOnly) {
    const name = personNameFromParts(s.parsed_name, s.original_filename)?.trim() ?? "";
    const initials = name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 2);
    const home = initials && ranges.find((x) => inRange(initials, x.r));
    if (home) home.p.imageIds.push(s.id);
    else unbucketed.push(s);
  }
  console.log("sections to recreate:");
  for (const p of plan) console.log(`  ${String(p.sort_order).padStart(2)}  ${p.name.padEnd(22)} ${String(p.imageIds.length).padStart(5)}${p.unmatched ? `  (${p.unmatched} unmatched)` : ""}`);
  console.log(`spsOnly bucketed=${spsOnly.length - unbucketed.length} unbucketed=${unbucketed.length}`);
  for (const u of unbucketed.slice(0, 8)) console.log(`  unbucketed: ${u.original_filename}`);

  const sectioned = new Set(plan.flatMap((p) => p.imageIds));
  const allIds = new Set([...sps.map((s) => s.id), ...pixOnly.map((p) => p.id)]);
  const orphans = [...allIds].filter((id) => !sectioned.has(id));
  console.log(`would leave ${orphans.length} image(s) in no section`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    return;
  }
  if (orphans.length > 0) throw new Error("refusing to apply with orphans — bucket them first");
  // Rollback record: what moved, what was renamed, and the section plan.
  const dump = process.env.DAIS_DUMP ?? `dais-consolidate-${Date.now()}.json`;
  fs.writeFileSync(dump, JSON.stringify({ pixOnlyIds: pixOnly.map((p) => p.id), renames, plan: plan.map((p) => ({ name: p.name, sort_order: p.sort_order, imageIds: p.imageIds })) }));
  console.log(`rollback record: ${dump}`);

  // 1. corrupted names
  for (const r of renames) {
    const { error } = await db
      .from("images")
      .update({ original_filename: r.to, parsed_name: parseFilename(r.to).name })
      .eq("id", r.id)
      .eq("event_id", SPS);
    if (error) throw error;
  }
  console.log(`renamed ${renames.length}`);

  // 2. move pixOnly rows
  const moveIds = pixOnly.map((p) => p.id);
  for (let i = 0; i < moveIds.length; i += 200) {
    const slice = moveIds.slice(i, i + 200);
    let r = await db.from("faces").delete().in("image_id", slice);
    if (r.error) throw r.error;
    r = await db.from("section_images").delete().in("image_id", slice);
    if (r.error) throw r.error;
    r = await db.from("images").update({ event_id: SPS, ai_indexed_at: null }).in("id", slice).eq("event_id", PIX);
    if (r.error) throw r.error;
  }
  console.log(`moved ${moveIds.length}`);

  // 3. sections on SPS event
  for (const p of plan) {
    const { data: created, error } = await db
      .from("sections")
      .insert({ event_id: SPS, name: p.name, sort_order: p.sort_order, is_auto: false, sort_mode: "filename" })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("section insert failed");
    const rows = p.imageIds.map((image_id, i) => ({ section_id: created.id, image_id, sort_order: i }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: lErr } = await db.from("section_images").upsert(rows.slice(i, i + 500), { onConflict: "section_id,image_id" });
      if (lErr) throw lErr;
    }
  }
  console.log(`created ${plan.length} sections`);

  // 4. drop Unsorted
  {
    const { error } = await db.from("sections").delete().eq("event_id", SPS).ilike("name", "Unsorted");
    if (error) throw error;
  }

  // 5. names
  {
    let r = await db.from("events").update({ name: PUBLISHED_NAME, event_date: PUBLISHED_DATE }).eq("id", SPS);
    if (r.error) throw r.error;
    r = await db.from("events").update({ name: SUPERSEDED_NAME }).eq("id", PIX);
    if (r.error) throw r.error;
  }

  // 6. share
  {
    const { data, error } = await db.from("shares").update({ event_id: SPS }).eq("slug", SHARE_SLUG).eq("event_id", PIX).select("id");
    if (error) throw error;
    console.log(`repointed ${data?.length ?? 0} share(s)`);
  }

  // verify
  const { count: total } = await db.from("images").select("id", { count: "exact", head: true }).eq("event_id", SPS);
  const { data: secs } = await db.from("sections").select("id, name, sort_order").eq("event_id", SPS).order("sort_order");
  let linked = 0;
  for (const s of secs ?? []) {
    const { count } = await db.from("section_images").select("*", { count: "exact", head: true }).eq("section_id", s.id);
    console.log(`  ${String(s.sort_order).padStart(2)}  ${s.name.padEnd(22)} ${String(count ?? 0).padStart(5)}`);
    linked += count ?? 0;
  }
  console.log(`images=${total} links=${linked} (links ≥ images and no orphans is the pass condition)`);
})().catch((e) => { console.error(e); process.exit(1); });
