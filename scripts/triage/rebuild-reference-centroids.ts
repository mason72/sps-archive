/**
 * Rebuild every gallery's reference centroids, one gallery at a time.
 *
 * The whole-archive refresh (`p_event_id` null) no longer fits one statement:
 * at 26k reference people it passed db-sql's 120s guard twice on 2026-09-30
 * and rolled back. The scoped refresh is ~2.5s, so this walks the galleries
 * that hold a reference and refreshes each. Use it after any change to
 * `refresh_person_reference_centroids` (migration 088 was the first).
 *
 *   npx tsx scripts/triage/rebuild-reference-centroids.ts <userId>
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("usage: rebuild-reference-centroids.ts <userId>");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { NON_PERSON_GALLERIES } = await import("../../src/lib/people/index-people");
  const supabase = createServiceClient();

  // Galleries with a reference now, by way of their persons. Paged + ordered.
  const personIds: string[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("person_reference_centroids")
      .select("person_id")
      .eq("user_id", userId)
      .order("person_id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    personIds.push(...(data ?? []).map((r) => r.person_id));
    if (!data || data.length < 1000) break;
  }
  const eventIds = new Set<string>();
  for (let i = 0; i < personIds.length; i += 200) {
    const { data, error } = await supabase
      .from("persons")
      .select("event_id")
      .in("id", personIds.slice(i, i + 200));
    if (error) throw error;
    for (const r of data ?? []) eventIds.add(r.event_id);
  }
  console.log(`${personIds.length} references across ${eventIds.size} galleries`);

  let rebuilt = 0;
  let failed = 0;
  let n = 0;
  for (const eventId of [...eventIds].sort()) {
    n += 1;
    const { data, error } = await supabase.rpc("refresh_person_reference_centroids", {
      p_user_id: userId,
      p_event_id: eventId,
      p_excluded_event_names: [...NON_PERSON_GALLERIES],
    });
    if (error) {
      failed += 1;
      console.error(`  ${eventId}: ${error.message}`);
      continue;
    }
    rebuilt += data ?? 0;
    if (n % 50 === 0) console.log(`  ${n}/${eventIds.size} galleries, ${rebuilt} references`);
  }
  console.log(`done: ${rebuilt} references from ${eventIds.size} galleries, ${failed} failed (was ${personIds.length})`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
