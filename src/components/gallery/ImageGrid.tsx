"use client";

import { useState, useRef, useCallback } from "react";
import { Check } from "lucide-react";
import { SmartStack } from "./SmartStack";
import { useColumnCount } from "@/hooks/useColumnCount";
import type { ImageData, StackData } from "@/types/image";

interface ImageGridProps {
  images: ImageData[];
  stacks: StackData[];
  standalone: ImageData[];
  onToggleSelect?: (imageId: string) => void;
  onRangeSelect?: (imageId: string) => void;
  onImageDoubleClick?: (imageId: string) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  // Selection props
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  // Grid settings (from event settings)
  columnCount?: number;
  gap?: "tight" | "normal" | "loose";
}

const GAP_MAP = {
  tight: "gap-0.5",
  normal: "gap-1.5",
  loose: "gap-3",
};

/**
 * ImageGrid — Masonry layout with left-to-right chronological reading order.
 * Uses round-robin column distribution: image 1 → col 1, image 2 → col 2, etc.
 * Selection-first: checkboxes always visible, single click selects, double-click opens lightbox.
 */
export function ImageGrid({
  stacks,
  standalone,
  onToggleSelect,
  onRangeSelect,
  onImageDoubleClick,
  onSetCover,
  hasSelection,
  selectedIds,
  columnCount: settingsColumnCount,
  gap = "normal",
}: ImageGridProps) {
  const gridItems: Array<
    | { type: "stack"; data: StackData }
    | { type: "image"; data: ImageData }
  > = [
    ...stacks.map((s) => ({ type: "stack" as const, data: s })),
    ...standalone.map((i) => ({ type: "image" as const, data: i })),
  ];

  const responsiveColCount = useColumnCount();
  const colCount = settingsColumnCount ?? responsiveColCount;
  const gapClass = GAP_MAP[gap];

  if (gridItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-editorial text-xl text-stone-400 italic">
          No images yet
        </p>
        <p className="mt-2 text-[13px] text-stone-300">
          Upload some photos to get started
        </p>
      </div>
    );
  }

  // Distribute items into columns round-robin for left-to-right reading order
  const columns: Array<typeof gridItems> = Array.from(
    { length: colCount },
    () => []
  );
  gridItems.forEach((item, i) => {
    columns[i % colCount].push(item);
  });

  return (
    <div className={`flex ${gapClass}`}>
      {columns.map((col, colIdx) => (
        <div key={colIdx} className={`flex-1 flex flex-col ${gapClass}`}>
          {col.map((item) => {
            if (item.type === "stack") {
              return (
                <div key={`stack-${item.data.id}`}>
                  <SmartStack
                    stackId={item.data.id}
                    stackType={item.data.stackType}
                    imageCount={item.data.imageCount}
                    images={item.data.images.map((img) => ({
                      ...img,
                      stackRank: img.stackRank ?? 0,
                    }))}
                    personName={item.data.personName}
                    onToggleSelect={onToggleSelect}
                    onImageDoubleClick={onImageDoubleClick}
                    onSetCover={onSetCover}
                    hasSelection={hasSelection}
                    selectedIds={selectedIds}
                  />
                </div>
              );
            }

            const isSelected = selectedIds?.has(item.data.id) ?? false;

            return (
              <GridImage
                key={`img-${item.data.id}`}
                image={item.data}
                hasSelection={hasSelection}
                isSelected={isSelected}
                onSelect={() => onToggleSelect?.(item.data.id)}
                onRangeSelect={() => onRangeSelect?.(item.data.id)}
                onDoubleClick={() => onImageDoubleClick?.(item.data.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Individual grid cell with natural aspect ratio + fade-in on load.
 *  Selection-first: single click → select, double click → lightbox.
 */
function GridImage({
  image,
  onSelect,
  onRangeSelect,
  onDoubleClick,
  hasSelection,
  isSelected,
}: {
  image: ImageData;
  onSelect: () => void;
  onRangeSelect: () => void;
  onDoubleClick: () => void;
  hasSelection?: boolean;
  isSelected?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Shift+click → range select (immediate, no debounce)
      if (e.shiftKey) {
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        onRangeSelect();
        return;
      }

      // Single click debounced — wait 200ms to see if double-click follows
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onSelect();
      }, 200);
    },
    [onSelect, onRangeSelect]
  );

  const handleDoubleClick = useCallback(() => {
    // Cancel the pending single-click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick();
  }, [onDoubleClick]);

  return (
    <button
      data-image-id={image.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group relative w-full overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${
        isSelected ? "ring-2 ring-accent ring-inset" : ""
      }`}
    >
      {/* Selection checkbox — always visible */}
      <div className="absolute top-2 left-2 z-10">
        <div
          className={`w-5 h-5 border-2 flex items-center justify-center transition-all duration-150 ${
            isSelected
              ? "bg-accent border-accent"
              : hasSelection
              ? "border-white/80 bg-black/20 backdrop-blur-sm"
              : "border-white/60 bg-black/10 backdrop-blur-sm opacity-0 group-hover:opacity-100"
          }`}
        >
          {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </div>

      {/* Selection overlay tint */}
      {isSelected && (
        <div className="absolute inset-0 bg-accent/10 z-[1] pointer-events-none" />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image.thumbnailUrl}
        alt={image.parsedName || image.originalFilename || ""}
        className={`w-full h-auto object-cover transition-all duration-500 ${
          hasSelection ? "" : "group-hover:scale-[1.03]"
        } ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => {
          // Thumbnail doesn't exist yet — fall back to original
          if (imgRef.current && image.originalUrl && imgRef.current.src !== image.originalUrl) {
            imgRef.current.src = image.originalUrl;
          }
        }}
      />
      {/* Placeholder maintains minimum height while loading */}
      {!loaded && <div className="aspect-square" />}
    </button>
  );
}
