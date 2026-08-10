/**
 * Face-clustering validation against filename ground truth (Phase 2).
 *
 * Headshot events name files after their subject, so extractPersonName gives
 * an independent answer key. Runs the REAL clusterEventFaces against the live
 * DB (persons table is not yet consumed by any UI; writes are additive and
 * reversible with --reset), then measures:
 *   - purity: within each cluster, the share of faces whose filename-name
 *     matches the cluster's dominant name (weighted mean across clusters)
 *   - fragmentation: ground-truth names whose faces split across >1 cluster
 *   - coverage: faces assigned vs unassigned
 *
 *   npx tsx scripts/verify-face-clustering.ts <eventId> [--reset]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const eventId = process.argv[2];
  const reset = process.argv.includes("--reset");
  if (!eventId) throw new Error("usage: verify-face-clustering.ts <eventId> [--reset]");

  const { createClient } = await import("@supabase/supabase-js");
  const { clusterEventFaces } = await import("../src/lib/faces/cluster-event");
  const { extractPersonName } = await import("../src/lib/gallery/stacks");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof clusterEventFaces>[0];

  if (reset) {
    // Clear person links for the event, then remove its unnamed persons.
    const { data: persons } = await supabase.from("persons").select("id, name").eq("event_id", eventId);
    for (let page = 0; ; page++) {
      const { data: rows } = await supabase
        .from("faces")
        .select("id, images!inner(event_id)")
        .eq("images.event_id", eventId)
        .not("person_id", "is", null)
        .order("id")
        .range(0, 999); // person_id is being nulled, so page 0 shrinks each pass
      if (!rows?.length) break;
      await supabase.from("faces").update({ person_id: null }).in("id", rows.map((r) => r.id));
      if (rows.length < 1000 && page > 50) break;
    }
    const unnamed = (persons ?? []).filter((p) => !p.name).map((p) => p.id);
    if (unnamed.length) await supabase.from("persons").delete().in("id", unnamed);
    console.log(`reset: cleared assignments, deleted ${unnamed.length} unnamed persons`);
  }

  const t0 = Date.now();
  const result = await clusterEventFaces(supabase, eventId);
  console.log(
    `clustered in ${((Date.now() - t0) / 1000).toFixed(1)}s:`,
    JSON.stringify(result)
  );

  // Ground truth: filename-derived names per face.
  const truth = new Map<string, string>(); // faceId → name
  const clusterOf = new Map<string, string>(); // faceId → personId
  for (let page = 0; ; page++) {
    const { data: rows, error } = await supabase
      .from("faces")
      .select("id, person_id, images!inner(event_id, original_filename)")
      .eq("images.event_id", eventId)
      .not("embedding", "is", null)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of rows ?? []) {
      const img = r.images as unknown as { original_filename: string };
      const name = extractPersonName(img.original_filename);
      if (name) truth.set(r.id, name.toLowerCase());
      if (r.person_id) clusterOf.set(r.id, r.person_id);
    }
    if (!rows || rows.length < 1000) break;
  }

  // Purity: dominant-name share per cluster, weighted by cluster size.
  const clusters = new Map<string, string[]>(); // personId → truth names
  for (const [faceId, personId] of clusterOf) {
    const name = truth.get(faceId);
    if (!name) continue;
    const list = clusters.get(personId) ?? [];
    list.push(name);
    clusters.set(personId, list);
  }
  let weighted = 0;
  let total = 0;
  const impure: { personId: string; names: Record<string, number> }[] = [];
  for (const [personId, names] of clusters) {
    const countBy = new Map<string, number>();
    for (const n of names) countBy.set(n, (countBy.get(n) ?? 0) + 1);
    const dominant = Math.max(...countBy.values());
    weighted += dominant;
    total += names.length;
    if (dominant < names.length) {
      impure.push({ personId, names: Object.fromEntries(countBy) });
    }
  }

  // Fragmentation: names spread across multiple clusters.
  const clustersByName = new Map<string, Set<string>>();
  for (const [faceId, personId] of clusterOf) {
    const name = truth.get(faceId);
    if (!name) continue;
    const set = clustersByName.get(name) ?? new Set();
    set.add(personId);
    clustersByName.set(name, set);
  }
  const multiNames = [...clustersByName.entries()].filter(([, s]) => s.size > 1);

  console.log(`\nGround truth: ${clustersByName.size} distinct filename-names`);
  console.log(`Clusters: ${clusters.size}; purity ${(100 * (weighted / Math.max(1, total))).toFixed(1)}%`);
  console.log(`Fragmented names (faces split across clusters): ${multiNames.length}`);
  for (const [name, set] of multiNames.slice(0, 8)) console.log(`  "${name}" → ${set.size} clusters`);
  console.log(`Impure clusters: ${impure.length}`);
  for (const c of impure.slice(0, 8)) console.log(`  ${c.personId.slice(0, 8)}: ${JSON.stringify(c.names)}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
