/**
 * Split-proposal preview on live data (READ-ONLY, applies nothing).
 * Runs the same engine the resolve route uses and prints the proposed camps.
 *
 *   npx tsx scripts/verify-split-proposal.ts <personId>
 *   npx tsx scripts/verify-split-proposal.ts --find <eventId>   # list candidates
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { proposeSplit } = await import("../src/lib/faces/split");
  const { extractPersonName } = await import("../src/lib/gallery/stacks");
  const { isPersonLike } = await import("../src/lib/sections/auto-plan");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (process.argv[2] === "--find") {
    const { data } = await supabase
      .from("persons")
      .select("id, name, face_count")
      .eq("event_id", process.argv[3])
      .is("name", null)
      .order("face_count", { ascending: false })
      .limit(10);
    for (const p of data ?? []) console.log(`${p.id}  unnamed · ${p.face_count}`);
    return;
  }

  const personId = process.argv[2];
  if (!personId) throw new Error("usage: verify-split-proposal.ts <personId>");

  const faces: Parameters<typeof proposeSplit>[0] = [];
  const filenameOf = new Map<string, string>();
  for (let page = 0; ; page++) {
    const { data: rows } = await supabase
      .from("faces")
      .select("id, image_id, embedding, quality, images!inner(original_filename)")
      .eq("person_id", personId)
      .not("embedding", "is", null)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    for (const r of rows ?? []) {
      faces.push({
        id: r.id,
        imageId: r.image_id,
        embedding: JSON.parse(r.embedding as unknown as string),
        quality: r.quality,
      });
      filenameOf.set(
        r.image_id,
        (r.images as unknown as { original_filename: string }).original_filename
      );
    }
    if (!rows || rows.length < 1000) break;
  }
  console.log(`${faces.length} faces loaded`);

  const p = proposeSplit(faces, filenameOf, extractPersonName, isPersonLike);
  if (!p) {
    console.log("no split proposed (looks like one person)");
    return;
  }
  console.log(`basis: ${p.basis}`);
  for (const g of p.groups) {
    const sample = g.faceIds
      .slice(0, 3)
      .map((id) => filenameOf.get(faces.find((f) => f.id === id)!.imageId));
    console.log(
      `  "${g.seedName ?? "(unnamed)"}" — ${g.faceIds.length} faces  e.g. ${sample.join(", ")}`
    );
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
