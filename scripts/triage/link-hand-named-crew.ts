/**
 * Named clusters whose name IS a crew member's name — hand-typed through the
 * People view before it knew crew existed (Mason naming Joey's cluster minted
 * a second Joey beside the linked one). For each: link to the crew row
 * (confirmCrewPerson — teaches), clear the name into rejected_names. Crew
 * identity lives in the link, never in persons.name.
 *
 *   npx tsx scripts/triage/link-hand-named-crew.ts          # dry
 *   npx tsx scripts/triage/link-hand-named-crew.ts --apply
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const apply = process.argv.includes("--apply");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { normalizeNameKey } = await import("../../src/lib/people/index-people");
  const { confirmCrewPerson } = await import("../../src/lib/crew-faces/match");
  const supabase = createServiceClient();

  const { data: ev } = await supabase.from("events").select("user_id").ilike("name", "%Goleta%").limit(1).maybeSingle();
  const userId = ev!.user_id;

  const { data: crew } = await supabase.from("crew").select("id, display_name, aliases").eq("user_id", userId);
  const crewByKey = new Map<string, { id: string; name: string }>();
  for (const c of crew ?? []) {
    for (const n of [c.display_name, ...((c.aliases as string[] | null) ?? [])]) {
      const k = normalizeNameKey(n ?? "");
      if (k) crewByKey.set(k, { id: c.id, name: c.display_name });
    }
  }

  const named: { id: string; name: string; event: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("persons")
      .select("id, name, events!inner(name, user_id)")
      .not("name", "is", null)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      const e = p.events as unknown as { name: string; user_id: string };
      if (e.user_id !== userId) continue;
      named.push({ id: p.id, name: p.name!, event: e.name });
    }
    if (!data || data.length < 1000) break;
  }

  const hits = named.filter((p) => crewByKey.has(normalizeNameKey(p.name)));
  console.log(`named clusters wearing a crew name: ${hits.length}`);
  for (const h of hits) console.log(`  "${h.name}" at ${h.event} (${h.id.slice(0, 8)})`);
  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to link and clear.");
    return;
  }

  for (const h of hits) {
    const crewRow = crewByKey.get(normalizeNameKey(h.name))!;
    const linked = await confirmCrewPerson(supabase, { userId, crewId: crewRow.id, personId: h.id });
    if (!linked.ok) throw new Error(`${h.name}: ${linked.error}`);
    const { data: p } = await supabase.from("persons").select("rejected_names").eq("id", h.id).single();
    const rejected = new Set(p?.rejected_names ?? []);
    rejected.add(h.name);
    const { error } = await supabase
      .from("persons")
      .update({ name: null, rejected_names: [...rejected] })
      .eq("id", h.id);
    if (error) throw error;
    console.log(`linked "${h.name}" → crew ${crewRow.name}, name cleared`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
