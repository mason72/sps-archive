import sharp from "sharp";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getObjectBuffer,
  getThumbnailKey,
  uploadToR2WithMetadata,
} from "@/lib/r2/client";
import { normalizeCoverSettings, coverNeedsRaster } from "@/types/event-settings";
import {
  computeMosaicGrid,
  computeInsertHole,
  cellInHole,
  holeCells,
  orderTiles,
} from "@/lib/cover/mosaic";
import {
  coverRasterKey,
  coverInputsHash,
  fetchMosaicPool,
  poolLeads,
} from "@/lib/cover/pool";

/**
 * Cover raster composer — mosaic/solid covers as a real JPEG for the places
 * CSS can't reach (email heroes, and OG once composed). The sharp-free serve
 * half (pool resolution, hashing, presigning) lives in pool.ts.
 *
 * RULES (the eBay incident, lessons #21–23):
 *  - sharp NEVER runs inline in a request. Composition happens only in the
 *    Inngest `cover-raster` job; serving routes just presign the stored key.
 *  - One fixed key per event (`.../covers/cover-raster.jpg`) — regeneration
 *    overwrites in place, so there is nothing to garbage-collect and every
 *    stored URL picks up the freshest render.
 *  - Staleness is lazy: the object carries an inputs hash in its metadata;
 *    serving routes compare and enqueue a refresh, still serving the stale
 *    raster meanwhile (stale-while-revalidate).
 */

export const RASTER_W = 1600;
export const RASTER_H = 900;
const RASTER_GAP = 4; // must match MOSAIC_GAP in CoverSection
const GUTTER_COLOR = "#ffffff"; // email + OG sit on white

/** Small-concurrency map — tile fetches shouldn't burst R2. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

/** CSS linear-gradient(angle, stops) as an SVG — parity with the live cover. */
function gradientSvg(colors: string[], angleDeg: number, w: number, h: number): Buffer {
  if (colors.length === 1) {
    return Buffer.from(
      `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${colors[0]}"/></svg>`
    );
  }
  // CSS angle: 0deg points up, clockwise. Direction vector → gradient line
  // endpoints in objectBoundingBox units.
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  const stops = colors
    .map(
      (c, i) =>
        `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`
    )
    .join("");
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`
  );
}

function colorRectSvg(w: number, h: number, color: string, opacity: number): Buffer {
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${color}" fill-opacity="${opacity}"/></svg>`
  );
}

/** Fetch + size the client logo for compositing. Returns null when unset/broken. */
async function prepareLogo(
  logoKey: string | undefined,
  targetH: number,
  maxW: number
): Promise<{ buf: Buffer; w: number; h: number; aspect: number } | null> {
  if (!logoKey) return null;
  try {
    const raw = await getObjectBuffer(logoKey);
    // density: SVG logos rasterize crisp at composite scale instead of 72dpi.
    const meta = await sharp(raw, { density: 300 }).metadata();
    if (!meta.width || !meta.height) return null;
    const aspect = meta.width / meta.height;
    let h = Math.round(targetH);
    let w = Math.round(h * aspect);
    if (w > maxW) {
      w = Math.round(maxW);
      h = Math.round(w / aspect);
    }
    const buf = await sharp(raw, { density: 300 })
      .resize(w, h, { fit: "inside" })
      .png()
      .toBuffer();
    return { buf, w, h, aspect };
  } catch {
    return null;
  }
}

/**
 * Compose and store the raster for an event's cover. Returns the stored key,
 * or null when the cover doesn't need/can't produce one. Call ONLY from the
 * Inngest job.
 */
export async function composeCoverRaster(eventId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from("events")
    .select("settings")
    .eq("id", eventId)
    .single();
  if (!event) return null;

  const cover = normalizeCoverSettings(
    ((event.settings ?? {}) as Record<string, unknown>).cover
  );
  if (!coverNeedsRaster(cover)) return null;

  let composed: Buffer | null = null;
  let hash: string;

  if (cover.type === "solid" && cover.solid) {
    const s = cover.solid;
    hash = coverInputsHash(cover, []);
    const base = sharp(gradientSvg(s.colors, s.angle, RASTER_W, RASTER_H)).png();
    const logoH = RASTER_H * Math.max(0.1, 1 - (2 * s.padding) / 100);
    const logo = await prepareLogo(s.logoKey, logoH, RASTER_W * 0.8);
    composed = await base
      .composite(
        logo
          ? [
              {
                input: logo.buf,
                left: Math.round((RASTER_W - logo.w) / 2),
                top: Math.round((RASTER_H - logo.h) / 2),
              },
            ]
          : []
      )
      .toBuffer();
  } else if (cover.type === "mosaic" && cover.mosaic) {
    const m = cover.mosaic;
    const leads = poolLeads(await fetchMosaicPool(eventId, m.sectionId));
    if (leads.length === 0) return null;
    hash = coverInputsHash(cover, leads.map((l) => l.id));

    const grid = computeMosaicGrid({
      containerW: RASTER_W,
      bandH: RASTER_H,
      rows: m.rows,
      poolSize: leads.length,
    });

    // Logo first — insert-hole geometry needs its aspect ratio.
    const wantsLogo = m.logoMode !== "none" && !!m.logoKey;
    const logoProbe = wantsLogo ? await prepareLogo(m.logoKey, 100, 10000) : null;
    const hole =
      m.logoMode === "insert" && logoProbe
        ? computeInsertHole({
            grid,
            logoAspect: logoProbe.aspect,
            paddingPct: m.insert.padding,
          })
        : null;

    const tiles = orderTiles(leads, m.seed).slice(0, grid.cells - holeCells(hole));
    const tileW = Math.floor((RASTER_W - RASTER_GAP * (grid.cols - 1)) / grid.cols);
    const tileH = Math.floor((RASTER_H - RASTER_GAP * (grid.rows - 1)) / grid.rows);

    const tileBuffers = await mapLimit(tiles, 6, async (tile) => {
      try {
        const buf = await getObjectBuffer(getThumbnailKey(tile.r2_key, "thumb-md"));
        // "attention" ≈ the live cover's face-biased crop (CSS 50% 25%).
        return await sharp(buf)
          .resize(tileW, tileH, { fit: "cover", position: sharp.strategy.attention })
          .toBuffer();
      } catch {
        return null; // a missing thumbnail leaves a gutter-colored cell
      }
    });

    const composites: sharp.OverlayOptions[] = [];
    let t = 0;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (cellInHole(hole, r, c) || t >= tileBuffers.length) continue;
        const buf = tileBuffers[t++];
        if (!buf) continue;
        composites.push({
          input: buf,
          left: c * (tileW + RASTER_GAP),
          top: r * (tileH + RASTER_GAP),
        });
      }
    }

    let canvas = await sharp({
      create: {
        width: RASTER_W,
        height: RASTER_H,
        channels: 3,
        background: GUTTER_COLOR,
      },
    })
      .composite(composites)
      .png()
      .toBuffer();

    if (m.logoMode === "overlay") {
      if (m.overlay.blur) {
        canvas = await sharp(canvas).blur(8).toBuffer();
      }
      const wash: sharp.OverlayOptions[] = [
        {
          input: colorRectSvg(RASTER_W, RASTER_H, m.overlay.color, m.overlay.opacity),
        },
      ];
      const logo = await prepareLogo(m.logoKey, RASTER_H * 0.38, RASTER_W * 0.7);
      if (logo) {
        wash.push({
          input: logo.buf,
          left: Math.round((RASTER_W - logo.w) / 2),
          top: Math.round((RASTER_H - logo.h) / 2),
        });
      }
      canvas = await sharp(canvas).composite(wash).toBuffer();
    } else if (hole && logoProbe) {
      const holeLeft = hole.startCol * (tileW + RASTER_GAP);
      const holeTop = hole.startRow * (tileH + RASTER_GAP);
      const holeW = hole.colSpan * tileW + (hole.colSpan - 1) * RASTER_GAP;
      const holeH = hole.rowSpan * tileH + (hole.rowSpan - 1) * RASTER_GAP;
      const fill = await sharp(
        colorRectSvg(holeW, holeH, m.insert.fill, 1)
      ).png().toBuffer();
      const logo = await prepareLogo(
        m.logoKey,
        holeH * hole.logoHeightFrac,
        holeW * 0.85
      );
      const overlays: sharp.OverlayOptions[] = [
        { input: fill, left: holeLeft, top: holeTop },
      ];
      if (logo) {
        overlays.push({
          input: logo.buf,
          left: Math.round(holeLeft + (holeW - logo.w) / 2),
          top: Math.round(holeTop + (holeH - logo.h) / 2),
        });
      }
      canvas = await sharp(canvas).composite(overlays).toBuffer();
    }

    composed = canvas;
  } else {
    return null;
  }

  const jpeg = await sharp(composed).jpeg({ quality: 82 }).toBuffer();
  const key = coverRasterKey(eventId);
  await uploadToR2WithMetadata(key, jpeg, "image/jpeg", { "inputs-hash": hash });
  return key;
}
