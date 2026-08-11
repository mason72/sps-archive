/**
 * Group an event into MOMENTS (branded twins + burst frames collapse into one),
 * then emit a manifest. Read-only.
 *
 *   npx tsx scripts/triage/moments.ts <eventId> [--calibrate]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

type Img = {
  id: string;
  r2_key: string;
  taken_at: string;
  aesthetic_score: number | null;
  sharpness_score: number | null;
  width: number | null;
  height: number | null;
  emb: Float32Array | null;
};

function parseEmb(raw: unknown): Float32Array | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return Float32Array.from(raw as number[]);
  if (typeof raw === "string") {
    const t = raw.trim().replace(/^\[|\]$/g, "");
    if (!t) return null;
    const parts = t.split(",");
    const out = new Float32Array(parts.length);
    for (let i = 0; i < parts.length; i++) out[i] = Number(parts[i]);
    return out;
  }
  return null;
}

function cos(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function main() {
  const eventId = process.argv[2];
  const calibrate = process.argv.includes("--calibrate");
  if (!eventId) throw new Error("usage: moments.ts <eventId>");

  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const imgs: Img[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await s
      .from("images")
      .select("id, r2_key, taken_at, aesthetic_score, sharpness_score, width, height, siglip_embedding")
      .eq("event_id", eventId)
      .not("ai_indexed_at", "is", null)
      .order("taken_at")
      .range(from, from + 499);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data as any[])
      imgs.push({
        id: r.id,
        r2_key: r.r2_key,
        taken_at: r.taken_at,
        aesthetic_score: r.aesthetic_score,
        sharpness_score: r.sharpness_score,
        width: r.width,
        height: r.height,
        emb: parseEmb(r.siglip_embedding),
      });
    if (data.length < 500) break;
  }
  console.log(`loaded ${imgs.length} indexed images (${imgs.filter((i) => i.emb).length} with embeddings)`);
  if (!imgs.length) return;

  // consecutive-pair similarity, for threshold calibration
  const pairs: { sim: number; dt: number }[] = [];
  for (let i = 1; i < imgs.length; i++) {
    const a = imgs[i - 1];
    const b = imgs[i];
    if (!a.emb || !b.emb) continue;
    pairs.push({
      sim: cos(a.emb, b.emb),
      dt: (new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime()) / 1000,
    });
  }
  const sims = pairs.map((p) => p.sim).sort((x, y) => x - y);
  const q = (p: number) => sims[Math.floor((sims.length - 1) * p)];
  console.log("consecutive-pair cosine:", {
    n: sims.length,
    min: q(0)?.toFixed(3),
    p10: q(0.1)?.toFixed(3),
    p25: q(0.25)?.toFixed(3),
    p50: q(0.5)?.toFixed(3),
    p75: q(0.75)?.toFixed(3),
    p90: q(0.9)?.toFixed(3),
    max: q(1)?.toFixed(3),
  });
  const same = pairs.filter((p) => p.dt === 0).map((p) => p.sim).sort((a, b) => a - b);
  if (same.length)
    console.log("same-timestamp pairs (branded twins):", {
      n: same.length,
      min: same[0].toFixed(3),
      p50: same[Math.floor(same.length / 2)].toFixed(3),
      max: same[same.length - 1].toFixed(3),
    });
  if (calibrate) {
    for (const th of [0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
      let groups = 1;
      for (const p of pairs) if (!(p.sim >= th && p.dt <= 12)) groups++;
      console.log(`  threshold ${th} (dt<=12s) → ${groups} moments`);
    }
    return;
  }

  // Grouping key: EXACT capture time, not embedding similarity.
  // On a fixed-backdrop shoot SigLIP encodes the set, so branded twins (0.918
  // median cosine) are indistinguishable from unrelated frames (0.915) — the
  // distributions overlap almost entirely. taken_at separates them exactly.
  // Consecutive groups merge only on a very high similarity bar AND ≤2s.
  const TH = Number(process.env.MOMENT_TH ?? 0.97);
  const DT = Number(process.env.MOMENT_DT ?? 2);
  const moments: Img[][] = [];
  let cur: Img[] = [imgs[0]];
  for (let i = 1; i < imgs.length; i++) {
    const a = imgs[i - 1];
    const b = imgs[i];
    const dt = (new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime()) / 1000;
    const sim = a.emb && b.emb ? cos(a.emb, b.emb) : 0;
    const sameCapture = dt === 0;
    if (sameCapture || (sim >= TH && dt <= DT)) cur.push(b);
    else {
      moments.push(cur);
      cur = [b];
    }
  }
  moments.push(cur);
  console.log(`→ ${moments.length} moments from ${imgs.length} files (exact taken_at, merge th=${TH}, dt=${DT}s)`);
  const sizes = moments.map((m) => m.length).sort((a, b) => b - a);
  console.log("largest moments:", sizes.slice(0, 12).join(", "));

  const manifest = moments.map((m, i) => {
    // representative: sharpest, then best aesthetic
    const rep = [...m].sort(
      (x, y) =>
        (y.sharpness_score ?? 0) - (x.sharpness_score ?? 0) ||
        (y.aesthetic_score ?? 0) - (x.aesthetic_score ?? 0)
    )[0];
    return {
      moment: i,
      frames: m.length,
      taken_at: m[0].taken_at,
      rep_id: rep.id,
      rep_key: rep.r2_key,
      orientation: (rep.width ?? 0) > (rep.height ?? 0) ? "landscape" : "portrait",
      ids: m.map((x) => x.id),
    };
  });
  const out = `scripts/triage/data/moments-${eventId}.json`;
  fs.mkdirSync("scripts/triage/data", { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 1));
  console.log("wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
