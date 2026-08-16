/**
 * Proof for the /people miscount fix: ordered concurrent paging must return
 * every row exactly once, and buildPeopleIndex's counts must be stable across
 * repeated runs.
 *
 * The bug was NONDETERMINISTIC (2 bad runs in 5), so a single clean run proves
 * nothing — this repeats and reports the spread. It also runs the UNORDERED
 * query shape alongside as a live control, so a passing result can't be
 * mistaken for "the race went away on its own".
 *
 *   npx tsx scripts/triage/verify-people-counts.ts [runs]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const runs = Number(process.argv[2] ?? 6);
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex, buildPersonDetail, NON_PERSON_GALLERIES } = await import(
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
  const userId = ev.user_id;

  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", userId);
  const eventIds = (events ?? [])
    .filter((e) => !NON_PERSON_GALLERIES.has(e.name))
    .map((e) => e.id);

  const PAGE = 1000;
  const { count } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .in("event_id", eventIds)
    .eq("media_type", "image")
    .eq("processing_status", "complete");
  const expected = count ?? 0;

  const scan = async (ordered: boolean) => {
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(expected / PAGE) }, (_, i) => {
        let q = supabase
          .from("images")
          .select("id")
          .in("event_id", eventIds)
          .eq("media_type", "image")
          .eq("processing_status", "complete");
        if (ordered) q = q.order("id");
        return q.range(i * PAGE, i * PAGE + PAGE - 1);
      })
    );
    const ids: string[] = [];
    for (const p of pages) {
      if (p.error) throw p.error;
      ids.push(...(p.data ?? []).map((r: { id: string }) => r.id));
    }
    return { fetched: ids.length, distinct: new Set(ids).size };
  };

  console.log(`rows in scope: ${expected}\n`);

  let orderedBad = 0;
  let unorderedBad = 0;
  const jennaCounts = new Set<number>();
  const stevenCounts = new Set<number>();

  for (let i = 1; i <= runs; i++) {
    const [ordered, unordered] = await Promise.all([scan(true), scan(false)]);
    const oDup = ordered.fetched - ordered.distinct;
    const oMiss = expected - ordered.distinct;
    const uDup = unordered.fetched - unordered.distinct;
    if (oDup !== 0 || oMiss !== 0) orderedBad++;
    if (uDup !== 0) unorderedBad++;

    const index = await buildPeopleIndex(supabase, userId);
    const jenna = index.find((p) => p.key === "jennaloeser")?.imageCount ?? -1;
    const steven = index.find((p) => p.key === "stevenhughes")?.imageCount ?? -1;
    jennaCounts.add(jenna);
    stevenCounts.add(steven);

    console.log(
      `run ${i}: ordered dup=${oDup} missing=${oMiss} | UNORDERED control dup=${uDup} | ` +
        `Jenna=${jenna} Steven=${steven}`
    );
  }

  // Card must agree with the tile.
  const jennaDetail = await buildPersonDetail(supabase, userId, "Jenna Loeser");
  const stevenDetail = await buildPersonDetail(supabase, userId, "Steven Hughes");

  console.log(`\ncard (buildPersonDetail): Jenna=${jennaDetail?.imageCount} Steven=${stevenDetail?.imageCount}`);
  console.log(`tile values seen: Jenna=${[...jennaCounts]} Steven=${[...stevenCounts]}`);

  const pass =
    orderedBad === 0 &&
    jennaCounts.size === 1 &&
    stevenCounts.size === 1 &&
    [...jennaCounts][0] === jennaDetail?.imageCount &&
    [...stevenCounts][0] === stevenDetail?.imageCount;

  console.log(
    `\nordered scan corrupt in ${orderedBad}/${runs} runs; unordered control corrupt in ${unorderedBad}/${runs}`
  );
  if (unorderedBad === 0) {
    console.log(
      "⚠️ control never reproduced the race this session — a PASS here is weaker evidence than it looks."
    );
  }
  console.log(pass ? "\n✅ PASS — counts stable and tile agrees with card" : "\n❌ FAIL");
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
