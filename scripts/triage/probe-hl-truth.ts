/** Read-only: do human-picked Highlights sections differ measurably from the rest? */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

type Row = { aesthetic_score: number | null; sharpness_score: number | null; id: string };

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: secs, error } = await s
    .from("sections")
    .select("id, name, event_id, is_auto, events!inner(name)")
    .ilike("name", "%highlight%");
  if (error) throw error;
  console.log("highlight-ish sections:", secs?.length);

  const results: {
    event: string;
    picked: number;
    total: number;
    pct: string;
    aPick?: string;
    aRest?: string;
    sPick?: string;
    sRest?: string;
    eyesPick?: string;
    eyesRest?: string;
  }[] = [];

  for (const sec of secs ?? []) {
    const { data: members } = await s
      .from("section_images")
      .select("image_id")
      .eq("section_id", sec.id)
      .limit(2000);
    const picked = new Set((members ?? []).map((m) => m.image_id as string));
    if (picked.size === 0) continue;

    // all indexed images in the event
    const all: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page } = await s
        .from("images")
        .select("id, aesthetic_score, sharpness_score")
        .eq("event_id", sec.event_id)
        .not("ai_indexed_at", "is", null)
        .range(from, from + 999);
      if (!page?.length) break;
      all.push(...(page as Row[]));
      if (page.length < 1000) break;
    }
    if (all.length < 20) continue;

    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
    const inSet = all.filter((r) => picked.has(r.id));
    const outSet = all.filter((r) => !picked.has(r.id));
    if (inSet.length < 5 || outSet.length < 5) continue;

    // eyes-open rate per image (fraction of images with >=1 face and all eyes open)
    const eyesRate = async (ids: string[]) => {
      if (!ids.length) return NaN;
      const sample = ids.slice(0, 300);
      const { data: faces } = await s
        .from("faces")
        .select("image_id, is_eyes_open")
        .in("image_id", sample);
      const byImg = new Map<string, boolean[]>();
      for (const f of faces ?? []) {
        const k = f.image_id as string;
        if (!byImg.has(k)) byImg.set(k, []);
        byImg.get(k)!.push(Boolean(f.is_eyes_open));
      }
      let withFaces = 0;
      let allOpen = 0;
      for (const [, arr] of byImg) {
        withFaces++;
        if (arr.every(Boolean)) allOpen++;
      }
      return withFaces ? allOpen / withFaces : NaN;
    };

    const ep = await eyesRate(inSet.map((r) => r.id));
    const er = await eyesRate(outSet.map((r) => r.id));

    results.push({
      event: String((sec as any).events?.name ?? sec.event_id).slice(0, 44),
      picked: inSet.length,
      total: all.length,
      pct: ((inSet.length / all.length) * 100).toFixed(1) + "%",
      aPick: mean(inSet.map((r) => r.aesthetic_score ?? NaN).filter((v) => !isNaN(v))).toFixed(4),
      aRest: mean(outSet.map((r) => r.aesthetic_score ?? NaN).filter((v) => !isNaN(v))).toFixed(4),
      sPick: mean(inSet.map((r) => r.sharpness_score ?? NaN).filter((v) => !isNaN(v))).toFixed(1),
      sRest: mean(outSet.map((r) => r.sharpness_score ?? NaN).filter((v) => !isNaN(v))).toFixed(1),
      eyesPick: isNaN(ep) ? "-" : (ep * 100).toFixed(0) + "%",
      eyesRest: isNaN(er) ? "-" : (er * 100).toFixed(0) + "%",
    });
  }

  console.table(results);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
