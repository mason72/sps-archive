/** Read-only: how many DIFFERENT people an event's subject faces hold, by greedy
 * matching at FACE_MATCH_FLOOR (no clusters needed). Also lists picks' tags.
 *   npx tsx scripts/triage/distinct-faces.ts <eventId> */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [eventId] = process.argv.slice(2);
  const { createClient } = await import("@supabase/supabase-js");
  const { FACE_MATCH_FLOOR } = await import("../../src/lib/faces/calibration");
  const { isSubjectFace } = await import("../../src/lib/highlights/rules");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids: string[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await s.from("images").select("id").eq("event_id", eventId).order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map((r) => r.id));
    if (!data || data.length < 1000) break;
  }
  const byImage = new Map<string, { a: number; v: number[] }[]>();
  for (let i = 0; i < ids.length; i += 50) {
    for (let p = 0; ; p++) {
      const { data, error } = await s.from("faces").select("id, image_id, embedding, bbox_w, bbox_h").in("image_id", ids.slice(i, i + 50)).not("embedding", "is", null).order("id").range(p * 1000, p * 1000 + 999);
      if (error) throw error;
      for (const f of data ?? []) {
        const raw = JSON.parse(f.embedding as string) as number[];
        const n = Math.hypot(...raw);
        const arr = byImage.get(f.image_id) ?? [];
        arr.push({ a: (f.bbox_w ?? 0) * (f.bbox_h ?? 0), v: raw.map((x) => x / n) });
        byImage.set(f.image_id, arr);
      }
      if (!data || data.length < 1000) break;
    }
  }
  const people: number[][] = [];
  let subjects = 0;
  for (const faces of byImage.values()) {
    const largest = Math.max(...faces.map((f) => f.a));
    for (const f of faces) {
      if (!isSubjectFace(f.a, largest)) continue;
      subjects++;
      let hit = false;
      for (const c of people) {
        let d = 0; for (let k = 0; k < c.length; k++) d += c[k] * f.v[k];
        if (d >= FACE_MATCH_FLOOR) { hit = true; break; }
      }
      if (!hit) people.push(f.v);
    }
  }
  console.log(`photos ${ids.length}, photos with faces ${byImage.size}, subject faces ${subjects}, distinct people (greedy at ${FACE_MATCH_FLOOR}) ${people.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
