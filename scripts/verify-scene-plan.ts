/**
 * Scene-plan preview on live data (read-only, applies nothing).
 * Prints proposed sections with counts and sample filenames — the
 * calibration loop for SCENE_FLOOR / SCENE_RELATIVE_KEEP.
 *
 *   npx tsx scripts/verify-scene-plan.ts <eventId> <taxonomyKey>
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const eventId = process.argv[2];
  const taxonomyKey = process.argv[3] ?? "general";
  if (!eventId) throw new Error("usage: verify-scene-plan.ts <eventId> <taxonomy>");

  const { createClient } = await import("@supabase/supabase-js");
  const { buildScenePlan } = await import("../src/lib/sections/scene-plan");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof buildScenePlan>[0];

  const { data: event } = await supabase
    .from("events")
    .select("user_id, name")
    .eq("id", eventId)
    .single();
  if (!event) throw new Error("event not found");

  const t0 = Date.now();
  const { plan, indexedCount } = await buildScenePlan(
    supabase,
    eventId,
    event.user_id,
    taxonomyKey
  );
  console.log(
    `"${event.name}" (${taxonomyKey}): ${indexedCount} images planned in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`
  );

  const names = new Map<string, string>();
  for (let page = 0; ; page++) {
    const { data } = await supabase
      .from("images")
      .select("id, original_filename")
      .eq("event_id", eventId)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    for (const r of data ?? []) names.set(r.id, r.original_filename);
    if (!data || data.length < 1000) break;
  }

  for (const section of plan) {
    const sample = section.imageIds.slice(0, 4).map((id) => names.get(id) ?? id.slice(0, 8));
    console.log(`${section.name.padEnd(20)} ${String(section.imageIds.length).padStart(5)}  ${sample.join(", ")}`);
  }
  const covered = new Set(plan.flatMap((s) => s.imageIds));
  console.log(`\ncoverage: ${covered.size}/${indexedCount}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
