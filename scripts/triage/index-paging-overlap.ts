/**
 * Scratch: does buildPeopleIndex's concurrent unordered .range() paging
 * double-count rows? Runs the REAL buildPeopleIndex for the archive owner and
 * reports named people's counts, then reproduces the same concurrent scan and
 * measures duplicate/missing row ids directly.
 *
 *   npx tsx scripts/triage/index-paging-overlap.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex, NON_PERSON_GALLERIES } = await import(
    "../../src/lib/people/index-people"
  );
  const supabase = createServiceClient();

  // The archive owner: whoever owns the event Jenna's photos live in.
  const { data: ev } = await supabase
    .from("events")
    .select("id, user_id, name")
    .ilike("name", "%Appfolio Headshots%Goleta%")
    .limit(1)
    .maybeSingle();
  if (!ev) throw new Error("Goleta event not found");
  console.log(`owner user_id: ${ev.user_id}`);

  const index = await buildPeopleIndex(supabase, ev.user_id);
  for (const wanted of ["jennaloeser", "stevenhughes"]) {
    const p = index.find((x) => x.key === wanted);
    console.log(`buildPeopleIndex says ${wanted}: ${p?.imageCount ?? "absent"} photos, ${p?.eventCount ?? 0} events`);
  }

  // Reproduce the raw concurrent scan and measure overlap directly.
  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .eq("user_id", ev.user_id);
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
  console.log(`\nrow count: ${count}`);

  const pages = await Promise.all(
    Array.from({ length: Math.ceil((count ?? 0) / PAGE) }, (_, i) =>
      supabase
        .from("images")
        .select("id")
        .in("event_id", eventIds)
        .eq("media_type", "image")
        .eq("processing_status", "complete")
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  );
  const ids: string[] = [];
  for (const page of pages) {
    if (page.error) throw page.error;
    ids.push(...(page.data ?? []).map((r: { id: string }) => r.id));
  }
  const distinct = new Set(ids);
  console.log(`concurrent unordered scan: ${ids.length} rows fetched, ${distinct.size} distinct`);
  console.log(`duplicated: ${ids.length - distinct.size}, missing vs count: ${(count ?? 0) - distinct.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
