#!/usr/bin/env node
/**
 * Flip the "lone series gap" trashes back to keep.
 *
 * A trashed gallery qualifies when its client has 2+ keeps, the trashes don't
 * outnumber them, and there is NO kept sibling within 2 days — that last test
 * is what separates a genuine gap in a recurring series from the booth half of
 * a paired job (booth trashed, "Event Photos" kept, same client same day).
 *
 *   node scripts/triage/apply-reconsider.mjs          # dry run
 *   node scripts/triage/apply-reconsider.mjs --write  # back up, then apply
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEC_PATH = join(HERE, "data/decisions.json");
const INV = JSON.parse(readFileSync(join(HERE, "data/inventory.json"), "utf8"));
const DEC = JSON.parse(readFileSync(DEC_PATH, "utf8"));
const WRITE = process.argv.includes("--write");

const STOP = new Set(["the","and","for","with","from","photos","photo","gallery","event",
  "day","final","edit","edits","images","pics","llc","inc","new","all"]);
const PERSON_RE = /^[A-Z][a-z]+\s+[A-Z]\.?$/;
const GENERIC = new Set(["power","annual","holiday","team","class","party","summit","conference",
  "reunion","sales","national","marketing","tech","group","san","company","corporate","test","golden"]);

function clientKey(name) {
  const p = name.split("//").map(s => s.trim()).filter(Boolean);
  let seg = p[0] || name;
  if (p.length > 1 && PERSON_RE.test(p[0])) seg = p[1];
  return seg.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(t => t.length >= 3 && !STOP.has(t)).slice(0, 2).join(" ");
}

const byId = new Map(INV.map(r => [r[0], r]));
const groups = new Map();
for (const [id, d] of Object.entries(DEC)) {
  const rec = byId.get(Number(id));
  if (!rec) continue;
  const head = clientKey(rec[1]).split(" ")[0];
  if (!head || GENERIC.has(head)) continue;
  if (!groups.has(head)) groups.set(head, { keep: [], trash: [] });
  groups.get(head)[d.verdict].push(rec);
}

const flips = [];
for (const [head, g] of groups) {
  if (g.keep.length < 2 || !g.trash.length || g.trash.length > g.keep.length) continue;
  for (const rec of g.trash) {
    const paired = g.keep.some(k =>
      Math.abs(new Date(k[2]) - new Date(rec[2])) <= 2 * 864e5);
    if (!paired) flips.push({ rec, head, keeps: g.keep.length, total: g.keep.length + g.trash.length });
  }
}
flips.sort((a, b) => b.rec[3] - a.rec[3]);

console.log(`${WRITE ? "APPLYING" : "DRY RUN"} — ${flips.length} galleries, ` +
  `${flips.reduce((s, f) => s + f.rec[3], 0).toLocaleString()} photos\n`);
for (const f of flips)
  console.log(`  ${String(f.rec[3]).padStart(5)}  ${f.rec[2]}  ${f.rec[1].slice(0, 48).padEnd(48)} (${f.head} ${f.keeps}/${f.total})`);

if (!WRITE) { console.log("\nre-run with --write to apply"); process.exit(0); }

const backup = DEC_PATH.replace(/\.json$/, `.backup.json`);
copyFileSync(DEC_PATH, backup);

let changed = 0;
for (const f of flips) {
  const d = DEC[f.rec[0]];
  if (d && d.verdict === "trash") {
    d.verdict = "keep";
    d.via = "reconsider";
    changed++;
  }
}
writeFileSync(DEC_PATH, JSON.stringify(DEC, null, 2), "utf8");

const vals = Object.values(DEC);
let kp = 0, tp = 0, k = 0, t = 0;
for (const [id, d] of Object.entries(DEC)) {
  const rec = byId.get(Number(id)); if (!rec) continue;
  d.verdict === "keep" ? (k++, kp += rec[3]) : (t++, tp += rec[3]);
}
console.log(`\nflipped ${changed} · backup at ${backup.split("/").pop()}`);
console.log(`KEEP  ${k} collections · ${kp.toLocaleString()} photos`);
console.log(`TRASH ${t} collections · ${tp.toLocaleString()} photos`);
