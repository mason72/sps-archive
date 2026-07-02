/**
 * Live E2E driver for the favorites digest (one-off verification).
 *
 * Seeds favorites 3h in the past on the "Two Dudes Sample Images" share,
 * runs the EXACT production pipeline (findDigestCandidates → sendShareDigest),
 * which sends a real digest email to the event owner, then proves idempotence
 * (second run finds nothing) and cleans up.
 *
 *   npx tsx scripts/verify-favorites-digest.ts          # full E2E + cleanup
 *   npx tsx scripts/verify-favorites-digest.ts --keep   # demo: leave the
 *     seeded favorites in place so the email's preview images keep resolving
 *     (fav-thumb only serves images with a live favorite row).
 */
import fs from "node:fs";

// Load .env.local before importing anything that reads process.env.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const SLUG = "ltDeK9JV2p";
const SEED_COUNT = 6; // > preview cap of 4, so the "and N more" line renders

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { findDigestCandidates, sendShareDigest } = await import(
    "../src/lib/favorites/digest-send"
  );

  const supabase = createServiceClient();
  const now = new Date();

  // 1. Resolve share + some of its event's images
  const { data: share } = await supabase
    .from("shares")
    .select("id, event_id, digested_at")
    .eq("slug", SLUG)
    .single();
  if (!share) throw new Error("sample share not found");

  const { data: images } = await supabase
    .from("images")
    .select("id")
    .eq("event_id", share.event_id)
    .eq("thumbnail_generated", true)
    .limit(SEED_COUNT);
  if (!images || images.length < SEED_COUNT) throw new Error("not enough images");

  // 2. Seed favorites 3h in the past (past the 2h quiet window)
  const threeHoursAgo = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const { error: seedError } = await supabase.from("favorites").insert(
    images.map((img) => ({
      share_id: share.id,
      image_id: img.id,
      created_at: threeHoursAgo,
    }))
  );
  if (seedError) throw seedError;
  console.log(`seeded ${SEED_COUNT} favorites @ ${threeHoursAgo}`);

  try {
    // 3. Run the production pipeline
    const candidates = await findDigestCandidates(supabase, now);
    const mine = candidates.find((c) => c.shareId === share.id);
    console.log(
      `candidates: ${candidates.length}; sample share included: ${!!mine}; new: ${mine?.newImageIds.length}; preview: ${mine?.previewImageIds.length}`
    );
    if (!mine) throw new Error("sample share not selected as candidate");

    const result = await sendShareDigest(supabase, mine, now);
    console.log(`send result: ${result}`);

    // 4. Watermark advanced + second run is empty for this share
    const { data: after } = await supabase
      .from("shares")
      .select("digested_at")
      .eq("id", share.id)
      .single();
    console.log(`digested_at set: ${!!after?.digested_at}`);

    const again = await findDigestCandidates(supabase, new Date());
    console.log(
      `second run includes share: ${again.some((c) => c.shareId === share.id)} (want false)`
    );
  } finally {
    if (process.argv.includes("--keep")) {
      console.log("--keep: seed favorites left in place (email images stay live)");
    } else {
      // 5. Cleanup: remove seeds, restore watermark
      await supabase.from("favorites").delete().eq("share_id", share.id);
      await supabase
        .from("shares")
        .update({ digested_at: share.digested_at })
        .eq("id", share.id);
      console.log("cleaned up (seed favorites removed, digested_at restored)");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
