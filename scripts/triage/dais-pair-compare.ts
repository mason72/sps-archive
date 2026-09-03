/**
 * Scratch: put one same-named DAIS frame from each copy side by side —
 * SPS pull (left) vs Pixieset ingest (right) — so "are these the same
 * photo?" is answered by looking, not by file size. Writes a JPEG to the
 * path given as argv[2]. Read-only against R2.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const out = process.argv[2];
  const sharp = (await import("sharp")).default;
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const db = createServiceClient();
  const SPS = "f2fe3441-9f6c-4429-b8d1-e6a58be9fbb0", PIX = "26ca7bed-9ebb-4c09-b6b3-1f1f4021db75";
  const { data: a } = await db.from("images").select("original_filename, r2_key, file_size, width, height").eq("event_id", SPS).order("original_filename").limit(3000);
  const names = new Set((a ?? []).map((r) => r.original_filename));
  const { data: b } = await db.from("images").select("original_filename, r2_key, file_size, width, height").eq("event_id", PIX).order("original_filename").limit(9000);
  const pick = (b ?? []).find((r) => names.has(r.original_filename) && !r.original_filename.includes(".jpg_"));
  if (!pick) throw new Error("no same-named pair in the first pages");
  const left = (a ?? []).find((r) => r.original_filename === pick.original_filename)!;
  console.log(JSON.stringify({ name: pick.original_filename, sps: { bytes: left.file_size, w: left.width, h: left.height }, pixieset: { bytes: pick.file_size, w: pick.width, h: pick.height } }));
  const [lb, rb] = await Promise.all([getObjectBuffer(getThumbnailKey(left.r2_key, "thumb-lg")), getObjectBuffer(getThumbnailKey(pick.r2_key, "thumb-lg"))]);
  const H = 900;
  const [L, R] = await Promise.all([lb, rb].map((buf) => sharp(buf).resize({ height: H }).toBuffer({ resolveWithObject: true })));
  const W = L.info.width + R.info.width + 24;
  await sharp({ create: { width: W, height: H, channels: 3, background: "#fff" } })
    .composite([{ input: L.data, left: 0, top: 0 }, { input: R.data, left: L.info.width + 24, top: 0 }])
    .jpeg({ quality: 88 }).toFile(out);
  console.log("wrote", out);
})().catch((e) => { console.error(e); process.exit(1); });
