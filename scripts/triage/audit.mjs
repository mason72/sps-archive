#!/usr/bin/env node
/**
 * Audit the triage decisions for self-inconsistency.
 *
 * Leave-one-out: every decision is scored by a model trained on all the OTHER
 * manual decisions, so an item can never justify itself. Where that model
 * disagrees confidently with what you actually chose, the decision is worth a
 * second look — either you slipped, or the item is genuinely an exception.
 *
 *   node scripts/triage/audit.mjs [topN]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INV = JSON.parse(readFileSync(join(HERE, "data/inventory.json"), "utf8"));
const DEC = JSON.parse(readFileSync(join(HERE, "data/decisions.json"), "utf8"));
const TOP = Number(process.argv[2] || 12);

const STOP = new Set(["the","and","for","with","from","photos","photo","gallery","event",
  "day","final","edit","edits","images","pics","llc","inc","new","all"]);

// "CLIENT // DETAIL" vs "PERSON // CLIENT" — identical copy lives in app.html
const PERSON_RE = /^[A-Z][a-z]+(?:'s)?\s+(?:[A-Z]\.|[A-Z][a-z]+)(?:'s)?$/;
function clientKey(name) {
  const parts = name.split("//").map(s => s.trim()).filter(Boolean);
  let seg = parts[0] || name;
  if (parts.length > 1 && PERSON_RE.test(parts[0])) seg = parts[1];
  return seg.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter(t => t.length >= 3 && !STOP.has(t)).slice(0, 2).join(" ");
}

// must match app.html exactly, or the audit is measuring a different model
function feats(rec) {
  const [, name, date, photos] = rec;
  const clean = name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const toks = clean.split(" ").filter(t => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));
  const client = clientKey(name);
  const year = (date || "").slice(0, 4) || "unknown";
  const size = photos < 100 ? "tiny" : photos < 500 ? "small" : photos < 2000 ? "medium" : "large";
  const f = [`year:${year}`, `size:${size}`];
  if (client) {
    f.push(`client:${client}`);
    const head = client.split(" ")[0];
    if (head && head !== client) f.push(`client1:${head}`);
  }
  for (const t of toks) f.push(`tok:${t}`);
  return { list: f, client };
}

const byId = new Map(INV.map(r => [r[0], r]));
const manual = Object.entries(DEC)
  .filter(([id, d]) => d.via !== "auto" && byId.has(Number(id)))
  .map(([id, d]) => ({ rec: byId.get(Number(id)), verdict: d.verdict }));

// global counts
const cnt = { keep: new Map(), trash: new Map() };
const tot = { keep: 0, trash: 0 };
const docs = { keep: 0, trash: 0 };
const vocab = new Set();
for (const m of manual) {
  docs[m.verdict]++;
  for (const f of feats(m.rec).list) {
    cnt[m.verdict].set(f, (cnt[m.verdict].get(f) || 0) + 1);
    tot[m.verdict]++; vocab.add(f);
  }
}
const V = Math.max(vocab.size, 1), A = 1;

function scoreLOO(item) {
  const v = item.verdict;
  const fl = feats(item.rec).list;
  // remove this item's contribution
  for (const f of fl) cnt[v].set(f, cnt[v].get(f) - 1);
  tot[v] -= fl.length; docs[v]--;

  const n = docs.keep + docs.trash;
  let sK = Math.log((docs.keep + 1) / (n + 2));
  let sT = Math.log((docs.trash + 1) / (n + 2));
  const contrib = [];
  for (const f of fl) {
    const k = cnt.keep.get(f) || 0, t = cnt.trash.get(f) || 0;
    const pk = Math.log((k + A) / (tot.keep + A * V));
    const pt = Math.log((t + A) / (tot.trash + A * V));
    sK += pk; sT += pt;
    if (k + t > 0) contrib.push({ f, delta: pt - pk, k, t });
  }

  // restore
  for (const f of fl) cnt[v].set(f, cnt[v].get(f) + 1);
  tot[v] += fl.length; docs[v]++;

  const pTrash = 1 / (1 + Math.exp(sK - sT));
  contrib.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    pTrash,
    predicted: pTrash >= 0.5 ? "trash" : "keep",
    confidence: Math.abs(pTrash - 0.5) * 2,
    why: contrib.filter(c => (pTrash >= 0.5 ? c.delta > 0 : c.delta < 0)).slice(0, 3),
  };
}

const scored = manual.map(m => ({ ...m, s: scoreLOO(m) }));
const disagree = scored.filter(x => x.s.predicted !== x.verdict)
  .sort((a, b) => b.s.confidence - a.s.confidence);

const why = s => s.why.map(c =>
  `${c.f.replace(/^(tok|client|year|size):/, "")}(k${c.k}/t${c.t})`).join(" ");
const line = x => `  ${x.rec[2] || "????-??-??"}  ${String(x.rec[3]).padStart(5)}  ` +
  `${String(Math.round(x.s.confidence * 100)).padStart(3)}%  ${x.rec[1].slice(0, 46).padEnd(46)}  ${why(x.s)}`;

console.log(`${manual.length} manual decisions · ${docs.keep} keep / ${docs.trash} trash`);
console.log(`model disagrees with ${disagree.length} of them (${Math.round(disagree.length / manual.length * 100)}%)\n`);

const t2k = disagree.filter(x => x.verdict === "trash");
const k2t = disagree.filter(x => x.verdict === "keep");

console.log(`── You TRASHED, pattern says KEEP  (${t2k.length}) ──`);
console.log("  date          photos  conf  name                                            drivers");
t2k.slice(0, TOP).forEach(x => console.log(line(x)));

console.log(`\n── You KEPT, pattern says TRASH  (${k2t.length}) ──`);
console.log("  date          photos  conf  name                                            drivers");
k2t.slice(0, TOP).forEach(x => console.log(line(x)));

// client-level splits: strongest signal, so a lone outlier stands out
const byClient = new Map();
for (const m of manual) {
  const c = feats(m.rec).client;
  if (!c) continue;
  if (!byClient.has(c)) byClient.set(c, { keep: [], trash: [] });
  byClient.get(c)[m.verdict].push(m.rec);
}
const split = [...byClient.entries()]
  .filter(([, g]) => g.keep.length && g.trash.length)
  .map(([c, g]) => ({ c, g, minor: Math.min(g.keep.length, g.trash.length),
                      total: g.keep.length + g.trash.length }))
  .filter(x => x.minor / x.total <= 0.34)
  .sort((a, b) => (b.total - b.minor) - (a.total - a.minor));

console.log(`\n── Clients you split on, where one side is the clear outlier (${split.length}) ──`);
for (const { c, g } of split.slice(0, TOP)) {
  const odd = g.keep.length < g.trash.length ? "keep" : "trash";
  console.log(`  ${c.padEnd(24)} kept ${String(g.keep.length).padStart(2)} · trashed ${String(g.trash.length).padStart(2)}   odd ones out (${odd}):`);
  for (const r of g[odd].slice(0, 3)) console.log(`      ${r[2]}  ${String(r[3]).padStart(5)}  ${r[1].slice(0, 52)}`);
}
