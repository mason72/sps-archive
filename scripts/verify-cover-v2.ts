/**
 * Live E2E driver for Cover System v2 (one-off verification).
 *
 * Proves the raster pipeline + settings model against the live DB and R2,
 * self-restoring. Finds a *test* event (name contains "test", case-
 * insensitive), then:
 *
 *   1. Uploads a generated "TEST CO" logo as the event's cover logo.
 *   2. mosaic/overlay  → composeCoverRaster → assert 1600×900 JPEG in R2
 *      with a matching inputs-hash, download to scratch for eyeballing.
 *   3. mosaic/insert   → same assertions.
 *   4. solid gradient  → same assertions.
 *   5. resolveCoverRasterUrl returns a fetchable URL for the fresh raster.
 *
 * Modes:
 *   npx tsx scripts/verify-cover-v2.ts            # full run, restores settings
 *   npx tsx scripts/verify-cover-v2.ts --hold     # leaves mosaic/overlay set (browser QA)
 *   npx tsx scripts/verify-cover-v2.ts --restore  # restore settings + delete artifacts
 */
import fs from "node:fs";

// Load .env.local before importing anything that reads process.env.
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const OUT_DIR =
  process.env.COVER_QA_OUT ??
  "/private/tmp/claude-502/-Users-mjfoster-Documents-Projects-SPS-sps-archive/3fb41ae0-d219-4c68-a23a-d252d363c1dd/scratchpad";

const HOLD = process.argv.includes("--hold");
const RESTORE_ONLY = process.argv.includes("--restore");
const STASH = `${OUT_DIR}/cover-v2-original-settings.json`;

async function main() {
  const sharp = (await import("sharp")).default;
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { composeCoverRaster } = await import("../src/lib/cover/raster");
  const { coverRasterKey, coverInputsHash, fetchMosaicPool, poolLeads } =
    await import("../src/lib/cover/pool");
  const { normalizeCoverSettings } = await import("../src/types/event-settings");
  const r2 = await import("../src/lib/r2/client");

  const supabase = createServiceClient();

  // ── Find the sandbox event (the "Two Dudes Sample(s)" galleries) ──
  const { data: candidates } = await supabase
    .from("events")
    .select("id, name, user_id, settings")
    .or("name.ilike.%sample%,name.ilike.%test%")
    .order("created_at", { ascending: false })
    .limit(10);
  if (!candidates?.length) throw new Error("No sample/test event found");

  let target: (typeof candidates)[number] | null = null;
  for (const ev of candidates) {
    const pool = await fetchMosaicPool(ev.id, undefined);
    if (pool.length >= 12) {
      target = ev;
      break;
    }
  }
  if (!target) throw new Error("No test event with ≥12 sectioned images");
  const eventId = target.id;
  console.log(`Test event: "${target.name}" (${eventId})`);

  const logoKey = `events/${eventId}/branding/cover-logo.png`;
  const rasterKey = coverRasterKey(eventId);

  if (RESTORE_ONLY) {
    const stash = JSON.parse(fs.readFileSync(STASH, "utf8"));
    if (stash.eventId !== eventId) throw new Error("Stash is for a different event");
    await supabase.from("events").update({ settings: stash.settings }).eq("id", eventId);
    await r2.deleteFromR2(rasterKey).catch(() => {});
    await r2.deleteFromR2(logoKey).catch(() => {});
    console.log("Restored original settings; deleted raster + test logo.");
    return;
  }

  const originalSettings = target.settings ?? {};
  fs.writeFileSync(STASH, JSON.stringify({ eventId, settings: originalSettings }));
  console.log(`Original settings stashed → ${STASH}`);

  // ── Test logo: white wordmark PNG w/ transparency ──
  const logoPng = await sharp(
    Buffer.from(
      `<svg width="600" height="200" xmlns="http://www.w3.org/2000/svg">
        <text x="300" y="128" text-anchor="middle" font-family="Helvetica, Arial" font-size="96" font-weight="800" fill="#ffffff" letter-spacing="6">TEST CO</text>
        <rect x="150" y="158" width="300" height="8" fill="#ffffff"/>
      </svg>`
    ),
    { density: 150 }
  )
    .png()
    .toBuffer();
  await r2.uploadToR2(logoKey, logoPng, "image/png");
  console.log(`Logo uploaded → ${logoKey}`);

  const setCover = async (cover: Record<string, unknown>) => {
    const settings = { ...(originalSettings as Record<string, unknown>), cover };
    const { error } = await supabase
      .from("events")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ settings: settings as any })
      .eq("id", eventId);
    if (error) throw error;
  };

  const assertRaster = async (label: string, expectedTileIds: string[]) => {
    const key = await composeCoverRaster(eventId);
    if (key !== rasterKey) throw new Error(`${label}: compose returned ${key}`);
    const buf = await r2.getObjectBuffer(rasterKey);
    const meta = await sharp(buf).metadata();
    if (meta.width !== 1600 || meta.height !== 900 || meta.format !== "jpeg") {
      throw new Error(`${label}: bad raster ${meta.width}×${meta.height} ${meta.format}`);
    }
    const stored = await r2.getObjectMetadata(rasterKey);
    const { data: ev } = await supabase
      .from("events")
      .select("settings")
      .eq("id", eventId)
      .single();
    const cover = normalizeCoverSettings(
      (ev!.settings as Record<string, unknown>).cover
    );
    const expect = coverInputsHash(cover, expectedTileIds);
    if (stored?.["inputs-hash"] !== expect) {
      throw new Error(
        `${label}: hash mismatch stored=${stored?.["inputs-hash"]} expected=${expect}`
      );
    }
    const out = `${OUT_DIR}/cover-v2-${label}.jpg`;
    fs.writeFileSync(out, buf);
    console.log(
      `✓ ${label}: 1600×900 JPEG (${(buf.length / 1024).toFixed(0)}kB), hash ok → ${out}`
    );
  };

  const leadIds = poolLeads(await fetchMosaicPool(eventId, undefined)).map((l) => l.id);
  console.log(`Pool: ${leadIds.length} stack-deduped leads`);

  // ── 1. Mosaic / overlay (the eBay look) ──
  await setCover({
    enabled: true,
    type: "mosaic",
    titlePosition: "over",
    titleAlignment: "center",
    mosaic: {
      rows: 3,
      seed: 42,
      logoMode: "overlay",
      logoKey,
      overlay: { color: "#0064D2", opacity: 0.82, blur: true },
      insert: { padding: 15, fill: "#FFFFFF" },
    },
  });
  await assertRaster("mosaic-overlay", leadIds);

  // ── 2. Mosaic / insert (the Uber look) ──
  await setCover({
    enabled: true,
    type: "mosaic",
    titlePosition: "over",
    titleAlignment: "center",
    mosaic: {
      rows: 4,
      seed: 7,
      logoMode: "insert",
      logoKey,
      overlay: { color: "#1C1917", opacity: 0.75, blur: false },
      insert: { padding: 20, fill: "#111111" },
    },
  });
  await assertRaster("mosaic-insert", leadIds);

  // ── 3. Solid gradient + logo ──
  await setCover({
    enabled: true,
    type: "solid",
    titlePosition: "below",
    titleAlignment: "center",
    solid: { logoKey, padding: 30, colors: ["#7C3AED", "#DB2777", "#F59E0B"], angle: 120 },
  });
  await assertRaster("solid-gradient", []);

  // ── 4. Serve-time resolution on the fresh raster ──
  {
    const { resolveCoverRasterUrl } = await import("../src/lib/cover/pool");
    const { data: ev } = await supabase
      .from("events")
      .select("settings")
      .eq("id", eventId)
      .single();
    const cover = normalizeCoverSettings(
      (ev!.settings as Record<string, unknown>).cover
    );
    const url = await resolveCoverRasterUrl(eventId, cover, 600);
    if (!url) throw new Error("resolveCoverRasterUrl returned null for fresh raster");
    const res = await fetch(url);
    if (!res.ok || res.headers.get("content-type") !== "image/jpeg") {
      throw new Error(`presigned fetch failed: ${res.status}`);
    }
    console.log("✓ resolveCoverRasterUrl serves the raster (fetch 200, image/jpeg)");
  }

  if (HOLD) {
    // Leave mosaic/overlay set for browser QA (regenerate its raster first).
    await setCover({
      enabled: true,
      type: "mosaic",
      titlePosition: "over",
      titleAlignment: "center",
      mosaic: {
        rows: 3,
        seed: 42,
        logoMode: "overlay",
        logoKey,
        overlay: { color: "#0064D2", opacity: 0.82, blur: true },
        insert: { padding: 15, fill: "#FFFFFF" },
      },
    });
    await composeCoverRaster(eventId);
    const { data: share } = await supabase
      .from("shares")
      .select("slug, is_active")
      .eq("event_id", eventId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    console.log(
      `HOLDING mosaic/overlay on the event. Share slug: ${share?.slug ?? "(none)"}`
    );
    console.log("Run with --restore when done.");
    return;
  }

  // ── Restore ──
  await supabase.from("events").update({ settings: originalSettings }).eq("id", eventId);
  await r2.deleteFromR2(rasterKey).catch(() => {});
  await r2.deleteFromR2(logoKey).catch(() => {});
  console.log("Restored original settings; deleted raster + test logo. All green.");
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exit(1);
});
