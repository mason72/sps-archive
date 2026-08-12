/**
 * Regenerate thumbnails for one event, driving the same generateThumbnails()
 * the admin route uses. Needed after a byte repair: the cached renditions were
 * rendered from the WRONG original, so they must be rebuilt or the gallery
 * keeps serving the old picture.
 *
 * The gallery filters on thumbnail_generated = true, so rows sit hidden (not
 * wrong) until this finishes — the safe way round.
 *
 * Usage: npx tsx scripts/triage/regen-thumbnails.ts <eventId>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const eventId = process.argv[2];
  if (!eventId) {
    console.error("usage: regen-thumbnails.ts <eventId>");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { generateThumbnails } = await import("../../src/lib/thumbnails/generate");

  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: pending, error } = await s
    .from("images")
    .select("id, r2_key, filename, event_id, original_filename")
    .eq("event_id", eventId)
    .eq("thumbnail_generated", false);
  if (error) throw error;

  const todo = pending ?? [];
  console.log(`${todo.length} images need thumbnails\n`);

  let done = 0;
  let failed = 0;
  const failures: string[] = [];
  let cursor = 0;

  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= todo.length) return;
        const img = todo[i];
        try {
          const thumbs = await generateThumbnails(
            img.r2_key,
            img.event_id,
            img.filename
          );
          const { error: upErr } = await s
            .from("images")
            .update({
              thumbnail_generated: true,
              thumb_bytes: thumbs.thumbBytes,
              ...(thumbs.width ? { width: thumbs.width } : {}),
              ...(thumbs.height ? { height: thumbs.height } : {}),
              ...(thumbs.dominantColor
                ? { dominant_color: thumbs.dominantColor }
                : {}),
            })
            .eq("id", img.id);
          if (upErr) throw upErr;
          done++;
        } catch (e) {
          failed++;
          failures.push(`${img.original_filename}: ${(e as Error).message}`);
        }
        if ((done + failed) % 100 === 0)
          process.stdout.write(`  …${done + failed}/${todo.length}\n`);
      }
    })
  );

  console.log(`\nregenerated: ${done}`);
  console.log(`failed:      ${failed}`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
