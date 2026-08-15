/**
 * Is "all regulars are photographers" true of the live roster?
 *
 * Mason asserted it (2026-08-15) as the reason to drop the role pill for
 * regulars. Hiding a control on a false premise silently mislabels people, so
 * it gets checked against the data rather than taken on trust.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const db = createServiceClient() as any;
  const { data, error } = await db
    .from("crew")
    .select("display_name, kind, is_regular, archived, can_lead, travels");
  if (error) throw error;
  const active = data.filter((c: any) => !c.archived);
  const regs = active.filter((c: any) => c.is_regular);
  const byKind: Record<string, number> = {};
  for (const r of regs) byKind[r.kind ?? "(null)"] = (byKind[r.kind ?? "(null)"] ?? 0) + 1;
  console.log("active:", active.length, "· regulars:", regs.length);
  console.log("regular kinds:", byKind);
  const nonPhoto = regs.filter((r: any) => r.kind !== "photographer");
  console.log(
    "regulars NOT photographers:",
    nonPhoto.map((r: any) => `${r.display_name} (${r.kind})`).join(", ") || "none"
  );
  const nk: Record<string, number> = {};
  for (const r of active.filter((c: any) => !c.is_regular))
    nk[r.kind ?? "(null)"] = (nk[r.kind ?? "(null)"] ?? 0) + 1;
  console.log("non-regular kinds:", nk);
}
main().catch((e) => { console.error(e); process.exit(1); });
