/**
 * Scratch: if a person's card counted FACE-CLUSTER membership as well as
 * filename identity, how many more photos would it show — and are the extras
 * genuinely group shots?
 *
 * Filename identity answers "whose shoot is this frame from". Face membership
 * answers "who is IN this frame". Group shots only ever carry one name in the
 * filename (or none), so they are invisible to the first and visible to the
 * second. This measures the gap before anything is built on it.
 *
 *   npx tsx scripts/triage/face-membership-gain.ts "Jenna Loeser" "Steven Hughes"
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) throw new Error('Usage: … "First Last" ["First Last" …]');

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { personKeyForImage, normalizeNameKey, NON_PERSON_GALLERIES } = await import(
    "../../src/lib/people/index-people"
  );
  const supabase = createServiceClient();

  const { data: ev } = await supabase
    .from("events")
    .select("user_id")
    .ilike("name", "%Appfolio Headshots%Goleta%")
    .limit(1)
    .maybeSingle();
  if (!ev) throw new Error("owner event not found");

  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", ev.user_id);
  const scopedEvents = (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name));
  const eventIds = scopedEvents.map((e) => e.id);
  const evName = new Map(scopedEvents.map((e) => [e.id, e.name]));

  // --- Every named person cluster in scope, keyed like the people index ---
  // PAGE this. PostgREST caps an unpaged select at 1,000 rows, and the first
  // version of this probe read exactly 1000 clusters and reported "0 matching
  // clusters" for Steven Hughes — a truncated read that looks identical to a
  // real absence.
  const persons: { id: string; name: string | null; event_id: string; face_count: number }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("persons")
      .select("id, name, event_id, face_count")
      .in("event_id", eventIds)
      .not("name", "is", null)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    persons.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`named face clusters in scope: ${persons.length}`);

  // --- Whole-archive stats: how many photos have 2+ faces at all? ---
  const { count: totalFaces } = await supabase
    .from("faces")
    .select("id", { count: "exact", head: true });
  const { count: assignedFaces } = await supabase
    .from("faces")
    .select("id", { count: "exact", head: true })
    .not("person_id", "is", null);
  console.log(`faces total: ${totalFaces}, assigned to a cluster: ${assignedFaces}\n`);

  for (const name of names) {
    const key = normalizeNameKey(name);
    const mine = persons.filter((p) => normalizeNameKey(p.name ?? "") === key);
    console.log(`\n=== ${name} (key=${key}) ===`);
    console.log(`matching clusters: ${mine.length}${mine.length ? ` (${mine.map((p) => `${evName.get(p.event_id)}:${p.face_count} faces`).join(", ")})` : ""}`);

    // Face-membership image ids
    const faceImageIds = new Set<string>();
    for (const p of mine) {
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("faces")
          .select("image_id")
          .eq("person_id", p.id)
          .order("id")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const r of data ?? []) faceImageIds.add(r.image_id);
        if (!data || data.length < 1000) break;
      }
    }

    // Filename-membership image ids (what the card shows today)
    const token = name
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z]/g, ""))
      .sort((a, b) => b.length - a.length)[0];
    const nameImageIds = new Set<string>();
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("images")
        .select("id, parsed_name, original_filename")
        .in("event_id", eventIds)
        .eq("media_type", "image")
        .eq("processing_status", "complete")
        .or(`parsed_name.ilike.%${token}%,original_filename.ilike.%${token}%`)
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const r of data ?? []) {
        if (personKeyForImage(r.parsed_name, r.original_filename) === key) nameImageIds.add(r.id);
      }
      if (!data || data.length < 1000) break;
    }

    const extra = [...faceImageIds].filter((id) => !nameImageIds.has(id));
    console.log(`by filename (card today): ${nameImageIds.size}`);
    console.log(`by face cluster:          ${faceImageIds.size}`);
    console.log(`union:                    ${new Set([...faceImageIds, ...nameImageIds]).size}`);
    console.log(`NEW photos face would add: ${extra.length}`);

    if (extra.length) {
      const { data: rows } = await supabase
        .from("images")
        .select("id, event_id, original_filename")
        .in("id", extra.slice(0, 25));
      // How many faces in each extra frame? >1 means a genuine group shot.
      for (const r of rows ?? []) {
        const { count: fc } = await supabase
          .from("faces")
          .select("id", { count: "exact", head: true })
          .eq("image_id", r.id);
        console.log(`   +${fc} faces  ${evName.get(r.event_id)}  ${r.original_filename}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
