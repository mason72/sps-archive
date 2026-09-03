/**
 * Scratch: two archive frames side by side, by original_filename, so a
 * "same person?" question is answered by looking. Writes a JPEG.
 *
 *   npx tsx scripts/triage/side-by-side.ts <eventId> "<left name>" "<right name>" <out.jpg>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const [eventId, leftName, rightName, out] = process.argv.slice(2);
  const sharp = (await import("sharp")).default;
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { getObjectBuffer, getThumbnailKey } = await import("../../src/lib/r2/client");
  const db = createServiceClient();
  const rows = await Promise.all([leftName, rightName].map(async (n) => {
    const { data } = await db.from("images").select("r2_key").eq("event_id", eventId).eq("original_filename", n).single();
    if (!data) throw new Error(`not found: ${n}`);
    return data.r2_key as string;
  }));
  const H = 900;
  const imgs = await Promise.all(rows.map(async (k) => sharp(await getObjectBuffer(getThumbnailKey(k, "thumb-lg"))).resize({ height: H }).toBuffer({ resolveWithObject: true })));
  const W = imgs[0].info.width + imgs[1].info.width + 24;
  await sharp({ create: { width: W, height: H, channels: 3, background: "#fff" } })
    .composite([{ input: imgs[0].data, left: 0, top: 0 }, { input: imgs[1].data, left: imgs[0].info.width + 24, top: 0 }])
    .jpeg({ quality: 88 }).toFile(out);
  console.log("wrote", out);
})().catch((e) => { console.error(e); process.exit(1); });
