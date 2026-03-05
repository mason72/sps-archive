"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import type { ImageData } from "@/types/image";
import type { ComparisonZoomState } from "@/hooks/useComparison";

interface ComparisonPaneProps {
  image: ImageData;
  zoom: ComparisonZoomState;
  isPanning: boolean;
  onWheel: (e: WheelEvent) => void;
  onDoubleClick: () => void;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  label: string;
  isLoading?: boolean;
}

/**
 * ComparisonPane — Single image pane with zoom/pan support.
 * Reuses the CSS transform pattern from LightboxImage.
 */
export function ComparisonPane({
  image,
  zoom,
  isPanning,
  onWheel,
  onDoubleClick,
  onPanStart,
  onPanMove,
  onPanEnd,
  label,
  isLoading,
}: ComparisonPaneProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset loaded state when image changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [image.id]);

  // Attach wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onWheel]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (zoom.scale <= 1) return;
      e.preventDefault();
      onPanStart(e.clientX, e.clientY);
    },
    [zoom.scale, onPanStart]
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

  // Catch mouseup outside container
  useEffect(() => {
    const handler = () => onPanEnd();
    window.addEventListener("mouseup", handler);
    return () => window.removeEventListener("mouseup", handler);
  }, [onPanEnd]);

  const cursor = zoom.scale > 1
    ? isPanning
      ? "grabbing"
      : "grab"
    : "zoom-in";

  if (hasError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-stone-50">
        <ImageIcon className="h-10 w-10 text-stone-300" />
        <p className="text-[12px] text-stone-400">Unable to load</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden select-none bg-stone-50"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={onDoubleClick}
      style={{ cursor }}
    >
      {/* Side label */}
      <div className="absolute top-3 left-3 z-10">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-stone-400 bg-white/80 backdrop-blur-sm px-2 py-1">
          {label}
        </span>
      </div>

      {/* Zoom indicator */}
      {zoom.scale > 1 && (
        <div className="absolute bottom-3 right-3 z-10">
          <span className="text-[11px] tabular-nums text-stone-400 font-medium tracking-wider bg-white/80 backdrop-blur-sm px-2 py-1">
            {zoom.scale.toFixed(1)}x
          </span>
        </div>
      )}

      {/* Loading state */}
      {(!isLoaded || isLoading) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-stone-300 animate-spin" />
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.originalUrl || image.thumbnailUrl}
        alt={image.originalFilename}
        className={`max-h-full max-w-full object-contain transition-opacity duration-300 ${
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
