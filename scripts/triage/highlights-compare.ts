/**
 * Compare two saved pick lists (highlights-propose-probe output) on what Justin
 * and Mason asked for: repeats per person, rule hits, group/glasses counts, and
 * face variety (mean pairwise ArcFace similarity of each pick's largest face;
 * lower = more varied). Rule scores come from highlight-rules-probe's report.
 *   npx tsx scripts/triage/highlights-compare.ts <reportDir> <a.json> <b.json>
 */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [dir, aPath, bPath] = process.argv.slice(2);
  const { createClient } = await import("@supabase/supabase-js");
  const { buildStacks } = await import("../../src/lib/gallery/stacks");
  const { RULE_KEYS, eventCutoffs } = await import("../../src/lib/highlights/rules");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rep = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) as {
    scores: Record<string, Record<string, number>>;
    facts: Record<string, { name: string | null; file: string; faces: number }>;
  };
  const cut = eventCutoffs(Object.values(rep.scores));
  for (const p of [aPath, bPath]) {
    const ids = JSON.parse(fs.readFileSync(p, "utf8")) as string[];
    const stacks = buildStacks(ids.map((id) => ({ id, parsedName: rep.facts[id].name, originalFilename: rep.facts[id].file })));
    const repeats = stacks.filter((st) => st.images.length > 1).map((st) => `${st.personName} x${st.images.length}`);
    const hits: Record<string, number> = {};
    for (const id of ids) {
      if (rep.facts[id].faces === 0) hits["no-face"] = (hits["no-face"] ?? 0) + 1;
      if (rep.facts[id].faces >= 3) hits.group = (hits.group ?? 0) + 1;
      for (const k of RULE_KEYS) if ((rep.scores[id]?.[k] ?? -1) >= cut[k]) hits[k] = (hits[k] ?? 0) + 1;
    }
    const vec = new Map<string, number[]>();
    const area = new Map<string, number>();
    const { data, error } = await s.from("faces").select("image_id, embedding, bbox_w, bbox_h").in("image_id", ids).not("embedding", "is", null);
    if (error) throw error;
    for (const f of data ?? []) {
      const a = (f.bbox_w ?? 0) * (f.bbox_h ?? 0);
      if ((area.get(f.image_id) ?? -1) >= a) continue;
      const raw = JSON.parse(f.embedding as string) as number[];
      const n = Math.hypot(...raw);
      vec.set(f.image_id, raw.map((x) => x / n));
      area.set(f.image_id, a);
    }
    const vs = [...vec.values()];
    let sum = 0, pairs = 0;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      let d = 0; for (let k = 0; k < vs[i].length; k++) d += vs[i][k] * vs[j][k];
      sum += d; pairs++;
    }
    console.log(`\n${path.basename(p)}: ${ids.length} picks, ${stacks.length} distinct names`);
    console.log("  repeats:", repeats.length ? repeats.join(", ") : "none");
    console.log("  rule hits:", JSON.stringify(hits));
    console.log("  mean face similarity:", (sum / pairs).toFixed(4), `(${vs.length} faces)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
