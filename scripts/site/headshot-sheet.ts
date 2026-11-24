/**
 * A numbered contact sheet of a gallery's best headshots, ranked the way
 * Mason approved on 2026-11-23 ("these are much better - please make sure to
 * use this going forward"): the Highlights picker's headshot path, i.e.
 * likeness to his curated website headshots, the rule bans, glasses-grabs
 * capped, one frame per person.
 *
 *   npx tsx scripts/site/headshot-sheet.ts <eventId> <count> <outDir>
 *
 * Writes <outDir>/sheet.html (open it, numbered in rank order) and
 * <outDir>/picks.json (the ordered image ids). READ-ONLY: nothing is written
 * to the gallery, a section, or the site. The eye pass that follows is still
 * a person's job: cut chin-in-hand and hand-at-lapel poses, looking away,
 * tiny-in-frame, then show Mason the sheet before anything is published.
 * A gallery that is not headshot-led ranks by the learned direction instead;
 * the script says which it used.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const [eventId, countArg, outDir] = process.argv.slice(2);
  const count = Number(countArg);
  if (!eventId || !Number.isInteger(count) || count < 1 || count > 200 || !outDir) {
    throw new Error("usage: headshot-sheet.ts <eventId> <count 1-200> <outDir>");
  }
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { proposeHighlights } = await import("../../src/lib/highlights/propose");
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const s = createServiceClient();

  const { data: ev, error } = await s.from("events").select("user_id, name").eq("id", eventId).single();
  if (error || !ev) throw new Error(`Gallery not found: ${error?.message ?? eventId}`);

  const r = await proposeHighlights(s, eventId, ev.user_id as string, { count, coverage: true, poolExtra: 0 });
  const picks = r.proposals.slice(0, count).map((p) => p.frames[p.chosenIndex]);
  console.log(`${ev.name}: ${picks.length} picks, ranked by ${r.ranker === "headshots" ? "Mason's website headshots" : r.ranker}`);

  fs.mkdirSync(outDir, { recursive: true });
  const tiles: string[] = [];
  for (let i = 0; i < picks.length; i += 6) {
    const batch = await Promise.all(
      picks.slice(i, i + 6).map(async (f) => {
        const buf = await getObjectBuffer(getThumbnailKey(f.r2Key, "thumb-md"));
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      })
    );
    batch.forEach((src, k) =>
      tiles.push(`<figure><img src="${src}" alt=""><figcaption>${i + k + 1}</figcaption></figure>`)
    );
  }
  const title = `${ev.name}: ${picks.length} headshots`.replace(/[<>&"]/g, "");
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px Inter,system-ui,sans-serif;margin:32px;background:#fafaf9;color:#0c0a09}
h1{font-size:20px;margin:0 0 4px}p{color:#78716c;margin:0 0 20px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
figure{margin:0}img{width:100%;aspect-ratio:3/4;object-fit:cover;object-position:top;display:block}
figcaption{font-weight:600;padding-top:4px}</style>
<h1>${title}</h1><p>Ranked by ${r.ranker === "headshots" ? "likeness to the curated website headshots" : `the ${r.ranker} ranker`}. Number 1 is the suggested cover. Eye pass before publishing.</p>
<main>${tiles.join("")}</main>`;
  fs.writeFileSync(path.join(outDir, "sheet.html"), html);
  fs.writeFileSync(path.join(outDir, "picks.json"), JSON.stringify(picks.map((f) => f.id), null, 1));
  console.log(`wrote ${path.join(outDir, "sheet.html")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
