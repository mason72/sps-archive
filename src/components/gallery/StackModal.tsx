"use client";

import { useEffect } from "react";
import { ArrowLeft, Download, Heart, Layers } from "lucide-react";
import type { GalleryStack } from "@/lib/gallery/stacks";

/**
 * StackModal — full-screen mini gallery for one smart stack (a person's set).
 *
 * Opens when a guest clicks a stack card: every member photo laid out in a
 * simple grid, with a "Download all N" action (single ZIP) and per-image
 * hearts. Clicking a photo opens the page's lightbox on top (z-50 > z-40);
 * closing the lightbox lands back here.
 */
export function StackModal({
  stack,
  colors,
  headingClass,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onDownloadAll,
  onImageClick,
  onClose,
  keyboardEnabled = true,
}: {
  stack: GalleryStack;
  colors: { primary: string; secondary: string; accent: string; background: string };
  headingClass: string;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  /** Renders the "Download all" button when provided (single-ZIP download). */
  onDownloadAll?: (stack: GalleryStack) => void;
  onImageClick: (imageId: string) => void;
  onClose: () => void;
  /** Disable Escape-to-close while the lightbox is stacked on top. */
  keyboardEnabled?: boolean;
}) {
  const count = stack.images.length;

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [keyboardEnabled, onClose]);

  // The gallery page scrolls behind us — freeze it while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photos of ${stack.personName}`}
      className="fixed inset-0 z-40 overflow-y-auto lightbox-open"
      style={{ backgroundColor: colors.background }}
    >
      {/* ─── Header ─── */}
      <div
        className="sticky top-0 z-10 px-6 md:px-12 py-4 flex items-center justify-between gap-4 border-b"
        style={{
          backgroundColor: colors.background,
          borderColor: `${colors.secondary}20`,
        }}
      >
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-[13px] transition-opacity hover:opacity-70"
          style={{ color: colors.secondary }}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          <span className="hidden sm:inline">Back to gallery</span>
          <span className="sm:hidden">Back</span>
        </button>

        <div className="min-w-0 flex-1 text-center">
          <h2
            className={`${headingClass} truncate text-[clamp(18px,2.5vw,28px)] leading-tight`}
            style={{ color: colors.primary }}
          >
            {stack.personName}
          </h2>
          <p
            className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.18em] tabular-nums"
            style={{ color: colors.secondary }}
          >
            <Layers className="h-3 w-3" />
            {count} {count === 1 ? "photo" : "photos"}
          </p>
        </div>

        {onDownloadAll ? (
          <button
            onClick={() => onDownloadAll(stack)}
            className="flex shrink-0 items-center gap-2 px-4 py-2 text-[13px] transition-colors hover:bg-stone-50"
            style={{ color: colors.primary, border: `1px solid ${colors.secondary}30` }}
            title={`Download all ${count} photos as a single ZIP`}
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            <span className="hidden sm:inline">Download all {count}</span>
            <span className="sm:hidden tabular-nums">{count}</span>
          </button>
        ) : (
          // Keep the title optically centered when there's no download action.
          <div className="w-10 shrink-0" aria-hidden />
        )}
      </div>

      {/* ─── Member grid ─── */}
      <div className="px-6 md:px-12 py-8">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stack.images.map((image) => {
            const isFavorited = favoriteIds.has(image.id);
            return (
              <div
                key={image.id}
                className="group relative cursor-pointer overflow-hidden bg-stone-100"
                style={{
                  aspectRatio:
                    image.width && image.height
                      ? `${image.width} / ${image.height}`
                      : "3 / 4",
                }}
                onClick={() => onImageClick(image.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.thumbnailUrl}
                  srcSet={
                    image.thumbnailLgUrl
                      ? `${image.thumbnailUrl} 400w, ${image.thumbnailLgUrl} 800w`
                      : undefined
                  }
                  sizes={image.thumbnailLgUrl ? "25vw" : undefined}
                  alt={stack.personName}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {allowFavorites && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onFavorite?.(image.id);
                    }}
                    className={`absolute bottom-2.5 right-2.5 p-2 rounded-full backdrop-blur-sm transition-all duration-300 ${
                      isFavorited
                        ? "bg-white/90 text-red-500"
                        : "bg-black/30 text-white hover:bg-black/50 opacity-0 group-hover:opacity-100"
                    }`}
                    title={isFavorited ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Heart
                      className="h-4 w-4"
                      fill={isFavorited ? "currentColor" : "none"}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
