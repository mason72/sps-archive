"use client";

import { useState, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { SmartStack } from "./SmartStack";
import type { ImageData, StackData } from "@/types/image";

interface ImageGridProps {
  images: ImageData[];
  stacks: StackData[];
  standalone: ImageData[];
  onImageClick?: (imageId: string, shiftKey?: boolean) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  // Selection props
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (imageId: string) => void;
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
 * Supports multi-select mode with checkbox overlays.
 */
export function ImageGrid({
  stacks,
  standalone,
  onImageClick,
  onSetCover,
  isSelecting,
  selectedIds,
  onToggleSelect,
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
                    onImageClick={
                      isSelecting
                        ? (id) => onToggleSelect?.(id)
                        : onImageClick
                    }
                    onSetCover={onSetCover}
                    isSelecting={isSelecting}
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
                isSelecting={isSelecting}
                isSelected={isSelected}
                onClick={(shiftKey) => {
                  if (isSelecting) {
                    onToggleSelect?.(item.data.id);
                  } else {
                    onImageClick?.(item.data.id, shiftKey);
                  }
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Responsive column count matching Tailwind breakpoints */
function useColumnCount() {
  const [count, setCount] = useState(4);

  useEffect(() => {
    function update() {
      const w = window.innerWidth;
      if (w >= 1280) setCount(7);
      else if (w >= 1024) setCount(6);
      else if (w >= 768) setCount(5);
      else if (w >= 640) setCount(4);
      else setCount(3);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return count;
}

/** Individual grid cell with natural aspect ratio + fade-in on load */
function GridImage({
  image,
  onClick,
  isSelecting,
  isSelected,
}: {
  image: ImageData;
  onClick: (shiftKey?: boolean) => void;
  isSelecting?: boolean;
  isSelected?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <button
      onClick={(e) => onClick(e.shiftKey)}
      className={`group relative w-full overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isSelecting ? "cursor-pointer" : "photo-lift"
      } ${isSelected ? "ring-2 ring-accent ring-inset" : ""}`}
    >
      {/* Selection checkbox */}
      {isSelecting && (
        <div className="absolute top-2 left-2 z-10">
          <div
            className={`w-5 h-5 border-2 flex items-center justify-center transition-all duration-150 ${
              isSelected
                ? "bg-accent border-accent"
                : "border-white/80 bg-black/20 backdrop-blur-sm"
            }`}
          >
            {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </div>
        </div>
      )}

      {/* Selection overlay tint */}
      {isSelecting && isSelected && (
        <div className="absolute inset-0 bg-accent/10 z-[1] pointer-events-none" />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={image.thumbnailUrl}
        alt=""
        className={`w-full h-auto object-cover transition-all duration-500 ${
          isSelecting ? "" : "group-hover:scale-[1.03]"
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
