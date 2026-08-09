"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { GalleryImage, GallerySection, GallerySettings } from "@/types/gallery";
import {
  layoutMosaic,
  dedupeStackLeads,
  orderTiles,
  selectCrossfadeImages,
  MOSAIC_TILE_AR,
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
    const section = withImages.find((sec) => sec.id === sourceSectionId);
    const sectionPool = section
      ? section.imageIds
          .map((id) => byId.get(id))
          .filter((x): x is GalleryImage => !!x)
      : [];
    // No configured section (or it isn't in this payload) means EVERY image —
    // never "whichever section sorts first". That arbitrary fallback is the
    // actual bug: a cover with no section chosen landed on a 1-image
    // "Highlights", and since a mosaic sheds rows rather than repeating tiles,
    // the cover rendered as one stretched photo.
    //
    // A section the photographer DID choose is honoured at any size — a
    // deliberate 4-image cover section is a choice, not a fault, and silently
    // swapping in the whole event would override it.
    const pool = section ? sectionPool : images;
    // Videos never tile a cover (poster frames read as random blurry shots).
    // Must match the raster pool's media_type filter or the seeded
    // arrangement desyncs between live cover and email/OG raster.
    return pool.filter((img) => img.mediaType !== "video");
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

  const layout = useMemo(() => {
    if (!box) return null;
    return layoutMosaic({
      containerW: box.w,
      bandH: box.h,
      rows: mosaic.rows,
      aspects: arranged.map((img) =>
        img.width && img.height ? img.width / img.height : MOSAIC_TILE_AR
      ),
      gap: MOSAIC_GAP,
      hole:
        mosaic.logoMode === "insert" && mosaic.logoUrl
          ? { logoAspect, paddingPct: mosaic.insert.padding }
          : null,
    });
  }, [box, mosaic.rows, mosaic.logoMode, mosaic.logoUrl, mosaic.insert.padding, arranged, logoAspect]);

  return (
    <div ref={ref} className="relative w-full h-full overflow-hidden">
      {layout &&
        layout.tiles.map((rect, i) => {
          const img = arranged[i];
          if (!img) return null;
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={img.id}
              src={img.thumbnailUrl}
              alt=""
              loading="eager"
              className="absolute object-cover"
              // Justified rows: tiles keep ~their natural aspect; the small
              // residual from row justification is absorbed by object-cover.
              // Crops center on the image's focal point (face-derived or
              // manual) when it has one; else a slight top bias keeps faces.
              style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                objectPosition:
                  img.focalX != null && img.focalY != null
                    ? `${img.focalX}% ${img.focalY}%`
                    : "50% 25%",
                backgroundColor: img.dominantColor ?? undefined,
              }}
            />
          );
        })}
      {layout?.hole && mosaic.logoUrl && (
        <div
          className="absolute flex items-center justify-center"
          style={{
            left: layout.hole.x,
            top: layout.hole.y,
            width: layout.hole.w,
            height: layout.hole.h,
            backgroundColor: mosaic.insert.fill,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mosaic.logoUrl}
            alt=""
            className="object-contain"
            style={{ height: layout.hole.logoH, maxWidth: "88%" }}
            onLoad={(e) => {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setLogoAspect(el.naturalWidth / el.naturalHeight);
              }
            }}
          />
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

  // Mount only the fading-out, current, and preloading-next frames — a
  // 10-frame rotation must not fetch 10 full-size originals at page open.
  const prev = (idx - 1 + frames.length) % frames.length;
  const next = (idx + 1) % frames.length;

  return (
    <div className="relative w-full h-full">
      {frames.map((img, i) => {
        if (i !== idx && i !== prev && i !== next) return null;
        // Per-frame focal (face-derived or manual) beats the cover-level
        // pin — every fade frame crops differently.
        const objectPosition =
          img.focalX != null && img.focalY != null
            ? `${img.focalX}% ${img.focalY}%`
            : focalPoint
              ? `${focalPoint.x * 100}% ${focalPoint.y * 100}%`
              : undefined;
        return (
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
        );
      })}
    </div>
  );
}
