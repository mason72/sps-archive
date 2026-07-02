"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Download, Heart } from "lucide-react";
import { distributeBalanced, useResponsiveColumns } from "@/lib/gallery/grid-layout";
import { buildStacks, type GalleryStack } from "@/lib/gallery/stacks";
import { GalleryStackCard } from "@/components/gallery/GalleryStackCard";
import type { GalleryImage } from "@/types/gallery";

interface GalleryGridProps {
  images: GalleryImage[];
  allowDownload: boolean;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  /** Batch favorite/unfavorite — required for smart stacks' heart-all. */
  onFavoriteMany?: (imageIds: string[], favorite: boolean) => void;
  onImageClick: (imageId: string) => void;
  onDownloadClick?: (image: GalleryImage) => void;
  /** Clicking a multi-image stack opens its mini gallery (page-level modal). */
  onOpenStack?: (stack: GalleryStack) => void;
  /** Hover pill on stack cards — download the whole stack as one ZIP. */
  onDownloadStack?: (stack: GalleryStack) => void;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
  showFilenames?: boolean;
  /** Group photos of the same person (by filename) into rotating stacks. */
  smartStacks?: boolean;
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

/* Responsive columns + height-balanced distribution now come from the shared
   src/lib/gallery/grid-layout module (used by the editor grid too). */

/* ─── Main component ─── */
export function GalleryGrid({
  images,
  allowDownload,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onFavoriteMany,
  onImageClick,
  onDownloadClick,
  onOpenStack,
  onDownloadStack,
  gridStyle = "masonry",
  gridColumns = 4,
  gridGap = "normal",
  showFilenames = false,
  smartStacks = false,
}: GalleryGridProps) {
  const colCount = useResponsiveColumns(gridColumns);
  const isUniform = gridStyle === "uniform";

  // With smart stacks on, the layout unit is a stack (singles are stacks of
  // one and render as plain cards). Off, every image is its own item.
  const items: GalleryStack[] = useMemo(
    () =>
      smartStacks
        ? buildStacks(images)
        : images.map((img) => ({
            key: img.id,
            personName: img.parsedName || img.originalFilename,
            images: [img],
          })),
    [images, smartStacks]
  );

  const columns = useMemo(
    () =>
      isUniform
        ? []
        : distributeBalanced(items, colCount, (item) => {
            const img = item.images[0];
            return img.width && img.height ? img.height / img.width : 3 / 4;
          }),
    [items, colCount, isUniform]
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
        {items.map((item) =>
          item.images.length > 1 ? (
            <GalleryStackCard
              key={item.key}
              stack={item}
              allowFavorites={allowFavorites}
              favoriteIds={favoriteIds}
              onFavoriteMany={onFavoriteMany}
              onImageClick={onImageClick}
              onOpenStack={onOpenStack}
              onDownloadStack={onDownloadStack}
              showName={showFilenames}
              uniform
              sizes={`${Math.round(100 / gridColumns)}vw`}
            />
          ) : (
            <GalleryCard
              key={item.images[0].id}
              image={item.images[0]}
              allowDownload={allowDownload}
              allowFavorites={allowFavorites}
              isFavorited={favoriteIds.has(item.images[0].id)}
              onFavorite={onFavorite}
              onClick={() => onImageClick(item.images[0].id)}
              onDownloadClick={onDownloadClick}
              showFilename={showFilenames}
              uniform
              sizes={`${Math.round(100 / gridColumns)}vw`}
            />
          )
        )}
      </div>
    );
  }

  /* ─── Masonry (JS-distributed columns — stable, no jumping) ─── */
  return (
    <div className="flex items-start" style={{ gap }}>
      {columns.map((col, ci) => (
        <div key={ci} className="flex-1 min-w-0 flex flex-col" style={{ gap }}>
          {col.map((item) =>
            item.images.length > 1 ? (
              <GalleryStackCard
                key={item.key}
                stack={item}
                allowFavorites={allowFavorites}
                favoriteIds={favoriteIds}
                onFavoriteMany={onFavoriteMany}
                onImageClick={onImageClick}
                onOpenStack={onOpenStack}
                onDownloadStack={onDownloadStack}
                showName={showFilenames}
                sizes={`${Math.round(100 / colCount)}vw`}
              />
            ) : (
              <GalleryCard
                key={item.images[0].id}
                image={item.images[0]}
                allowDownload={allowDownload}
                allowFavorites={allowFavorites}
                isFavorited={favoriteIds.has(item.images[0].id)}
                onFavorite={onFavorite}
                onClick={() => onImageClick(item.images[0].id)}
                onDownloadClick={onDownloadClick}
                showFilename={showFilenames}
                sizes={`${Math.round(100 / colCount)}vw`}
              />
            )
          )}
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
  showFilename,
  uniform,
  sizes,
}: {
  image: GalleryImage;
  allowDownload: boolean;
  allowFavorites: boolean;
  isFavorited: boolean;
  onFavorite?: (imageId: string) => void;
  onClick: () => void;
  onDownloadClick?: (image: GalleryImage) => void;
  showFilename?: boolean;
  uniform?: boolean;
  /** Rendered tile width hint for srcset selection (e.g. "25vw"). */
  sizes?: string;
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
        // Wide tiles on retina displays need more than the 400px thumb — offer
        // the 800px rendition and let the browser pick by tile width × DPR.
        srcSet={
          image.thumbnailLgUrl
            ? `${image.thumbnailUrl} 400w, ${image.thumbnailLgUrl} 800w`
            : undefined
        }
        sizes={image.thumbnailLgUrl ? sizes : undefined}
        alt={image.parsedName || image.originalFilename}
        className={`w-full object-cover transition-[opacity,transform] duration-300 group-hover:scale-[1.03] ${
          uniform ? "aspect-square" : "h-full"
        } ${isLoaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (imgRef.current && image.originalUrl && imgRef.current.src !== image.originalUrl) {
            imgRef.current.srcset = ""; // srcset outranks src — clear it
            imgRef.current.src = image.originalUrl;
          }
        }}
      />
      {!isLoaded && <div className="absolute inset-0 bg-stone-100" />}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* Filename (when toggled on) */}
      {showFilename && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 pointer-events-none">
          <p className="truncate text-[11px] text-white">{image.originalFilename}</p>
        </div>
      )}

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
