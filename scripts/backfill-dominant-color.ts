/**
 * Backfill images.dominant_color for photos uploaded before the G1 pipeline
 * (sharp stats now run at thumbnail time). Reads each image's SMALL thumbnail
 * (200px — plenty for a dominant hue), computes the color, updates the row.
 * Idempotent: only touches rows where dominant_color is null. Safe to re-run.
 *
 *   npx tsx scripts/backfill-dominant-color.ts           # all events
 *   npx tsx scripts/backfill-dominant-color.ts --dry     # count only
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const CONCURRENCY = 8;

async function main() {
  const sharp = (await import("sharp")).default;
  const { createServiceClient } = await import("@/lib/supabase/server");
  const { getPresignedDownloadUrl, getThumbnailKey } = await import("@/lib/r2/client");
  const supabase = createServiceClient();

  // Page through all rows missing a color.
  const rows: { id: string; r2_key: string }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await supabase
      .from("images")
      .select("id, r2_key")
      .eq("thumbnail_generated", true)
      .is("dominant_color", null)
      .order("id")
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`${rows.length} images need a dominant color`);
  if (process.argv.includes("--dry") || rows.length === 0) return;

  let done = 0;
  let failed = 0;
  const hex = (n: number) => n.toString(16).padStart(2, "0");

  const worker = async (queue: { id: string; r2_key: string }[]) => {
    for (;;) {
      const row = queue.pop();
      if (!row) return;
      try {
        // thumb-sm keys are jpg-normalized like all thumbnails
        const key = getThumbnailKey(row.r2_key, "thumb-sm");
        const url = await getPresignedDownloadUrl(key, 600);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`thumb fetch ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const { dominant } = await sharp(buf).stats();
        const color = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
        await supabase
          .from("images")
          .update({ dominant_color: color })
          .eq("id", row.id);
        done++;
        if (done % 250 === 0) console.log(`  ${done}/${rows.length}`);
      } catch {
        failed++;
      }
    }
  };

  const queue = [...rows];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`done: ${done} updated, ${failed} failed (missing thumbs are fine — placeholder falls back to stone)`);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
