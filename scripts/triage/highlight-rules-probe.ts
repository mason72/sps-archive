/**
 * Read-only: score every photo in one event against plain-English "rule"
 * phrases (SigLIP text vs image), so a Highlights veto can be judged on what it
 * actually catches before it is built. Writes a JSON report + the top hits per
 * rule; contact sheets are made from that report separately.
 *
 *   npx tsx scripts/triage/highlight-rules-probe.ts <eventId> <outDir>
 *
 * Writes nothing to the database. The Modal embed call is not metered
 * (userId null), it is one request for all phrases.
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const RULES: Record<string, string> = {
  bw: "a black and white photo",
  color: "a color photo",
  glasses: "a person touching their eyeglasses with their hand",
  profile: "a side profile view of a person's face",
  back: "a person photographed from behind, facing away",
  gear: "photography lighting equipment, a softbox or umbrella",
  robot: "a robot",
  mascot: "a person wearing a mascot costume",
  covered: "a person covering their face with their hands",
  hidden: "a person hiding their face behind an object",
  // A control: something no headshot event should match much.
  control_beach: "a sandy beach with ocean waves",
};

async function main() {
  const [eventId, outDir] = process.argv.slice(2);
  if (!eventId || !outDir) throw new Error("usage: <eventId> <outDir>");
  fs.mkdirSync(outDir, { recursive: true });

  const { createClient } = await import("@supabase/supabase-js");
  const { embedTexts } = await import("../../src/lib/ai-index/embed-text");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: ev, error: evErr } = await s.from("events").select("user_id").eq("id", eventId).single();
  if (evErr) throw evErr;

  const keys = Object.keys(RULES);
  const vecs = await embedTexts(keys.map((k) => RULES[k]), { userId: null, purpose: "scene_plan" });

  const scores: Record<string, Record<string, number>> = {};
  for (const [ki, k] of keys.entries()) {
    for (let page = 0; ; page++) {
      const { data, error } = await s
        .rpc("score_images_by_embedding", {
          query_embedding: JSON.stringify(vecs[ki]),
          target_user_id: ev.user_id,
          target_event_id: eventId,
        })
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const r of (data ?? []) as { id: string; similarity: number }[]) {
        (scores[r.id] ??= {})[k] = r.similarity;
      }
      if (!data || data.length < 1000) break;
    }
  }

  // Image facts: name, faces, r2 key for thumbnails.
  const ids = Object.keys(scores).sort();
  const facts: Record<string, { name: string | null; file: string; r2: string; faces: number }> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await s.from("images").select("id, parsed_name, original_filename, r2_key").in("id", chunk);
    if (error) throw error;
    for (const r of data ?? []) facts[r.id] = { name: r.parsed_name, file: r.original_filename, r2: r.r2_key, faces: 0 };
    const { data: f, error: fErr } = await s.from("faces").select("image_id").in("image_id", chunk);
    if (fErr) throw fErr;
    for (const r of f ?? []) facts[r.image_id].faces++;
  }

  const report: Record<string, unknown> = { eventId, photos: ids.length, rules: RULES, perRule: {} };
  for (const k of keys) {
    const vals = ids.map((id) => scores[id][k]).sort((a, b) => a - b);
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    const top = ids
      .map((id) => ({ id, s: scores[id][k], ...facts[id] }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 24);
    (report.perRule as Record<string, unknown>)[k] = {
      p50: q(0.5), p90: q(0.9), p99: q(0.99), max: vals[vals.length - 1], top,
    };
    console.log(`${k.padEnd(14)} p50 ${q(0.5).toFixed(3)}  p90 ${q(0.9).toFixed(3)}  p99 ${q(0.99).toFixed(3)}  max ${vals[vals.length - 1].toFixed(3)}`);
  }
  const faceHist: Record<string, number> = {};
  for (const id of ids) { const n = Math.min(facts[id].faces, 4); faceHist[n === 4 ? "4+" : String(n)] = (faceHist[n === 4 ? "4+" : String(n)] ?? 0) + 1; }
  report.faceHist = faceHist;
  console.log("faces per photo:", faceHist);
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ ...report, scores, facts }, null, 0));
  console.log("wrote", path.join(outDir, "report.json"));
}

main().catch((e) => { console.error(e); process.exit(1); });
