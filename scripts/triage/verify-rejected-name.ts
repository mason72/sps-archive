/**
 * Proof for migration 063: the unnamed NASAI cluster whose files all say
 * "Jenna Wombles" must produce a consensus name AND have it blocked by the
 * rejection — i.e. the auto-namer would have refilled it, and now cannot.
 *
 *   npx tsx scripts/triage/verify-rejected-name.ts
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { consensusName, nameIsRejected } = await import("../../src/lib/faces/cluster-event");
  const { extractPersonName } = await import("../../src/lib/gallery/stacks");
  const { isPersonLike } = await import("../../src/lib/sections/auto-plan");
  const supabase = createServiceClient();

  const { data: p, error } = await supabase
    .from("persons")
    .select("id, name, rejected_names")
    .eq("id", "ef814dcc-96ad-4eb6-88c8-21a76cf98c67")
    .single();
  if (error) throw error;
  console.log(`cluster: name=${JSON.stringify(p.name)} rejected=${JSON.stringify(p.rejected_names)}`);

  const { data: faces } = await supabase
    .from("faces")
    .select("image_id, images!inner(original_filename)")
    .eq("person_id", p.id)
    .order("id")
    .range(0, 999);
  const filenameOf = new Map<string, string>();
  for (const f of faces ?? []) {
    filenameOf.set(f.image_id, (f.images as unknown as { original_filename: string }).original_filename);
  }
  const consensus = consensusName([...filenameOf.keys()], filenameOf, extractPersonName, isPersonLike);
  console.log(`consensus the auto-namer would reach: ${JSON.stringify(consensus)}`);
  const blocked = consensus ? nameIsRejected(consensus, p.rejected_names ?? []) : false;
  console.log(`blocked by rejection: ${blocked}`);
  const pass = p.name === null && consensus !== null && blocked;
  console.log(pass ? "\n✅ PASS — the refill fires and the rejection stops it" : "\n❌ FAIL");
  if (!pass) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
