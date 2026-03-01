"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ImageIcon } from "lucide-react";
import type { ImageData } from "@/types/image";
import type { ZoomState } from "./useLightbox";

interface LightboxImageProps {
  image: ImageData;
  zoom: ZoomState;
  onWheel: (e: WheelEvent) => void;
  onDoubleClick: () => void;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  isPanning: boolean;
}

/**
 * LightboxImage — Displays the main image with zoom and pan support.
 * Uses CSS transforms for smooth zoom/pan without layout reflows.
 * Filename display moved to Lightbox top bar.
 */
export function LightboxImage({
  image,
  zoom,
  onWheel,
  onDoubleClick,
  onPanStart,
  onPanMove,
  onPanEnd,
  isPanning,
}: LightboxImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onWheel]);

  // Mouse pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only
      if (!zoom.isZoomed) return;
      e.preventDefault();
      onPanStart(e.clientX, e.clientY);
    },
    [zoom.isZoomed, onPanStart]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      onPanMove(e.clientX, e.clientY);
    },
    [onPanMove]
  );

  const handleMouseUp = useCallback(() => {
    onPanEnd();
  }, [onPanEnd]);

  // Also listen for mouseup on window to catch when mouse leaves container
  useEffect(() => {
    const handler = () => onPanEnd();
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, [onPanEnd]);

  if (hasError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-stone-500">
        <ImageIcon className="h-12 w-12 text-stone-400" />
        <p className="text-[13px] text-stone-400">Unable to load image</p>
      </div>
    );
  }

  const cursor = zoom.isZoomed
    ? isPanning
      ? "grabbing"
      : "grab"
    : "zoom-in";

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center lightbox-image-enter select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={onDoubleClick}
      style={{ cursor }}
    >
      {/* Loading placeholder */}
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-48 w-48 animate-pulse bg-stone-200" />
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.originalUrl || image.thumbnailUrl}
        alt={image.originalFilename}
        className={`max-h-[calc(100vh-120px)] max-w-full object-contain transition-opacity duration-300 ${
          isLoaded ? "opacity-100" : "opacity-0"
        }`}
        style={{
          transform: `scale(${zoom.scale}) translate(${zoom.position.x}px, ${zoom.position.y}px)`,
          transformOrigin: "center center",
          transition: isPanning ? "none" : "transform 0.15s ease-out, opacity 0.3s",
        }}
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
        draggable={false}
      />
    </div>
  );
}
