/**
 * Which 2024+ Pixieset collections actually EXIST in Dropbox?
 *
 * Written 2026-08-30 after Mason said he has been deleting Dropbox events to
 * reclaim space. The migration plan treats 2024+ as "safe, Dropbox-backed" and
 * therefore low priority — but that is a CLAIM about a durable record, and the
 * record just changed under us. A collection with no Dropbox folder is
 * Pixieset-only and belongs in the at-risk set no matter what year it is.
 *
 * Matching is date-first: Dropbox event folders are `YYMMDD Client Name`, so the
 * date is machine-readable and is the strongest signal. Name similarity only
 * breaks ties. Deliberately CONSERVATIVE — anything not confidently matched is
 * reported as UNCOVERED, because the cost of wrongly calling something safe is
 * losing it, while the cost of wrongly calling it at-risk is one extra download.
 */
import fs from "node:fs";
import path from "node:path";

const DB = path.join(process.env.HOME!, "Library/CloudStorage/Dropbox-TwoDudesPhoto/Two Dudes Photo Team Folder/_ARCHIVE");
const QUEUE = "scripts/pixieset/data/queue.json";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** every `YYMMDD Client` folder in Dropbox, with its parsed date */
function dropboxEvents() {
  const out: { date: string; name: string; norm: string; path: string }[] = [];
  for (const year of ["2023", "2024", "2025", "2026"]) {
    const ydir = path.join(DB, year);
    if (!fs.existsSync(ydir)) continue;
    for (const cat of fs.readdirSync(ydir)) {
      const cdir = path.join(ydir, cat);
      if (!fs.statSync(cdir).isDirectory()) continue;
      for (const ev of fs.readdirSync(cdir)) {
        const edir = path.join(cdir, ev);
        let st; try { st = fs.statSync(edir); } catch { continue; }
        if (!st.isDirectory()) continue;
        // YYMMDD or YMMDD-with-typo prefix
        const m = ev.match(/^(\d{5,6})[_ ]+(.*)$/);
        if (!m) { out.push({ date: "", name: ev, norm: norm(ev), path: edir }); continue; }
        const raw = m[1].padStart(6, "2");
        const date = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
        out.push({ date, name: m[2], norm: norm(m[2]), path: edir });
      }
    }
  }
  return out;
}

function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as {
    collections: Record<string, { slug: string; name: string; eventDate: string; year: number; state: string; photoCount: number }>;
  };
  const events = dropboxEvents();
  const byDate = new Map<string, typeof events>();
  for (const e of events) {
    if (!e.date) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  const recent = Object.values(q.collections)
    .filter((r) => ["queued", "failed"].includes(r.state) && (r.year ?? 0) >= 2024);

  let covered = 0, uncovered = 0, uncoveredPhotos = 0;
  const missing: { name: string; date: string; photos: number }[] = [];

  for (const c of recent) {
    const cn = norm(c.name);
    // exact date, then ±1 day (a shoot can straddle midnight / be filed a day off)
    const cands: typeof events = [];
    const d = new Date(c.eventDate + "T00:00:00");
    for (const off of [0, -1, 1]) {
      const dd = new Date(d.getTime() + off * 86400000).toISOString().slice(0, 10);
      cands.push(...(byDate.get(dd) ?? []));
    }
    const hit = cands.some((e) => {
      if (!e.norm || !cn) return false;
      return e.norm.includes(cn.slice(0, 8)) || cn.includes(e.norm.slice(0, 8));
    });
    if (hit) covered++;
    else {
      uncovered++;
      uncoveredPhotos += c.photoCount ?? 0;
      if (missing.length < 15) missing.push({ name: c.name.slice(0, 44), date: c.eventDate, photos: c.photoCount ?? 0 });
    }
  }

  console.log(`Dropbox event folders scanned: ${events.length}`);
  console.log(`2024+ Pixieset collections still queued: ${recent.length}`);
  console.log(`  covered by a Dropbox folder : ${covered}`);
  console.log(`  NO Dropbox folder found     : ${uncovered}  (${uncoveredPhotos.toLocaleString()} photos)`);
  if (missing.length) {
    console.log(`\nSample with no Dropbox match (conservative — verify before trusting):`);
    for (const m of missing) console.log(`  ${m.date}  ${String(m.photos).padStart(6)}  ${m.name}`);
  }
}
main();
