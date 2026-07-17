/**
 * Live E2E for face-aware cover crops (one-off verification).
 *
 * On the sandbox event ("Two Dudes Sample(s)"):
 *   1. ensureAutoFocal over the mosaic pool leads — real Modal detection for
 *      unscanned images, faces persisted, eye-level focal_x/focal_y written
 *      (fill-nulls contract; costs ~pennies of Modal compute).
 *   2. Assert single-subject images got focals and group shots did not.
 *   3. Compose the mosaic raster and save it for eyeballing — tiles should
 *      center faces instead of top-biasing.
 *
 * Focal writes are kept (they're correct data under the same contract the
 * editor sweep uses); cover settings are stashed/restored.
 *
 *   npx tsx scripts/verify-cover-focal.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const OUT_DIR =
  process.env.COVER_QA_OUT ??
  "/private/tmp/claude-502/-Users-mjfoster-Documents-Projects-SPS-sps-archive/3fb41ae0-d219-4c68-a23a-d252d363c1dd/scratchpad";

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { fetchMosaicPool, poolLeads } = await import("../src/lib/cover/pool");
  const { ensureAutoFocal } = await import("../src/lib/faces/ensure-focal");
  const { isFaceDetectionConfigured } = await import("../src/lib/faces/detect");
  const { composeCoverRaster } = await import("../src/lib/cover/raster");
  const r2 = await import("../src/lib/r2/client");

  if (!isFaceDetectionConfigured()) throw new Error("FACE_PIPELINE_URL not set");
  const supabase = createServiceClient();

  const { data: candidates } = await supabase
    .from("events")
    .select("id, name, settings")
    .or("name.ilike.%sample%,name.ilike.%test%")
    .order("created_at", { ascending: false })
    .limit(10);
  let target: NonNullable<typeof candidates>[number] | null = null;
  for (const ev of candidates ?? []) {
    if ((await fetchMosaicPool(ev.id, undefined)).length >= 12) {
      target = ev;
      break;
    }
  }
  if (!target) throw new Error("No sandbox event with a usable pool");
  const eventId = target.id;
  console.log(`Sandbox event: "${target.name}" (${eventId})`);

  // ── 1. Ensure focals over the pool leads ──
  const leadsBefore = poolLeads(await fetchMosaicPool(eventId, undefined));
  const withFocalBefore = leadsBefore.filter((l) => l.focal_x != null).length;
  console.log(
    `Pool: ${leadsBefore.length} leads, ${withFocalBefore} already have focals`
  );

  const written = await ensureAutoFocal(
    supabase,
    leadsBefore.map((l) => ({ id: l.id, r2_key: l.r2_key })),
    { scanCap: 40 }
  );
  console.log(`ensureAutoFocal wrote ${written} focal points`);

  // ── 2. Assert the single-subject rule held ──
  const leadsAfter = poolLeads(await fetchMosaicPool(eventId, undefined));
  const withFocal = leadsAfter.filter((l) => l.focal_x != null);
  console.log(`Leads with focals now: ${withFocal.length}/${leadsAfter.length}`);
  for (const l of withFocal.slice(0, 5)) {
    console.log(`  ${l.original_filename}: focal (${l.focal_x}, ${l.focal_y})`);
  }
  const { data: faceCounts } = await supabase
    .from("faces")
    .select("image_id, quality")
    .in("image_id", leadsAfter.map((l) => l.id));
  const strong = new Map<string, number>();
  for (const f of faceCounts ?? []) {
    if (f.quality >= 0.3) strong.set(f.image_id, (strong.get(f.image_id) ?? 0) + 1);
  }
  for (const l of withFocal) {
    if ((strong.get(l.id) ?? 0) !== 1) {
      throw new Error(`${l.id} has a focal but ${strong.get(l.id) ?? 0} strong faces`);
    }
  }
  console.log("✓ every written focal corresponds to exactly one confident face");

  // ── 3. Compose the raster with focal-aware tile crops ──
  const stash = target.settings ?? {};
  const settings = {
    ...(stash as Record<string, unknown>),
    cover: {
      enabled: true,
      type: "mosaic",
      titlePosition: "over",
      titleAlignment: "center",
      mosaic: {
        rows: 3,
        seed: 11,
        logoMode: "none",
        overlay: { color: "#1C1917", opacity: 0.75, blur: false },
        insert: { padding: 15, fill: "#FFFFFF" },
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from("events").update({ settings: settings as any }).eq("id", eventId);
  try {
    const key = await composeCoverRaster(eventId);
    if (!key) throw new Error("compose returned null");
    const buf = await r2.getObjectBuffer(key);
    const out = `${OUT_DIR}/cover-focal-mosaic.jpg`;
    fs.writeFileSync(out, buf);
    console.log(`✓ focal-aware raster composed → ${out}`);
    await r2.deleteFromR2(key).catch(() => {});
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from("events").update({ settings: stash as any }).eq("id", eventId);
  }
  console.log("Settings restored. All green.");
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
