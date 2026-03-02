"use client";

import { useState, useRef, useCallback } from "react";
import { Layers, ChevronDown, Star, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StackImage {
  id: string;
  r2Key: string;
  thumbnailUrl: string;
  originalFilename: string;
  aestheticScore: number | null;
  stackRank: number;
  parsedName: string | null;
}

interface SmartStackProps {
  stackId: string;
  stackType: "face" | "burst" | "similar";
  imageCount: number;
  images: StackImage[];
  personName?: string | null;
  onToggleSelect?: (imageId: string) => void;
  onImageDoubleClick?: (imageId: string) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  // Selection props
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  showFilename?: boolean;
}

/**
 * SmartStack — Expandable image stack with best shot on top.
 * Selection-first: single click selects all in stack, double-click expands.
 * Checkboxes always visible.
 */
export function SmartStack({
  stackId,
  stackType,
  imageCount,
  images,
  personName,
  onToggleSelect,
  onImageDoubleClick,
  onSetCover,
  hasSelection,
  selectedIds,
  showFilename,
}: SmartStackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cover = images[0];

  if (!cover) return null;

  // Count how many images in this stack are selected
  const selectedCount = images.filter((img) => selectedIds?.has(img.id)).length;
  const allSelected = selectedCount === images.length;

  return (
    <div className="group relative">
      {/* ─── Collapsed view ─── */}
      {!isExpanded && (
        <CollapsedStack
          cover={cover}
          imageCount={imageCount}
          personName={personName}
          allSelected={allSelected}
          selectedCount={selectedCount}
          hasSelection={hasSelection}
          showFilename={showFilename}
          onSingleClick={() => {
            // Toggle all images in stack
            images.forEach((img) => onToggleSelect?.(img.id));
          }}
          onDoubleClick={() => setIsExpanded(true)}
        />
      )}

      {/* ─── Expanded view ─── */}
      {isExpanded && (
        <div className="space-y-3">
          <button
            onClick={() => setIsExpanded(false)}
            className="flex items-center gap-1.5 text-[12px] uppercase tracking-[0.12em] font-medium text-stone-500 hover:text-stone-900 transition-colors duration-300"
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            {personName || `${imageCount} shots`}
            <span className="normal-case tracking-normal italic text-stone-300 font-normal">
              — pick best
            </span>
          </button>

          <div className="grid grid-cols-3 gap-1.5">
            {images.map((img) => {
              const isSelected = selectedIds?.has(img.id) ?? false;

              return (
                <ExpandedStackImage
                  key={img.id}
                  img={img}
                  isCover={img.id === cover.id}
                  isSelected={isSelected}
                  hasSelection={hasSelection}
                  stackId={stackId}
                  showFilename={showFilename}
                  onToggleSelect={() => onToggleSelect?.(img.id)}
                  onDoubleClick={() => onImageDoubleClick?.(img.id)}
                  onSetCover={onSetCover}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsed stack — single click toggles all, double click expands */
function CollapsedStack({
  cover,
  imageCount,
  personName,
  allSelected,
  selectedCount,
  hasSelection,
  showFilename,
  onSingleClick,
  onDoubleClick,
}: {
  cover: StackImage;
  imageCount: number;
  personName?: string | null;
  allSelected: boolean;
  selectedCount: number;
  hasSelection?: boolean;
  showFilename?: boolean;
  onSingleClick: () => void;
  onDoubleClick: () => void;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onSingleClick();
    }, 200);
  }, [onSingleClick]);

  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick();
  }, [onDoubleClick]);

  return (
    <button
      data-image-id={cover.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 cursor-pointer",
        allSelected && "ring-2 ring-accent ring-inset"
      )}
    >
      {/* Selection checkbox — always visible */}
      <div className="absolute top-2 left-2 z-10">
        <div
          className={`w-5 h-5 border-2 flex items-center justify-center transition-all duration-150 ${
            allSelected
              ? "bg-accent border-accent"
              : selectedCount > 0
              ? "bg-accent/50 border-accent"
              : hasSelection
              ? "border-white/80 bg-black/20 backdrop-blur-sm"
              : "border-white/60 bg-black/10 backdrop-blur-sm opacity-0 group-hover:opacity-100"
          }`}
        >
          {(allSelected || selectedCount > 0) && (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          )}
        </div>
      </div>

      {/* Fanned card effect */}
      {imageCount > 1 && (
        <>
          <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 bg-stone-200/80" />
          {imageCount > 2 && (
            <div className="absolute inset-0 translate-x-3 translate-y-3 bg-stone-300/40" />
          )}
        </>
      )}

      {/* Cover image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
        <img
          src={cover.thumbnailUrl}
          alt={cover.originalFilename}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />

        {/* Selection overlay tint */}
        {allSelected && (
          <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
        )}

        {/* Stack count badge */}
        {imageCount > 1 && (
          <div className="absolute right-2 top-2 flex items-center gap-1 bg-black/70 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-sm">
            <Layers className="h-2.5 w-2.5" />
            {imageCount}
          </div>
        )}

        {/* Person name overlay */}
        {personName && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8">
            <p className="text-[13px] font-medium tracking-wide text-white">
              {personName}
            </p>
          </div>
        )}
      </div>
      {showFilename && (cover.parsedName || cover.originalFilename) && (
        <p className="text-[10px] text-stone-400 truncate px-1.5 py-1 bg-white">
          {cover.parsedName || cover.originalFilename}
        </p>
      )}
    </button>
  );
}

/** Single image in expanded stack — single click selects, double click opens lightbox */
function ExpandedStackImage({
  img,
  isCover,
  isSelected,
  hasSelection,
  stackId,
  showFilename,
  onToggleSelect,
  onDoubleClick,
  onSetCover,
}: {
  img: StackImage;
  isCover: boolean;
  isSelected: boolean;
  hasSelection?: boolean;
  stackId: string;
  showFilename?: boolean;
  onToggleSelect: () => void;
  onDoubleClick: () => void;
  onSetCover?: (stackId: string, imageId: string) => void;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onToggleSelect();
    }, 200);
  }, [onToggleSelect]);

  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick();
  }, [onDoubleClick]);

  return (
    <button
      data-image-id={img.id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "group/img relative aspect-[3/4] overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 cursor-pointer",
        isCover && !isSelected && "ring-2 ring-stone-900",
        isSelected && "ring-2 ring-accent ring-inset"
      )}
    >
      {/* Selection checkbox — always visible in expanded view */}
      <div className="absolute top-1 left-1 z-10">
        <div
          className={`w-4 h-4 border-2 flex items-center justify-center transition-all duration-150 ${
            isSelected
              ? "bg-accent border-accent"
              : hasSelection
              ? "border-white/80 bg-black/20 backdrop-blur-sm"
              : "border-white/60 bg-black/10 backdrop-blur-sm opacity-0 group-hover/img:opacity-100"
          }`}
        >
          {isSelected && (
            <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
          )}
        </div>
      </div>

      <img
        src={img.thumbnailUrl}
        alt={img.originalFilename}
        className="h-full w-full object-cover"
        loading="lazy"
      />

      {/* Selection overlay tint */}
      {isSelected && (
        <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
      )}

      {/* Best shot indicator */}
      {isCover && !isSelected && (
        <div className="absolute left-1.5 top-1.5 bg-stone-900 p-1">
          <Star className="h-2.5 w-2.5 fill-white text-white" />
        </div>
      )}

      {/* Set as cover button */}
      {!isCover && (
        <div className="absolute inset-0 flex items-end justify-center bg-black/0 pb-2 opacity-0 transition-all duration-300 group-hover/img:bg-black/30 group-hover/img:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetCover?.(stackId, img.id);
            }}
            className="bg-white px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-stone-900 hover:bg-stone-50 transition-colors duration-300"
          >
            Set as best
          </button>
        </div>
      )}

      {/* Quality score */}
      {img.aestheticScore != null && (
        <div className="absolute bottom-1 right-1 bg-black/50 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white/80">
          {Math.round(img.aestheticScore * 100)}
        </div>
      )}
      {showFilename && (img.parsedName || img.originalFilename) && (
        <p className="text-[10px] text-stone-400 truncate px-1 py-0.5 bg-white">
          {img.parsedName || img.originalFilename}
        </p>
      )}
    </button>
  );
}
