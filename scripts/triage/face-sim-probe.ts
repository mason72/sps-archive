/** Read-only: ArcFace similarity between the largest faces of a pick list, to calibrate "same person".
 *   npx tsx scripts/triage/face-sim-probe.ts <picks.json> <reportDir> */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [picksPath, dir] = process.argv.slice(2);
  const ids = JSON.parse(fs.readFileSync(picksPath, "utf8")) as string[];
  const rep = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) as { facts: Record<string, { name: string | null; file: string }> };
  const { createClient } = await import("@supabase/supabase-js");
  const { isPersonLike } = await import("../../src/lib/sections/auto-plan");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await s.from("faces").select("image_id, person_id, embedding, bbox_w, bbox_h").in("image_id", ids).not("embedding", "is", null);
  if (error) throw error;
  const best = new Map<string, { a: number; v: number[]; p: string | null }>();
  for (const f of data ?? []) {
    const a = (f.bbox_w ?? 0) * (f.bbox_h ?? 0);
    if ((best.get(f.image_id)?.a ?? -1) >= a) continue;
    const raw = JSON.parse(f.embedding as string) as number[];
    const n = Math.hypot(...raw);
    best.set(f.image_id, { a, v: raw.map((x) => x / n), p: f.person_id });
  }
  const pairs: { sim: number; a: string; b: string }[] = [];
  const keys = [...best.keys()];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const x = best.get(keys[i])!.v, y = best.get(keys[j])!.v;
    let d = 0; for (let k = 0; k < x.length; k++) d += x[k] * y[k];
    pairs.push({ sim: d, a: rep.facts[keys[i]].file, b: rep.facts[keys[j]].file });
  }
  pairs.sort((p, q) => q.sim - p.sim);
  console.log("top pairs:"); for (const p of pairs.slice(0, 8)) console.log(p.sim.toFixed(3), p.a, "|", p.b);
  const luna = keys.filter((k) => /^Luna/.test(rep.facts[k].file));
  console.log("Luna person ids:", luna.map((k) => best.get(k)!.p), "isPersonLike(Luna):", isPersonLike("Luna"));
}
main().catch((e) => { console.error(e); process.exit(1); });
