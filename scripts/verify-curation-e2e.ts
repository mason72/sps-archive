/**
 * Live E2E driver for the curation editor (one-off verification).
 *
 * Proves the editor's write path → site API read path end to end against the
 * live DB, using the exact column writes the PATCH routes perform plus the
 * real syncSitePublication for slot auto-focal. Self-restoring: every value
 * touched is recorded first and reset in a finally block.
 *
 *   1. featured-work: edit source-event city + image service/featured →
 *      curl the scene API (local dev server) → fields reflect → restore.
 *   2. slot auto-focal: add a single-confident-face image to a slot section
 *      at the END of the drag order (the live slot winner is untouched) →
 *      sync → focal_x/focal_y auto-filled → remove + restore.
 *
 *   npx tsx scripts/verify-curation-e2e.ts [apiBase]   # default http://localhost:3000
 */
import fs from "node:fs";

// Load .env.local before importing anything that reads process.env.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const API_BASE = process.argv[2] ?? "http://localhost:3000";
// "hero" is the populated pool in prod (featured-work is empty as of 2026-06).
const POOL_SCENE = "hero";
const SLOT_SCENE = "slot/slice-1";
const CITY_MARKER = "Verifyville";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function curlScene(key: string) {
  const res = await fetch(`${API_BASE}/api/site/scene/${key}`, {
    headers: { "X-SPS-Key": process.env.SPS_INTEGRATION_KEY! },
  });
  if (!res.ok) throw new Error(`scene ${key} → ${res.status}`);
  return res.json();
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { syncSitePublication } = await import("../src/lib/site/membership");
  const { computeAutoFocal } = await import("../src/lib/site/focal");

  // ── Part 1: pool metadata edit reflects in the scene API ─────────────────
  const { data: poolSection } = await supabase
    .from("sections")
    .select("id")
    .eq("site_scene_key", POOL_SCENE)
    .single();
  if (!poolSection) throw new Error(`no section for ${POOL_SCENE}`);

  const { data: members } = await supabase
    .from("section_images")
    .select("image_id")
    .eq("section_id", poolSection.id)
    .limit(1);
  if (!members?.length) throw new Error(`${POOL_SCENE} has no images to test with`);
  const imageId = members[0].image_id;

  const { data: img } = await supabase
    .from("images")
    .select("id, service, featured, event_id, events!event_id(name, city)")
    .eq("id", imageId)
    .single();
  if (!img) throw new Error("test image vanished");
  const event = img.events as unknown as { name: string; city: string | null };
  const original = {
    service: img.service as string | null,
    featured: img.featured as boolean,
    city: event.city,
  };
  console.log(`Pool test image ${imageId} (event "${event.name}", city ${JSON.stringify(original.city)})`);

  try {
    // The exact writes PATCH /api/images and PATCH /api/events perform.
    await supabase
      .from("images")
      .update({ service: "event-photography", featured: !original.featured })
      .eq("id", imageId);
    await supabase
      .from("events")
      .update({ city: CITY_MARKER })
      .eq("id", img.event_id);

    const scene = await curlScene(POOL_SCENE);
    const entry = (scene.images as Array<Record<string, unknown>>).find(
      (i) => i.id === imageId
    );
    check(`edited image present in ${POOL_SCENE} scene`, !!entry);
    if (entry) {
      check("city reflects the edit", entry.city === CITY_MARKER, entry.city);
      check(
        "service reflects the edit",
        entry.service === "event-photography",
        entry.service
      );
      check(
        "featured reflects the edit",
        entry.featured === !original.featured,
        entry.featured
      );
      check(
        "featured-first ordering holds",
        !original.featured
          ? (scene.images as Array<Record<string, unknown>>)[0].id === imageId ||
              (scene.images as Array<{ featured: boolean }>)[0].featured === true
          : true
      );
    }
  } finally {
    await supabase
      .from("images")
      .update({ service: original.service, featured: original.featured })
      .eq("id", imageId);
    await supabase
      .from("events")
      .update({ city: original.city })
      .eq("id", img.event_id);
  }

  const restored = await curlScene(POOL_SCENE);
  const restoredEntry = (restored.images as Array<Record<string, unknown>>).find(
    (i) => i.id === imageId
  );
  check(
    "pool image fully restored",
    restoredEntry?.city === original.city &&
      restoredEntry?.service === original.service &&
      restoredEntry?.featured === original.featured,
    restoredEntry
  );

  // ── Part 2: slot auto-focal on add ────────────────────────────────────────
  const { data: slotSection } = await supabase
    .from("sections")
    .select("id")
    .eq("site_scene_key", SLOT_SCENE)
    .single();
  if (!slotSection) throw new Error(`no section for ${SLOT_SCENE}`);

  // A displayable, unpublished, focal-less image with exactly one confident
  // face — found by scanning recent faces and verifying with computeAutoFocal.
  const { data: faceRows } = await supabase
    .from("faces")
    .select(
      "image_id, bbox_x, bbox_y, bbox_w, bbox_h, quality, images!inner(id, service, focal_x, site_published_at, thumbnail_generated)"
    )
    .gte("quality", 0.3)
    .limit(500);
  type FaceRow = {
    image_id: string;
    bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number;
    quality: number;
    images: {
      service: string | null;
      focal_x: number | null;
      site_published_at: string | null;
      thumbnail_generated: boolean;
    };
  };
  const byImage = new Map<string, FaceRow[]>();
  for (const row of (faceRows ?? []) as unknown as FaceRow[]) {
    if (
      row.images.focal_x !== null ||
      row.images.site_published_at !== null ||
      !row.images.thumbnail_generated
    )
      continue;
    const arr = byImage.get(row.image_id) ?? [];
    arr.push(row);
    byImage.set(row.image_id, arr);
  }
  let focalImageId: string | null = null;
  let expected: { x: number; y: number } | null = null;
  for (const [id, rows] of byImage) {
    // computeAutoFocal needs ALL the image's faces, including sub-bar ones.
    const { data: allFaces } = await supabase
      .from("faces")
      .select("bbox_x, bbox_y, bbox_w, bbox_h, quality")
      .eq("image_id", id);
    const focal = computeAutoFocal(allFaces ?? []);
    if (focal) {
      focalImageId = id;
      expected = focal;
      void rows;
      break;
    }
  }
  // Prod's faces table can be empty (the AI pipeline hasn't persisted face
  // data). The write path is still verifiable: seed one synthetic face row
  // for a test image and remove it in teardown.
  let syntheticFace = false;
  if (!focalImageId) {
    const { data: anyImg } = await supabase
      .from("images")
      .select("id")
      .is("focal_x", null)
      .is("site_published_at", null)
      .eq("thumbnail_generated", true)
      .limit(1)
      .single();
    if (anyImg) {
      focalImageId = anyImg.id;
      const bbox = { bbox_x: 0.4, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.15, quality: 0.6 };
      const { error: seedError } = await supabase
        .from("faces")
        .insert({ image_id: focalImageId, ...bbox });
      if (seedError) throw seedError;
      syntheticFace = true;
      expected = computeAutoFocal([bbox]);
      console.log("(faces table empty — seeded one synthetic face for the test)");
    }
  }

  if (!focalImageId || !expected) {
    console.log("⚠ no usable test image found — skipping slot test");
  } else {
    console.log(`Slot test image ${focalImageId}, expecting focal ${expected.x}/${expected.y}`);
    const originalService = (
      await supabase.from("images").select("service").eq("id", focalImageId).single()
    ).data?.service as string | null;

    try {
      // Same effect as POST /api/sections/[id]/images: membership at the end
      // of the drag order (the slot's live winner stays first), then sync.
      await supabase.from("section_images").insert({
        section_id: slotSection.id,
        image_id: focalImageId,
        sort_order: 9999,
      });
      const sync = await syncSitePublication(supabase as never, [focalImageId]);
      check("sync published the slot image", sync.published.includes(focalImageId), sync);

      const { data: after } = await supabase
        .from("images")
        .select("focal_x, focal_y")
        .eq("id", focalImageId)
        .single();
      check(
        `auto-focal wrote ${expected.x}/${expected.y}`,
        after?.focal_x === expected.x && after?.focal_y === expected.y,
        after
      );

      const slotScene = await curlScene(SLOT_SCENE);
      check(
        "slot scene still returns exactly its drag-order winner",
        slotScene.count <= 1 &&
          (slotScene.images as Array<{ id: string }>)[0]?.id !== focalImageId,
        slotScene.count
      );
    } finally {
      await supabase
        .from("section_images")
        .delete()
        .eq("section_id", slotSection.id)
        .eq("image_id", focalImageId);
      await syncSitePublication(supabase as never, [focalImageId]); // unpublish
      await supabase
        .from("images")
        .update({ focal_x: null, focal_y: null, service: originalService })
        .eq("id", focalImageId);
      if (syntheticFace) {
        await supabase.from("faces").delete().eq("image_id", focalImageId);
      }
    }

    const { data: final } = await supabase
      .from("images")
      .select("focal_x, focal_y, service, site_published_at")
      .eq("id", focalImageId)
      .single();
    check(
      "slot image fully restored",
      final?.focal_x === null &&
        final?.focal_y === null &&
        final?.service === originalService &&
        final?.site_published_at === null,
      final
    );
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
