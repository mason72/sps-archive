"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { GalleryImage, GallerySection, GallerySettings } from "@/types/gallery";
import {
  computeMosaicGrid,
  computeInsertHole,
  cellInHole,
  holeCells,
  dedupeStackLeads,
  orderTiles,
  selectCrossfadeImages,
} from "@/lib/cover/mosaic";

interface CoverSectionProps {
  settings: GallerySettings;
  /** Grid images (cover-excluded) — mosaic/crossfade source their tiles here. */
  images: GalleryImage[];
  sections?: GallerySection[];
  eventName: string;
  headingClass: string;
  primaryColor?: string;
}

/**
 * Shared cover hero for public + preview galleries. Switches on cover type:
 * - `image`     — single hero, focal-point-anchored crop
 * - `mosaic`    — auto grid of stack-deduped section tiles, logo overlay/insert
 * - `solid`     — brand color/gradient canvas + client logo
 * - `crossfade` — hero slowly cycling the section's leads
 *
 * Title: rendered here only for titlePosition "over" (and only when the
 * cover shows a title at all — a client logo replaces it); "above"/"below"
 * stay the parent's job.
 */
export function CoverSection({
  settings: s,
  images,
  sections,
  eventName,
  headingClass,
  primaryColor,
}: CoverSectionProps) {
  const type = s.coverType ?? "image";
  const titleOver = (s.titlePosition ?? "over") === "over" && s.coverShowsTitle !== false;

  // Resolve a cover's source section → its images, in section order.
  const sourceSectionId =
    type === "mosaic" ? s.coverMosaic?.sectionId : s.coverCrossfade?.sectionId;
  const sectionImages = useMemo(() => {
    if (type !== "mosaic" && type !== "crossfade") return [];
    const byId = new Map(images.map((img) => [img.id, img]));
    const withImages = (sections ?? []).filter((sec) =>
      sec.imageIds.some((id) => byId.has(id))
    );
    const section =
      withImages.find((sec) => sec.id === sourceSectionId) ?? withImages[0];
    const pool = section
      ? section.imageIds.map((id) => byId.get(id)).filter((x): x is GalleryImage => !!x)
      : images;
    return pool;
  }, [type, images, sections, sourceSectionId]);

  let layer: React.ReactNode = null;
  if (type === "mosaic" && s.coverMosaic) {
    layer = <MosaicLayer mosaic={s.coverMosaic} pool={sectionImages} />;
  } else if (type === "solid" && s.coverSolid) {
    layer = <SolidLayer solid={s.coverSolid} />;
  } else if (type === "crossfade" && s.coverCrossfade) {
    layer = (
      <CrossfadeLayer
        crossfade={s.coverCrossfade}
        pool={sectionImages}
        focalPoint={s.coverFocalPoint}
      />
    );
  } else if (s.coverImageUrl) {
    const fp = s.coverFocalPoint;
    layer = (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={s.coverImageUrl}
        alt=""
        className="w-full h-full object-cover ken-burns-settle"
        style={{
          color: primaryColor,
          objectPosition: fp ? `${fp.x * 100}% ${fp.y * 100}%` : undefined,
        }}
      />
    );
  }
  if (!layer) return null;

  if (!titleOver) {
    return (
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">{layer}</div>
    );
  }

  // Determine overlay alignment from titlePlacement (defaults to center/center)
  const v = s.titlePlacement?.vertical || "center";
  const h = s.titlePlacement?.horizontal || "center";
  // flex-col: justify-* = vertical (main axis), items-* = horizontal (cross axis)
  const verticalClass =
    v === "top" ? "justify-start" : v === "bottom" ? "justify-end" : "justify-center";
  const horizontalClass =
    h === "left" ? "items-start text-left" : h === "right" ? "items-end text-right" : "items-center text-center";

  return (
    <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
      {layer}
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-transparent" />
      <div
        className={cn(
          "absolute inset-0 flex flex-col p-8 md:p-16",
          verticalClass,
          horizontalClass
        )}
      >
        <h1
          className={cn(
            headingClass,
            "text-[clamp(36px,6vw,72px)] leading-[0.95] text-white",
            // Position-independent legibility: the bottom-anchored gradient
            // above doesn't protect a top/center-placed title, and a title
            // over a bright cover (white backdrop, snow, product) would wash
            // out. A soft two-layer text-shadow keeps white text readable on
            // any cover without darkening the photographer's image.
            "[text-shadow:0_1px_3px_rgba(0,0,0,0.45),0_2px_24px_rgba(0,0,0,0.35)]"
          )}
        >
          {eventName}
        </h1>
      </div>
    </div>
  );
}

/* ─── Mosaic ─── */

const MOSAIC_GAP = 4; // px between tiles — matches the photo-wall reference look

function MosaicLayer({
  mosaic,
  pool,
}: {
  mosaic: NonNullable<GallerySettings["coverMosaic"]>;
  pool: GalleryImage[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [logoAspect, setLogoAspect] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const leads = useMemo(() => dedupeStackLeads(pool), [pool]);
  const arranged = useMemo(() => orderTiles(leads, mosaic.seed), [leads, mosaic.seed]);

  const grid = box
    ? computeMosaicGrid({
        containerW: box.w,
        bandH: box.h,
        rows: mosaic.rows,
        poolSize: leads.length,
      })
    : null;
  const hole =
    grid && mosaic.logoMode === "insert" && mosaic.logoUrl
      ? computeInsertHole({ grid, logoAspect, paddingPct: mosaic.insert.padding })
      : null;
  const tiles = grid ? arranged.slice(0, grid.cells - holeCells(hole)) : [];

  // Cell walk: place tiles row-major, skipping the hole's cells.
  const cells: React.ReactNode[] = [];
  if (grid && tiles.length > 0) {
    let t = 0;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (cellInHole(hole, r, c) || t >= tiles.length) continue;
        const img = tiles[t++];
        cells.push(
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={img.id}
            src={img.thumbnailUrl}
            alt=""
            loading="eager"
            className="w-full h-full object-cover"
            // Booth shots are centered people — bias the crop toward faces.
            style={{
              objectPosition: "50% 25%",
              gridArea: `${r + 1} / ${c + 1}`,
              backgroundColor: img.dominantColor ?? undefined,
            }}
          />
        );
      }
    }
  }

  return (
    <div ref={ref} className="relative w-full h-full">
      {grid && (
        <div
          className="grid w-full h-full"
          style={{
            gridTemplateRows: `repeat(${grid.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
            gap: MOSAIC_GAP,
          }}
        >
          {cells}
          {hole && mosaic.logoUrl && (
            <div
              className="flex items-center justify-center"
              style={{
                gridArea: `${hole.startRow + 1} / ${hole.startCol + 1} / span ${hole.rowSpan} / span ${hole.colSpan}`,
                backgroundColor: mosaic.insert.fill,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={mosaic.logoUrl}
                alt=""
                className="object-contain"
                style={{ height: `${hole.logoHeightFrac * 100}%`, maxWidth: "85%" }}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) {
                    setLogoAspect(el.naturalWidth / el.naturalHeight);
                  }
                }}
              />
            </div>
          )}
        </div>
      )}
      {mosaic.logoMode === "overlay" && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            backgroundColor: hexWithOpacity(mosaic.overlay.color, mosaic.overlay.opacity),
            backdropFilter: mosaic.overlay.blur ? "blur(6px)" : undefined,
            WebkitBackdropFilter: mosaic.overlay.blur ? "blur(6px)" : undefined,
          }}
        >
          {mosaic.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={mosaic.logoUrl}
              alt=""
              className="object-contain"
              style={{ height: "38%", maxWidth: "70%" }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** "#RRGGBB" + alpha → rgba() (settings store hex; opacity rides separately). */
function hexWithOpacity(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.min(1, Math.max(0, opacity))})`;
}

/* ─── Solid / gradient ─── */

export function solidBackground(colors: string[], angle: number): string {
  const stops = colors.filter(Boolean);
  if (stops.length <= 1) return stops[0] ?? "#1C1917";
  return `linear-gradient(${angle}deg, ${stops.join(", ")})`;
}

function SolidLayer({ solid }: { solid: NonNullable<GallerySettings["coverSolid"]> }) {
  // Padding is whitespace around the logo: 0 → logo fills the band, 45 → small mark.
  const logoH = Math.max(10, 100 - 2 * solid.padding);
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: solidBackground(solid.colors, solid.angle) }}
    >
      {solid.logoUrl && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={solid.logoUrl}
          alt=""
          className="object-contain"
          style={{ height: `${logoH}%`, maxWidth: "80%" }}
        />
      )}
    </div>
  );
}

/* ─── Crossfade ─── */

function CrossfadeLayer({
  crossfade,
  pool,
  focalPoint,
}: {
  crossfade: NonNullable<GallerySettings["coverCrossfade"]>;
  pool: GalleryImage[];
  focalPoint?: { x: number; y: number };
}) {
  const frames = useMemo(
    () => selectCrossfadeImages(pool, crossfade.count),
    [pool, crossfade.count]
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (frames.length < 2) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % frames.length),
      crossfade.intervalMs
    );
    return () => clearInterval(t);
  }, [frames.length, crossfade.intervalMs]);

  if (frames.length === 0) return null;
  const objectPosition = focalPoint
    ? `${focalPoint.x * 100}% ${focalPoint.y * 100}%`
    : undefined;

  return (
    <div className="relative w-full h-full">
      {frames.map((img, i) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          key={img.id}
          src={img.originalUrl ?? img.thumbnailLgUrl ?? img.thumbnailUrl}
          alt=""
          className={cn(
            "absolute inset-0 w-full h-full object-cover transition-opacity duration-[1500ms] ease-in-out",
            i === idx ? "opacity-100" : "opacity-0"
          )}
          style={{ objectPosition }}
        />
      ))}
    </div>
  );
}
