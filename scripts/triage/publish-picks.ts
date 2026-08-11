/**
 * Publish the blind-test picks into the event's Highlights section.
 * One frame per moment, ordered by rank. Refuses to run if Highlights is
 * already populated (so it can never silently merge with someone else's set).
 *
 *   npx tsx scripts/triage/publish-picks.ts            # dry run
 *   npx tsx scripts/triage/publish-picks.ts --apply
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const EVENT = "e8459f76-1212-461e-9078-cdc6e945e68c";
const HIGHLIGHTS = "8ef0db1c-b2d1-4906-beed-85cf0052ed38";

async function main() {
  const apply = process.argv.includes("--apply");
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const picks: { rank: number; moment: number; rep_id: string; ids: string[] }[] = JSON.parse(
    fs.readFileSync(`scripts/triage/data/claude-picks-${EVENT}.json`, "utf8")
  );

  const { count: existing, error: cErr } = await s
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .eq("section_id", HIGHLIGHTS);
  if (cErr) throw cErr;
  if ((existing ?? 0) > 0) {
    console.error(`REFUSING: Highlights already has ${existing} images. Not merging.`);
    process.exit(1);
  }

  // Which branded treatment does each chosen frame belong to?
  const { data: secs } = await s.from("sections").select("id, name").eq("event_id", EVENT);
  const secName = new Map((secs ?? []).map((x) => [x.id, x.name as string]));
  const allIds = picks.map((p) => p.rep_id);
  const { data: memb } = await s
    .from("section_images")
    .select("image_id, section_id")
    .in("image_id", allIds);
  const treat = new Map<string, string>();
  for (const r of memb ?? []) treat.set(r.image_id as string, secName.get(r.section_id as string) ?? "?");
  const tally: Record<string, number> = {};
  for (const p of picks) {
    const t = treat.get(p.rep_id) ?? "(none)";
    tally[t] = (tally[t] ?? 0) + 1;
  }
  console.log("treatment balance of chosen frames:", tally);

  const rows = picks.map((p) => ({
    section_id: HIGHLIGHTS,
    image_id: p.rep_id,
    sort_order: p.rank,
    relevance_score: Number((1 - (p.rank - 1) / picks.length).toFixed(4)),
  }));
  console.log(`${apply ? "INSERTING" : "would insert"} ${rows.length} rows into Highlights`);
  console.log("first:", rows[0], "\nlast:", rows[rows.length - 1]);
  if (!apply) {
    console.log("\ndry run — pass --apply to write");
    return;
  }

  const { error } = await s.from("section_images").insert(rows);
  if (error) throw error;
  const { count: after } = await s
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .eq("section_id", HIGHLIGHTS);
  console.log(`Highlights now has ${after} images`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
