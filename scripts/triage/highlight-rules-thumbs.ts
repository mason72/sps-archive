/**
 * Read-only companion to highlight-rules-probe.ts: download the thumb-md of the
 * top N hits per rule (plus the no-face and 3+-face photos) into
 * <outDir>/<rule>/NN_<score>.jpg, for contact sheets.
 *
 *   npx tsx scripts/triage/highlight-rules-thumbs.ts <outDir> [N]
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

type Facts = Record<string, { name: string | null; file: string; r2: string; faces: number }>;

async function main() {
  const [outDir, nArg] = process.argv.slice(2);
  const n = Number(nArg ?? 12);
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8")) as {
    perRule: Record<string, { top: { id: string; s: number }[] }>;
    facts: Facts;
  };
  const groups: Record<string, { id: string; label: string }[]> = {};
  for (const [rule, r] of Object.entries(rep.perRule)) {
    groups[rule] = r.top.slice(0, n).map((t) => ({ id: t.id, label: t.s.toFixed(3) }));
  }
  const ids = Object.keys(rep.facts);
  groups.noface = ids.filter((id) => rep.facts[id].faces === 0).slice(0, n).map((id) => ({ id, label: "0f" }));
  groups.group3 = ids.filter((id) => rep.facts[id].faces >= 3).slice(0, n).map((id) => ({ id, label: `${rep.facts[id].faces}f` }));

  for (const [g, list] of Object.entries(groups)) {
    const dir = path.join(outDir, "thumbs", g);
    fs.mkdirSync(dir, { recursive: true });
    await Promise.all(
      list.map(async (it, i) => {
        const key = getThumbnailKey(rep.facts[it.id].r2);
        try {
          const buf = await getObjectBuffer(key, 5_000_000);
          fs.writeFileSync(path.join(dir, `${String(i).padStart(2, "0")}_${it.label}.jpg`), buf);
        } catch (e) {
          console.error(g, it.id, (e as Error).message);
        }
      })
    );
    console.log(g, list.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
