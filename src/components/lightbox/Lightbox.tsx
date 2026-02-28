"use client";

import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Info, Download, X } from "lucide-react";
import { useLightbox } from "./useLightbox";
import { LightboxImage } from "./LightboxImage";
import { MetadataPanel } from "./MetadataPanel";
import type { ImageData } from "@/types/image";

interface LightboxProps {
  images: ImageData[];
  initialImageId: string;
  onClose: () => void;
}

/**
 * Lightbox — Full-screen image viewer with keyboard navigation,
 * zoom/pan, metadata sidebar, and download support. Renders as a portal
 * to avoid z-index issues with the page layout.
 */
export function Lightbox({ images, initialImageId, onClose }: LightboxProps) {
  const {
    currentIndex,
    currentImage,
    imageDetail,
    isLoadingDetail,
    isMetadataOpen,
    toggleMetadata,
    goNext,
    goPrev,
    hasNext,
    hasPrev,
    close,
    totalImages,
    containerRef,
    // Zoom
    zoom,
    handleZoomWheel,
    handleDoubleClick,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    // Download
    handleDownload,
  } = useLightbox({ images, initialImageId, onClose });

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/95 lightbox-open outline-none"
    >
      {/* ─── Top bar ─── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4 lightbox-open"
        style={{ animationDelay: "0.1s" }}
      >
        {/* Counter */}
        <span
          className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-500"
          aria-live="polite"
        >
          {currentIndex + 1} of {totalImages}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMetadata}
            className={`flex h-10 w-10 items-center justify-center transition-colors duration-300 ${
              isMetadataOpen
                ? "text-white"
                : "text-stone-400 hover:text-white"
            }`}
            aria-label="Toggle image details"
            title="Info (i)"
          >
            <Info className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={handleDownload}
            className="flex h-10 w-10 items-center justify-center text-stone-400 hover:text-white transition-colors duration-300"
            aria-label="Download original image"
            title="Download (d)"
          >
            <Download className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={close}
            className="flex h-10 w-10 items-center justify-center text-stone-400 hover:text-white transition-colors duration-300"
            aria-label="Close viewer"
            title="Close (Esc)"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* ─── Main content ─── */}
      <div className="flex h-full pt-14 pb-4">
        {/* Image area with navigation */}
        <div className="relative flex flex-1 items-center justify-center px-16">
          {/* Left arrow */}
          {hasPrev && !zoom.isZoomed && (
            <button
              onClick={goPrev}
              className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors duration-300 max-md:hidden"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          {/* Image — key forces remount for enter animation */}
          <LightboxImage
            key={currentImage.id}
            image={currentImage}
            zoom={zoom}
            onWheel={handleZoomWheel}
            onDoubleClick={handleDoubleClick}
            onPanStart={handlePanStart}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
            isPanning={isPanning}
          />

          {/* Right arrow */}
          {hasNext && !zoom.isZoomed && (
            <button
              onClick={goNext}
              className="absolute right-4 z-10 flex h-10 w-10 items-center justify-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-colors duration-300 max-md:hidden"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}

          {/* Zoom indicator */}
          {zoom.isZoomed && (
            <div className="absolute bottom-6 right-6 z-10 lightbox-open">
              <span className="text-[11px] tabular-nums text-white/40 font-medium tracking-wider">
                {zoom.scale.toFixed(1)}x
              </span>
            </div>
          )}
        </div>

        {/* Metadata sidebar */}
        <MetadataPanel
          image={currentImage}
          detail={imageDetail}
          isLoading={isLoadingDetail}
          isOpen={isMetadataOpen}
        />
      </div>
    </div>,
    document.body
  );
}
