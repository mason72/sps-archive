/**
 * Proof that group shots now reach a person's card — and that the tile and the
 * card agree on the enlarged number.
 *
 * Finds identities the face clusters add photos to, then for the top few checks
 * buildPeopleIndex (the tile) against buildPersonDetail (the card) and prints
 * how many faces each added frame holds. A frame with 2+ faces is a genuine
 * group shot; a frame with 1 would mean the guard let something odd through.
 *
 *   npx tsx scripts/triage/verify-group-shots.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex, buildPersonDetail, NON_PERSON_GALLERIES, personKeyForImage } =
    await import("../../src/lib/people/index-people");
  const { loadFaceMembership } = await import("../../src/lib/people/face-membership");
  const supabase = createServiceClient();

  const { data: ev } = await supabase
    .from("events")
    .select("user_id")
    .ilike("name", "%Goleta%")
    .limit(1)
    .maybeSingle();
  const userId = ev!.user_id;

  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", userId);
  const scoped = (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name));
  const eventIds = scoped.map((e) => e.id);

  const membership = await loadFaceMembership(supabase, eventIds);

  // Filename membership, to find who genuinely GAINS.
  const filenameKeyOf = new Map<string, string>();
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from("images")
      .select("id, parsed_name, original_filename")
      .in("event_id", eventIds)
      .eq("media_type", "image")
      .eq("processing_status", "complete")
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const k = personKeyForImage(r.parsed_name, r.original_filename);
      if (k) filenameKeyOf.set(r.id, k);
    }
    if (!data || data.length < 1000) break;
  }

  const gains: { key: string; novel: string[] }[] = [];
  for (const [key, ids] of membership) {
    const novel = [...ids].filter((id) => filenameKeyOf.get(id) !== key && filenameKeyOf.has(id));
    if (novel.length) gains.push({ key, novel });
  }
  gains.sort((a, b) => b.novel.length - a.novel.length);
  console.log(`identities gaining group shots: ${gains.length}`);
  console.log(`total added appearances: ${gains.reduce((n, g) => n + g.novel.length, 0)}\n`);

  const index = await buildPeopleIndex(supabase, userId);
  const byKey = new Map(index.map((p) => [p.key, p]));

  let checked = 0;
  let allAgree = true;
  for (const g of gains.slice(0, 5)) {
    const person = byKey.get(g.key);
    if (!person) {
      console.log(`${g.key}: gains ${g.novel.length} but is NOT on the index (unvouched/excluded)`);
      continue;
    }
    const detail = await buildPersonDetail(supabase, userId, person.name);
    const agree = detail?.imageCount === person.imageCount;
    if (!agree) allAgree = false;
    checked++;
    console.log(`${person.name}: tile=${person.imageCount} card=${detail?.imageCount} ${agree ? "✓" : "✗ MISMATCH"} (+${g.novel.length} group shots)`);

    // Confirm the added frames really are group shots.
    const sample = g.novel.slice(0, 4);
    for (const id of sample) {
      const { count } = await supabase
        .from("faces")
        .select("id", { count: "exact", head: true })
        .eq("image_id", id);
      const { data: img } = await supabase
        .from("images")
        .select("original_filename")
        .eq("id", id)
        .maybeSingle();
      console.log(`    ${count} faces  ${img?.original_filename}`);
    }
  }

  console.log(
    `\n${allAgree && checked > 0 ? "✅ PASS" : checked === 0 ? "⚠️ nothing checked" : "❌ FAIL"} — tile/card agreement across ${checked} people who gained group shots`
  );
  if (!allAgree) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
