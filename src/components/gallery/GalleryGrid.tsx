"use client";

import { useState, useRef, useEffect } from "react";
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
 * GalleryGrid — Public gallery masonry layout.
 * Clean, client-facing design with optional download/favorite overlays.
 */
const GALLERY_GAP_MAP = {
  tight: "gap-1",
  normal: "gap-4",
  loose: "gap-6",
};

const GALLERY_COLUMNS_MAP: Record<number, string> = {
  2: "columns-1 sm:columns-2",
  3: "columns-1 sm:columns-2 lg:columns-3",
  4: "columns-1 sm:columns-2 lg:columns-3 xl:columns-4",
  5: "columns-2 sm:columns-3 lg:columns-4 xl:columns-5",
  6: "columns-2 sm:columns-3 lg:columns-4 xl:columns-6",
};

const UNIFORM_COLUMNS_MAP: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
};

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
  if (images.length === 0) {
    return (
      <div className="py-24 flex flex-col items-center justify-center max-w-xs mx-auto text-center gap-4">
        {/* D5: Camera outline SVG illustration */}
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

  const gapClass = GALLERY_GAP_MAP[gridGap];
  const isUniform = gridStyle === "uniform";
  const colClass = isUniform
    ? UNIFORM_COLUMNS_MAP[gridColumns] || UNIFORM_COLUMNS_MAP[4]
    : GALLERY_COLUMNS_MAP[gridColumns] || GALLERY_COLUMNS_MAP[4];

  return (
    <div className={isUniform ? `grid ${colClass} ${gapClass}` : `${colClass} ${gapClass}`}>
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
          uniform={isUniform}
        />
      ))}
    </div>
  );
}

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

  // D2: Heart celebration — detect false→true transition
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

  return (
    <div
      className={`relative group cursor-pointer overflow-hidden bg-stone-100 ${uniform ? "" : "mb-4 break-inside-avoid"}`}
      onClick={onClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image.thumbnailUrl}
        alt={image.parsedName || image.originalFilename}
        className={`w-full object-cover transition-all duration-500 group-hover:scale-[1.03] ${
          uniform ? "aspect-square" : "h-auto"
        } ${isLoaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (imgRef.current && image.originalUrl && imgRef.current.src !== image.originalUrl) {
            imgRef.current.src = image.originalUrl;
          }
        }}
      />
      {!isLoaded && <div className={`shimmer-placeholder ${uniform ? "aspect-square" : "aspect-[3/4]"}`} />}

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
