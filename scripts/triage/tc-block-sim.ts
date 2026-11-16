/** Read-only diagnostic: run selectMoments on one event's colour frames with
 * real subject faces, then say why each unpicked candidate is blocked.
 *   npx tsx scripts/triage/tc-block-sim.ts <eventId> <reportDir> <count> */
import fs from "node:fs";
import path from "node:path";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [eventId, dir, countA] = process.argv.slice(2);
  const { createClient } = await import("@supabase/supabase-js");
  const { groupIntoMoments, selectMoments } = await import("../../src/lib/highlights/moments");
  const { bwSiblings, isSubjectFace, GROUP_SHOT_FACES } = await import("../../src/lib/highlights/rules");
  const { FACE_MATCH_FLOOR } = await import("../../src/lib/faces/calibration");
  const rep = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) as { scores: Record<string, Record<string, number>> };
  const times = new Map((JSON.parse(fs.readFileSync(path.join(dir, "times.json"), "utf8")) as { id: string; taken_at: string | null }[]).map((r) => [r.id, r.taken_at]));
  const ids = Object.keys(rep.scores);
  const sib = bwSiblings(ids.map((id) => ({ id, capture: times.get(id) ?? null, bw: rep.scores[id].bw })));
  const kept = ids.filter((id) => !sib.has(id));
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const vecs = new Map<string, number[][]>();
  for (let i = 0; i < kept.length; i += 50) {
    const { data, error } = await s.from("faces").select("image_id, embedding, bbox_w, bbox_h").in("image_id", kept.slice(i, i + 50)).not("embedding", "is", null);
    if (error) throw error;
    const by = new Map<string, { a: number; v: number[] }[]>();
    for (const f of data ?? []) {
      const raw = JSON.parse(f.embedding as string) as number[]; const n = Math.hypot(...raw);
      const arr = by.get(f.image_id) ?? []; arr.push({ a: (f.bbox_w ?? 0) * (f.bbox_h ?? 0), v: raw.map((x) => x / n) }); by.set(f.image_id, arr);
    }
    for (const [id, fs2] of by) {
      const L = Math.max(...fs2.map((f) => f.a));
      vecs.set(id, fs2.filter((f) => isSubjectFace(f.a, L)).sort((a, b) => b.a - a.a).map((f) => f.v));
    }
  }
  const moments = groupIntoMoments(kept.map((id) => ({
    id, takenAt: times.get(id) ?? null, score: 0,
    tags: (vecs.get(id)?.length ?? 0) >= GROUP_SHOT_FACES ? ["group"] : [],
  })));
  const count = Number(countA);
  const picked = selectMoments(moments, count, { onePerPerson: true, facesOf: (m) => vecs.get(m.frames[m.bestIndex].id), samePerson: FACE_MATCH_FLOOR, variety: 0.5 });
  const chosenVecs = picked.flatMap((m) => vecs.get(m.frames[m.bestIndex].id) ?? []);
  const reasons: Record<string, number> = {};
  const subjCounts: number[] = [];
  for (const m of moments) {
    if (picked.includes(m)) continue;
    const vs = vecs.get(m.frames[m.bestIndex].id);
    if (!vs?.length) { reasons["no faces"] = (reasons["no faces"] ?? 0) + 1; continue; }
    subjCounts.push(vs.length);
    const matched = vs.filter((v) => chosenVecs.some((c) => c.reduce((a, x, k) => a + x * v[k], 0) >= FACE_MATCH_FLOOR)).length;
    const group = vs.length >= GROUP_SHOT_FACES;
    const key = group ? `group ${matched}/${vs.length} seen` : `solo/pair ${matched}/${vs.length} seen`;
    const bucket = matched === 0 ? "NOT blocked by faces" : group ? (matched * 2 > vs.length ? "group: majority seen" : "group: minority seen") : "solo/pair: someone seen";
    reasons[bucket] = (reasons[bucket] ?? 0) + 1; void key;
  }
  console.log("moments", moments.length, "picked", picked.length, "of", count);
  console.log("unpicked by reason:", reasons);
  console.log("subject faces per unpicked moment (hist):", subjCounts.reduce((h: Record<number, number>, n) => ((h[n] = (h[n] ?? 0) + 1), h), {}));
}
main().catch((e) => { console.error(e); process.exit(1); });
