/**
 * Read-only: thumbnails for a rank band of one rule from highlight-rules-probe's
 * report, to find where a rule's true hits stop.
 *   npx tsx scripts/triage/highlight-rules-band.ts <outDir> <rule> <from> <to> [step]
 */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [outDir, rule, fromA, toA, stepA] = process.argv.slice(2);
  const [from, to, step] = [Number(fromA), Number(toA), Number(stepA ?? 1)];
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")) as {
    scores: Record<string, Record<string, number>>;
    facts: Record<string, { r2: string }>;
  };
  const ranked = Object.keys(rep.scores).sort((a, b) => rep.scores[b][rule] - rep.scores[a][rule]);
  const dir = path.join(outDir, "band", rule);
  fs.mkdirSync(dir, { recursive: true });
  const picks: number[] = [];
  for (let i = from; i < Math.min(to, ranked.length); i += step) picks.push(i);
  await Promise.all(picks.map(async (i) => {
    const id = ranked[i];
    const buf = await getObjectBuffer(getThumbnailKey(rep.facts[id].r2), 5_000_000);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(4, "0")}_${rep.scores[id][rule].toFixed(3)}.jpg`), buf);
  }));
  console.log(rule, picks.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
