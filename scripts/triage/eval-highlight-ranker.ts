/**
 * Does ANY ranker predict what a photographer actually picks?
 *
 * Leave-one-event-out over the 12 events that already carry hand-picked
 * Highlights sections. Train a "highlight direction" in SigLIP space on 11
 * events, score the held-out event, and measure precision@k where k is that
 * photographer's real pick count. Compared against two baselines: random, and
 * ranking by aesthetic_score.
 *
 * The one thing that makes this honest: embeddings are CENTERED PER EVENT
 * before anything is learned. SigLIP encodes the scene, so an uncentered model
 * learns "which event is this" — which scores well for entirely the wrong
 * reason and collapses on a new shoot.
 *
 *   npx tsx scripts/triage/eval-highlight-ranker.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/** Cap on unpicked images sampled per event — keeps the pull tractable. */
const MAX_NEG_PER_EVENT = 700;
const DIM = 1152;

type Img = { id: string; emb: Float32Array; picked: boolean; aesthetic: number | null };
type Ev = { id: string; name: string; imgs: Img[]; picks: number };

function parseEmb(raw: unknown): Float32Array | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return Float32Array.from(raw as number[]);
  if (typeof raw === "string") {
    const t = raw.trim().replace(/^\[|\]$/g, "");
    if (!t) return null;
    const parts = t.split(",");
    if (parts.length !== DIM) return null;
    const out = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) out[i] = +parts[i];
    return out;
  }
  return null;
}

function meanVec(vs: Float32Array[]): Float32Array {
  const m = new Float32Array(DIM);
  for (const v of vs) for (let i = 0; i < DIM; i++) m[i] += v[i];
  if (vs.length) for (let i = 0; i < DIM; i++) m[i] /= vs.length;
  return m;
}

function centered(v: Float32Array, mu: Float32Array): Float32Array {
  const o = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) o[i] = v[i] - mu[i];
  return o;
}

function dot(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < DIM; i++) d += a[i] * b[i];
  return d;
}

function norm(a: Float32Array): number {
  return Math.sqrt(dot(a, a)) || 1;
}

function cos(a: Float32Array, b: Float32Array): number {
  return dot(a, b) / (norm(a) * norm(b));
}

/** Fraction of the top-k that are real picks. */
function precisionAtK(scored: { s: number; picked: boolean }[], k: number): number {
  const top = [...scored].sort((a, b) => b.s - a.s).slice(0, k);
  return top.filter((t) => t.picked).length / (k || 1);
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: secs, error: secErr } = await s
    .from("sections")
    .select("id, event_id, events!inner(name)")
    .ilike("name", "%highlight%");
  if (secErr) throw secErr;

  const events: Ev[] = [];
  for (const sec of secs ?? []) {
    const { data: members, error: mErr } = await s
      .from("section_images")
      .select("image_id")
      .eq("section_id", sec.id)
      .limit(3000);
    if (mErr) throw mErr;
    const picked = new Set((members ?? []).map((m) => m.image_id as string));
    if (picked.size < 5) continue;

    // Positives: every picked image. Negatives: a capped random sample.
    const imgs: Img[] = [];
    const pickedIds = [...picked];
    for (let i = 0; i < pickedIds.length; i += 100) {
      const { data, error } = await s
        .from("images")
        .select("id, siglip_embedding, aesthetic_score")
        .in("id", pickedIds.slice(i, i + 100))
        .not("ai_indexed_at", "is", null);
      if (error) throw error;
      for (const r of data ?? []) {
        const e = parseEmb((r as any).siglip_embedding);
        if (e) imgs.push({ id: r.id as string, emb: e, picked: true, aesthetic: r.aesthetic_score });
      }
    }

    const negs: Img[] = [];
    for (let from = 0; negs.length < MAX_NEG_PER_EVENT; from += 200) {
      const { data, error } = await s
        .from("images")
        .select("id, siglip_embedding, aesthetic_score")
        .eq("event_id", sec.event_id)
        .not("ai_indexed_at", "is", null)
        .range(from, from + 199);
      if (error) throw error;
      if (!data?.length) break;
      for (const r of data) {
        if (picked.has(r.id as string)) continue;
        const e = parseEmb((r as any).siglip_embedding);
        if (e) negs.push({ id: r.id as string, emb: e, picked: false, aesthetic: r.aesthetic_score });
        if (negs.length >= MAX_NEG_PER_EVENT) break;
      }
      if (data.length < 200) break;
    }

    const name = String((sec as any).events?.name ?? sec.event_id).slice(0, 34);
    if (imgs.length < 5 || negs.length < 20) {
      console.log(`skip ${name}: ${imgs.length} pos / ${negs.length} neg`);
      continue;
    }
    events.push({ id: sec.event_id as string, name, imgs: [...imgs, ...negs], picks: imgs.length });
    console.log(`loaded ${name}: ${imgs.length} picked, ${negs.length} sampled unpicked`);
  }

  console.log(`\n${events.length} events, ${events.reduce((a, e) => a + e.picks, 0)} human picks\n`);

  // Per-event centering: remove the scene, keep whatever is left.
  const centeredByEvent = new Map<string, Img[]>();
  for (const ev of events) {
    const mu = meanVec(ev.imgs.map((i) => i.emb));
    centeredByEvent.set(
      ev.id,
      ev.imgs.map((i) => ({ ...i, emb: centered(i.emb, mu) }))
    );
  }

  const rows: Record<string, string | number>[] = [];
  let sumLearned = 0;
  let sumLearnedRaw = 0;
  let sumRandom = 0;
  let sumAesthetic = 0;

  for (const held of events) {
    // Direction learned from the OTHER events only.
    const dirs: Float32Array[] = [];
    for (const tr of events) {
      if (tr.id === held.id) continue;
      const c = centeredByEvent.get(tr.id)!;
      const pos = c.filter((i) => i.picked).map((i) => i.emb);
      const neg = c.filter((i) => !i.picked).map((i) => i.emb);
      if (!pos.length || !neg.length) continue;
      const mp = meanVec(pos);
      const mn = meanVec(neg);
      const d = new Float32Array(DIM);
      for (let i = 0; i < DIM; i++) d[i] = mp[i] - mn[i];
      const n = norm(d);
      for (let i = 0; i < DIM; i++) d[i] /= n;
      dirs.push(d);
    }
    const dir = meanVec(dirs);

    const c = centeredByEvent.get(held.id)!;
    const k = held.picks;
    const base = k / c.length;

    const learned = precisionAtK(
      c.map((i) => ({ s: cos(i.emb, dir), picked: i.picked })),
      k
    );
    // Same direction, but scored against RAW embeddings — what the existing
    // score_images_by_embedding RPC does. If this holds up, serving needs no
    // new migration; if it collapses, centering has to happen server-side.
    const rawImgs = events.find((e) => e.id === held.id)!.imgs;
    const learnedRaw = precisionAtK(
      rawImgs.map((i) => ({ s: cos(i.emb, dir), picked: i.picked })),
      k
    );
    const aesthetic = precisionAtK(
      c.map((i) => ({ s: i.aesthetic ?? 0, picked: i.picked })),
      k
    );
    // Random baseline == base rate, in expectation.
    const random = base;

    sumLearned += learned;
    sumLearnedRaw += learnedRaw;
    sumRandom += random;
    sumAesthetic += aesthetic;

    rows.push({
      event: held.name,
      pool: c.length,
      picks: k,
      "random%": (random * 100).toFixed(1),
      "aesthetic%": (aesthetic * 100).toFixed(1),
      "learned%": (learned * 100).toFixed(1),
      "raw%": (learnedRaw * 100).toFixed(1),
      lift: (learned / (random || 1)).toFixed(2) + "x",
    });
  }

  console.table(rows);
  const n = events.length;
  console.log("MEAN precision@k —", {
    random: ((sumRandom / n) * 100).toFixed(1) + "%",
    aesthetic: ((sumAesthetic / n) * 100).toFixed(1) + "%",
    learned: ((sumLearned / n) * 100).toFixed(1) + "%",
    learnedRawScoring: ((sumLearnedRaw / n) * 100).toFixed(1) + "%",
    lift: (sumLearned / sumRandom).toFixed(2) + "x",
    liftRaw: (sumLearnedRaw / sumRandom).toFixed(2) + "x",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
