/**
 * "RJD is Ryan Darcy - same person" (Mason, 2026-08-15). Merge the duplicate:
 * keep Ryan Darcy, move every link (event_crew, crew_faces, crew_persons),
 * fold in any fields only R .JD had — email matters most, it is how calendar
 * matching finds people — keep "R .JD" as an alias so the string still
 * resolves, then delete the empty row. INSPECT first, merge on --apply.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const APPLY = process.argv.includes("--apply");
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows } = await s
    .from("crew")
    .select("*")
    .in("display_name", ["R .JD", "Ryan Darcy"]);
  const loser = rows?.find((r) => r.display_name === "R .JD");
  const keeper = rows?.find((r) => r.display_name === "Ryan Darcy");
  if (!loser || !keeper) { console.log("rows:", JSON.stringify(rows, null, 1)); return; }

  for (const t of ["event_crew", "crew_faces", "crew_persons"]) {
    const { count } = await s.from(t).select("*", { count: "exact", head: true }).eq("crew_id", loser.id);
    console.log(`${t} on R .JD: ${count}`);
  }
  console.log("R .JD:", JSON.stringify({ email: loser.primary_email, city: loser.city, aliases: loser.aliases, archived: loser.archived, notes: loser.notes }));
  console.log("Ryan :", JSON.stringify({ email: keeper.primary_email, city: keeper.city, aliases: keeper.aliases, archived: keeper.archived, notes: keeper.notes }));

  if (!APPLY) { console.log("\n(dry run — pass --apply to merge)"); return; }

  for (const t of ["event_crew", "crew_faces", "crew_persons"]) {
    const { error } = await s.from(t).update({ crew_id: keeper.id }).eq("crew_id", loser.id);
    if (error) { console.log(`${t} move ERROR: ${error.message} — stopping before delete`); return; }
  }
  const patch: Record<string, unknown> = {
    aliases: [...new Set([...(keeper.aliases ?? []), "R .JD", ...(loser.aliases ?? [])])],
  };
  if (!keeper.primary_email && loser.primary_email) patch.primary_email = loser.primary_email;
  if (!keeper.city && loser.city) patch.city = loser.city;
  if (loser.notes && !keeper.notes) patch.notes = loser.notes;
  const { error: pErr } = await s.from("crew").update(patch).eq("id", keeper.id);
  if (pErr) { console.log("patch ERROR:", pErr.message); return; }
  const { error: dErr } = await s.from("crew").delete().eq("id", loser.id);
  console.log(dErr ? `delete ERROR: ${dErr.message}` : "merged ✓ — R .JD folded into Ryan Darcy");
}
main();
