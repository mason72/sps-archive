/**
 * How much raw material exists for crew faces?
 *
 * Three numbers decide whether "recognise the crew" is a real feature or a
 * nice idea with no data behind it:
 *   1. named person clusters whose name matches someone on the roster
 *      — free wins, already identified, just not linked
 *   2. UNNAMED clusters — the candidate pool for "is this Joey?"
 *   3. how many events each roster member is linked to, since a one-time hire
 *      with one event is exactly the person Mason most wants to remember and
 *      the one with the least to match against
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: crew, error: cErr } = await s
    .from("crew")
    .select("id, display_name, full_name, aliases, is_regular, archived");
  if (cErr) { console.error("crew:", cErr.message); process.exit(2); }
  const active = (crew ?? []).filter((c) => !c.archived);

  // Every string that could name a crew member in a filename-derived cluster.
  const crewNames = new Map<string, { name: string; isRegular: boolean }>();
  for (const c of active) {
    const forms = [c.display_name, c.full_name, ...(c.aliases ?? [])].filter(Boolean) as string[];
    for (const f of forms) {
      crewNames.set(norm(f), { name: c.display_name as string, isRegular: !!c.is_regular });
      // First name alone — clusters are named from filenames, which are terse.
      const first = norm(f).split(" ")[0];
      if (first.length > 2) crewNames.set(first, { name: c.display_name as string, isRegular: !!c.is_regular });
    }
  }
  console.log(`active crew: ${active.length} (${active.filter((c) => c.is_regular).length} regulars)`);
  console.log(`name forms to match on: ${crewNames.size}\n`);

  /**
   * persons is PER EVENT — a cluster is scoped to one gallery.
   *
   * PAGED. The first version of this probe printed exactly 1000 clusters, which
   * is PostgREST's default row cap wearing the costume of a real number. A
   * suspiciously round total is a truncated query until proven otherwise.
   */
  const all: { id: string; event_id: string; name: string | null; face_count: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from("persons")
      .select("id, event_id, name, face_count")
      .order("id")
      .range(from, from + 999);
    if (error) { console.error("persons:", error.message); process.exit(2); }
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const named = all.filter((p) => (p.name ?? "").trim());
  const unnamed = all.filter((p) => !(p.name ?? "").trim());
  console.log(`person clusters: ${all.length}  (named ${named.length}, unnamed ${unnamed.length})`);

  const hits = new Map<string, { clusters: number; faces: number; isRegular: boolean }>();
  for (const p of named) {
    const hit = crewNames.get(norm(p.name as string));
    if (!hit) continue;
    const e = hits.get(hit.name) ?? { clusters: 0, faces: 0, isRegular: hit.isRegular };
    e.clusters++;
    e.faces += p.face_count ?? 0;
    hits.set(hit.name, e);
  }
  console.log(`\ncrew ALREADY named in a cluster: ${hits.size} people`);
  for (const [name, e] of [...hits.entries()].sort((a, b) => b[1].faces - a[1].faces)) {
    console.log(
      `  ${name.padEnd(28)} ${String(e.clusters).padStart(3)} clusters, ${String(e.faces).padStart(4)} faces  ${e.isRegular ? "★ regular" : ""}`
    );
  }

  // Unnamed clusters big enough to be worth proposing on.
  const worth = unnamed.filter((p) => (p.face_count ?? 0) >= 3);
  console.log(
    `\nunnamed clusters with >=3 faces (the "is this Joey?" pool): ${worth.length}`
  );

  // How thin is the tail? A one-event hire is who he most wants to remember.
  const { data: links, error: lErr } = await s
    .from("event_crew")
    .select("crew_id, event_id");
  if (lErr) { console.error("event_crew:", lErr.message); return; }
  const byCrew = new Map<string, number>();
  for (const l of links ?? []) byCrew.set(l.crew_id, (byCrew.get(l.crew_id) ?? 0) + 1);
  const oneEvent = active.filter((c) => (byCrew.get(c.id) ?? 0) === 1).length;
  const noEvent = active.filter((c) => !byCrew.get(c.id)).length;
  console.log(
    `\nroster reach: ${noEvent} crew on NO event, ${oneEvent} on exactly one, ${active.length - noEvent - oneEvent} on several`
  );
}

main();
