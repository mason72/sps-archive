"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Download, Heart } from "lucide-react";
import type { GalleryImage } from "@/types/gallery";

interface GalleryGridProps {
  images: GalleryImage[];
  allowDownload: boolean;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  onImageClick: (imageId: string) => void;
  onDownloadClick?: (image: GalleryImage) => void;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
}

/**
 * GalleryGrid — Public gallery layout.
 *
 * Masonry mode uses JS-based column distribution (shortest-column-first)
 * to prevent CSS-columns reflow issues where images jump around on load.
 * Uniform mode uses CSS Grid for a clean square grid.
 */

/* ─── Gap classes ─── */
const GAP_PX: Record<string, number> = { tight: 4, normal: 16, loose: 24 };

const UNIFORM_GAP_MAP: Record<string, string> = {
  tight: "gap-1",
  normal: "gap-4",
  loose: "gap-6",
};

const UNIFORM_COLUMNS_MAP: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
};

/* ─── Responsive column count (mirrors old Tailwind breakpoints) ─── */
// [default, sm≥640, lg≥1024, xl≥1280]
const RESPONSIVE_COLS: Record<number, number[]> = {
  2: [1, 2, 2, 2],
  3: [1, 2, 3, 3],
  4: [1, 2, 3, 4],
  5: [2, 3, 4, 5],
  6: [2, 3, 4, 6],
};

function useResponsiveColumns(target: number): number {
  const tiers = RESPONSIVE_COLS[target] ?? RESPONSIVE_COLS[4];

  const [cols, setCols] = useState(() => {
    if (typeof window === "undefined") return tiers[0];
    const w = window.innerWidth;
    if (w >= 1280) return tiers[3];
    if (w >= 1024) return tiers[2];
    if (w >= 640) return tiers[1];
    return tiers[0];
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1280) setCols(tiers[3]);
      else if (w >= 1024) setCols(tiers[2]);
      else if (w >= 640) setCols(tiers[1]);
      else setCols(tiers[0]);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tiers]);

  return cols;
}

/* ─── Round-robin distribution (preserves left-to-right reading order) ─── */
function distributeIntoColumns(images: GalleryImage[], numCols: number): GalleryImage[][] {
  const columns: GalleryImage[][] = Array.from({ length: numCols }, () => []);
  images.forEach((img, i) => {
    columns[i % numCols].push(img);
  });
  return columns;
}

/* ─── Main component ─── */
export function GalleryGrid({
  images,
  allowDownload,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onImageClick,
  onDownloadClick,
  gridStyle = "masonry",
  gridColumns = 4,
  gridGap = "normal",
}: GalleryGridProps) {
  const colCount = useResponsiveColumns(gridColumns);
  const isUniform = gridStyle === "uniform";

  const columns = useMemo(
    () => (isUniform ? [] : distributeIntoColumns(images, colCount)),
    [images, colCount, isUniform]
  );

  if (images.length === 0) {
    return (
      <div className="py-24 flex flex-col items-center justify-center max-w-xs mx-auto text-center gap-4">
        <svg
          className="h-16 w-16 text-stone-200"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="6" y="18" width="52" height="36" rx="4" />
          <path d="M22 18l3-6h14l3 6" />
          <circle cx="32" cy="36" r="10" />
          <circle cx="32" cy="36" r="5" />
          <circle cx="48" cy="26" r="2" fill="currentColor" />
        </svg>
        <div className="space-y-1.5">
          <p className="font-editorial text-[16px] text-stone-400">No photos yet</p>
          <p className="text-[13px] text-stone-300 leading-relaxed">
            Upload images to start building your gallery
          </p>
        </div>
      </div>
    );
  }

  const gap = GAP_PX[gridGap] ?? 16;

  /* ─── Uniform grid (CSS Grid — no reflow issues) ─── */
  if (isUniform) {
    const uniformGap = UNIFORM_GAP_MAP[gridGap];
    const uniformCols = UNIFORM_COLUMNS_MAP[gridColumns] || UNIFORM_COLUMNS_MAP[4];
    return (
      <div className={`grid ${uniformCols} ${uniformGap}`}>
        {images.map((image) => (
          <GalleryCard
            key={image.id}
            image={image}
            allowDownload={allowDownload}
            allowFavorites={allowFavorites}
            isFavorited={favoriteIds.has(image.id)}
            onFavorite={onFavorite}
            onClick={() => onImageClick(image.id)}
            onDownloadClick={onDownloadClick}
            uniform
          />
        ))}
      </div>
    );
  }

  /* ─── Masonry (JS-distributed columns — stable, no jumping) ─── */
  return (
    <div className="flex items-start" style={{ gap }}>
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 min-w-0 flex flex-col" style={{ gap }}>
          {col.map((image) => (
            <GalleryCard
              key={image.id}
              image={image}
              allowDownload={allowDownload}
              allowFavorites={allowFavorites}
              isFavorited={favoriteIds.has(image.id)}
              onFavorite={onFavorite}
              onClick={() => onImageClick(image.id)}
              onDownloadClick={onDownloadClick}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ─── GalleryCard ─── */
function GalleryCard({
  image,
  allowDownload,
  allowFavorites,
  isFavorited,
  onFavorite,
  onClick,
  onDownloadClick,
  uniform,
}: {
  image: GalleryImage;
  allowDownload: boolean;
  allowFavorites: boolean;
  isFavorited: boolean;
  onFavorite?: (imageId: string) => void;
  onClick: () => void;
  onDownloadClick?: (image: GalleryImage) => void;
  uniform?: boolean;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const prevFavoritedRef = useRef(isFavorited);

  useEffect(() => {
    if (isFavorited && !prevFavoritedRef.current) {
      setHeartPop(true);
    }
    prevFavoritedRef.current = isFavorited;
  }, [isFavorited]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDownloadClick) {
      onDownloadClick(image);
      return;
    }
    if (image.downloadUrl) {
      const link = document.createElement("a");
      link.href = image.downloadUrl;
      link.download = image.originalFilename;
      link.click();
    }
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFavorite?.(image.id);
  };

  // Lock aspect ratio from real dimensions to prevent layout shift (fallback 4:3)
  const aspectStyle = !uniform
    ? { aspectRatio: image.width && image.height ? `${image.width} / ${image.height}` : '4 / 3' }
    : undefined;

  return (
    <div
      className="relative group cursor-pointer overflow-hidden bg-stone-100"
      style={aspectStyle}
      onClick={onClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image.thumbnailUrl}
        alt={image.parsedName || image.originalFilename}
        className={`w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03] ${
          uniform ? "aspect-square" : "h-full"
        } ${isLoaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (imgRef.current && image.originalUrl && imgRef.current.src !== image.originalUrl) {
            imgRef.current.src = image.originalUrl;
          }
        }}
      />
      {!isLoaded && <div className="absolute inset-0 bg-stone-100" />}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* Action buttons */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        {allowFavorites && (
          <button
            onClick={handleFavorite}
            className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
              isFavorited
                ? "bg-white/90 text-red-500"
                : "bg-black/30 text-white hover:bg-black/50"
            }`}
            title={isFavorited ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart
              className={`h-4 w-4 ${heartPop ? "heart-pop" : ""}`}
              fill={isFavorited ? "currentColor" : "none"}
              onAnimationEnd={() => setHeartPop(false)}
            />
          </button>
        )}
        {allowDownload && image.downloadUrl && (
          <button
            onClick={handleDownload}
            className="p-2 rounded-full bg-black/30 text-white hover:bg-black/50 backdrop-blur-sm transition-colors"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
