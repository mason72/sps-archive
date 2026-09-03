/**
 * Scratch: full-resolution pixel diff of one DAIS frame across the two
 * copies. Mean absolute difference on 0–255 tells recompression (uniform,
 * tiny) from retouching (localised, large). Read-only.
 *
 *   npx tsx scripts/triage/dais-pair-pixeldiff.ts "<original_filename>"
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const name = process.argv[2];
  const sharp = (await import("sharp")).default;
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getObjectBuffer } = await import("../../src/lib/r2/client");
  const db = createServiceClient();
  const ids = ["f2fe3441-9f6c-4429-b8d1-e6a58be9fbb0", "26ca7bed-9ebb-4c09-b6b3-1f1f4021db75"];
  const rows = await Promise.all(ids.map(async (id) => {
    const { data } = await db.from("images").select("r2_key, file_size").eq("event_id", id).eq("original_filename", name).single();
    return data!;
  }));
  const bufs = await Promise.all(rows.map((r) => getObjectBuffer(r.r2_key, 60 * 1024 * 1024)));
  const raws = await Promise.all(bufs.map((b) => sharp(b).raw().toBuffer({ resolveWithObject: true })));
  const [a, b] = raws;
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw new Error("dims differ");
  let sum = 0, max = 0, over8 = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i++) { const d = Math.abs(a.data[i] - b.data[i]); sum += d; if (d > max) max = d; if (d > 8) over8++; }
  // JPEG quality estimate from quantisation: sharp exposes none, so report bytes.
  console.log(JSON.stringify({ name, dims: `${a.info.width}x${a.info.height}`, sps_bytes: rows[0].file_size, pix_bytes: rows[1].file_size, mean_abs_diff: +(sum / n).toFixed(3), max_diff: max, pct_pixels_over_8: +((over8 / n) * 100).toFixed(3) }));
})().catch((e) => { console.error(e); process.exit(1); });
