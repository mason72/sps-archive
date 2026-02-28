"use client";

import { useState, useRef } from "react";
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
}

/**
 * GalleryGrid — Public gallery masonry layout.
 * Clean, client-facing design with optional download/favorite overlays.
 */
export function GalleryGrid({
  images,
  allowDownload,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onImageClick,
  onDownloadClick,
}: GalleryGridProps) {
  if (images.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="text-[14px] text-stone-400">No images yet</p>
      </div>
    );
  }

  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4">
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
}: {
  image: GalleryImage;
  allowDownload: boolean;
  allowFavorites: boolean;
  isFavorited: boolean;
  onFavorite?: (imageId: string) => void;
  onClick: () => void;
  onDownloadClick?: (image: GalleryImage) => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

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
      className="relative mb-4 break-inside-avoid group cursor-pointer overflow-hidden bg-stone-100"
      onClick={onClick}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image.thumbnailUrl}
        alt={image.parsedName || image.originalFilename}
        className={`w-full h-auto object-cover transition-all duration-500 group-hover:scale-[1.03] ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (imgRef.current && image.originalUrl && imgRef.current.src !== image.originalUrl) {
            imgRef.current.src = image.originalUrl;
          }
        }}
      />
      {!isLoaded && <div className="aspect-[3/4]" />}

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
              className="h-4 w-4"
              fill={isFavorited ? "currentColor" : "none"}
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
