/**
 * Live E2E driver for the v2 website content model (one-off verification).
 *
 * Exercises the EXACT production code paths (syncSitePublication + R2 lane)
 * against the live DB and bucket; the deployed scene API verifies the read
 * side in between (curled from the shell, see tasks/todo.md handoff notes).
 *
 *   npx tsx scripts/verify-site-v2.ts setup              # add + publish + focal
 *   npx tsx scripts/verify-site-v2.ts teardown <idA> <idB>  # remove + unpublish
 */
import fs from "node:fs";

// Load .env.local before importing anything that reads process.env.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const POOL_SCENE = "service/photo-booth";
const SLOT_SCENE = "slot/slice-1";

async function main() {
  const mode = process.argv[2];
  if (mode !== "setup" && mode !== "teardown") {
    console.error("usage: tsx scripts/verify-site-v2.ts setup|teardown");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  // Type-compatible enough for the sync (it only uses from()).
  const { syncSitePublication } = await import("../src/lib/site/membership");
  const { publicLaneKeys } = await import("../src/lib/site/publish");

  const { data: sections, error: sectionsError } = await supabase
    .from("sections")
    .select("id, site_scene_key")
    .in("site_scene_key", [POOL_SCENE, SLOT_SCENE]);
  if (sectionsError || sections?.length !== 2) {
    throw new Error(`sections lookup failed: ${JSON.stringify(sectionsError ?? sections)}`);
  }
  const poolSectionId = sections.find((s) => s.site_scene_key === POOL_SCENE)!.id;
  const slotSectionId = sections.find((s) => s.site_scene_key === SLOT_SCENE)!.id;

  // Two test images. Setup picks fresh displayable, unpublished images from
  // real (non-website) events; teardown gets the same two ids via argv.
  let imgA: { id: string; r2_key: string };
  let imgB: { id: string; r2_key: string };
  if (mode === "setup") {
    const { data: candidates, error: candError } = await supabase
      .from("images")
      .select("id, r2_key, events!event_id(name, city, slug)")
      .eq("thumbnail_generated", true)
      .is("site_published_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    if (candError) throw candError;
    const usable = (candidates ?? []).filter(
      (c) => (c.events as { slug?: string } | null)?.slug !== "tdp-website"
    );
    if (usable.length < 2) throw new Error("need 2 candidate images");
    [imgA, imgB] = usable;
  } else {
    const ids = [process.argv[3], process.argv[4]];
    if (!ids[0] || !ids[1]) throw new Error("teardown needs <idA> <idB>");
    const { data: rows, error } = await supabase
      .from("images")
      .select("id, r2_key")
      .in("id", ids);
    if (error || rows?.length !== 2) throw new Error("teardown images not found");
    imgA = rows.find((r) => r.id === ids[0])!;
    imgB = rows.find((r) => r.id === ids[1])!;
  }

  if (mode === "setup") {
    // Pool membership: imgA → Photo Booth. Slot membership: imgB (order 0,
    // the winner) + imgA (order 1, must be ignored) → Slice 01.
    const { error: insErr } = await supabase.from("section_images").upsert(
      [
        { section_id: poolSectionId, image_id: imgA.id, sort_order: 9000 },
        { section_id: slotSectionId, image_id: imgB.id, sort_order: 0 },
        { section_id: slotSectionId, image_id: imgA.id, sort_order: 1 },
      ],
      { onConflict: "section_id,image_id" }
    );
    if (insErr) throw insErr;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sync = await syncSitePublication(supabase as any, [imgA.id, imgB.id]);
    if (sync.failed.length > 0) throw new Error(`publish failed: ${sync.failed}`);

    // Focal point on the slot winner (what the picker UI would PATCH).
    const { error: focalErr } = await supabase
      .from("images")
      .update({ focal_x: 33.3, focal_y: 25 })
      .eq("id", imgB.id);
    if (focalErr) throw focalErr;

    console.log(
      JSON.stringify(
        {
          published: sync.published,
          imgA: { id: imgA.id, ...publicLaneKeys(imgA.r2_key) },
          imgB: { id: imgB.id, ...publicLaneKeys(imgB.r2_key) },
        },
        null,
        2
      )
    );
    return;
  }

  // teardown
  const { error: delErr } = await supabase
    .from("section_images")
    .delete()
    .in("section_id", [poolSectionId, slotSectionId])
    .in("image_id", [imgA.id, imgB.id]);
  if (delErr) throw delErr;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sync = await syncSitePublication(supabase as any, [imgA.id, imgB.id]);
  const { error: clearErr } = await supabase
    .from("images")
    .update({ focal_x: null, focal_y: null })
    .eq("id", imgB.id);
  if (clearErr) throw clearErr;

  const { data: after } = await supabase
    .from("images")
    .select("id, site_published_at")
    .in("id", [imgA.id, imgB.id]);
  console.log(
    JSON.stringify(
      {
        unpublished: sync.unpublished,
        failed: sync.failed,
        markers: after,
        imgA: { id: imgA.id, ...publicLaneKeys(imgA.r2_key) },
        imgB: { id: imgB.id, ...publicLaneKeys(imgB.r2_key) },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
