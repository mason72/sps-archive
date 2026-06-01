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
  style?: "masonry" | "uniform";
  showFilenames?: boolean;
}

/** Gap in px for each density — applied as column-gap + item margin-bottom. */
const GAP_PX = { tight: 2, normal: 6, loose: 12 } as const;

/**
 * ImageGrid — masonry via native CSS multi-column layout.
 *
 * The browser balances column heights using the ACTUAL rendered height of each
 * tile, so the layout is correct regardless of whether we know image
 * dimensions. (The previous hand-rolled version packed items into the shortest
 * column using an estimated height from DB width/height; when those were null —
 * the common case — every tile was estimated as a square and the columns came
 * out wildly uneven with big blank gaps. CSS multicol removes that whole class
 * of bug and the dimension dependency.)
 *
 * Tiles use break-inside-avoid so an image is never split across a column
 * boundary. Reading order is top-to-bottom within a column, then the next
 * column — the standard masonry flow.
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
  style = "masonry",
  showFilenames,
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
  const gapPx = GAP_PX[gap];

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

  return (
    <div style={{ columnCount: colCount, columnGap: `${gapPx}px` }}>
      {gridItems.map((item) => {
        const key =
          item.type === "stack"
            ? `stack-${item.data.id}`
            : `img-${item.data.id}`;
        return (
          <div
            key={key}
            // break-inside-avoid keeps a tile whole within one column.
            className="break-inside-avoid"
            style={{ marginBottom: `${gapPx}px` }}
          >
            {item.type === "stack" ? (
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
                showFilename={showFilenames}
              />
            ) : (
              <GridImage
                image={item.data}
                hasSelection={hasSelection}
                isSelected={selectedIds?.has(item.data.id) ?? false}
                selectedIds={selectedIds}
                onSelect={() => onToggleSelect?.(item.data.id)}
                onRangeSelect={() => onRangeSelect?.(item.data.id)}
                onDoubleClick={() => onImageDoubleClick?.(item.data.id)}
                uniform={style === "uniform"}
                showFilename={showFilenames}
              />
            )}
          </div>
        );
      })}
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
  selectedIds,
  uniform,
  showFilename,
}: {
  image: ImageData;
  onSelect: () => void;
  onRangeSelect: () => void;
  onDoubleClick: () => void;
  hasSelection?: boolean;
  isSelected?: boolean;
  selectedIds?: Set<string>;
  uniform?: boolean;
  showFilename?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // One-shot guard so the on-error original fallback can't loop.
  const triedFallback = useRef(false);
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

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // If this image is selected, drag all selected images; otherwise just this one
      const ids = isSelected && selectedIds?.size ? Array.from(selectedIds) : [image.id];
      e.dataTransfer.setData("application/x-image-ids", JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
    },
    [image.id, isSelected, selectedIds]
  );

  return (
    <button
      data-image-id={image.id}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group relative block w-full overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${
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

      {/* Fixed-aspect box. Reserving the tile's FINAL height up front (from the
          image's known dimensions) means the image loads into already-correct
          space — zero layout shift, so CSS multicol never re-balances mid-load.
          That eliminated the grid-wide flicker as lazy images streamed in.
          Falls back to 3:4 only when dimensions are unknown. */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: uniform
            ? "1 / 1"
            : image.width && image.height
            ? `${image.width} / ${image.height}`
            : "3 / 4",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={image.thumbnailUrl}
          alt={image.parsedName || image.originalFilename || ""}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={async () => {
            // Thumbnail missing/broken. SELF-HEAL: ask the server to rebuild it
            // from the original, then swap in the fresh thumbnail — so the gap
            // is permanently fixed for next load, not patched every time. Falls
            // back to the signed original if regeneration fails. One-shot
            // guarded so it can't loop.
            if (!imgRef.current || triedFallback.current) {
              setLoaded(true); // stop hiding the (broken) tile
              return;
            }
            triedFallback.current = true;
            try {
              const regen = await fetch(
                `/api/images/${image.id}/regenerate-thumbnail`,
                { method: "POST" }
              );
              if (regen.ok) {
                const { thumbnailUrl } = await regen.json();
                if (thumbnailUrl && imgRef.current) {
                  imgRef.current.src = thumbnailUrl;
                  return;
                }
              }
              // Regeneration failed — fall back to the signed original.
              const res = await fetch(`/api/images/${image.id}`);
              if (res.ok) {
                const detail = await res.json();
                const url = detail.originalUrl || detail.thumbnailUrl;
                if (url && imgRef.current) {
                  imgRef.current.src = url;
                  return;
                }
              }
            } catch {
              /* fall through */
            }
            setLoaded(true);
          }}
        />
      </div>
      {showFilename && image.originalFilename && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 pointer-events-none z-[2]">
          <p className="text-[11px] text-white truncate">
            {image.originalFilename}
          </p>
        </div>
      )}
    </button>
  );
}
