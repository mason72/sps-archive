"use client";

import { useState } from "react";
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
  onImageClick?: (imageId: string) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  // Selection props
  isSelecting?: boolean;
  selectedIds?: Set<string>;
}

/**
 * SmartStack — Expandable image stack with best shot on top.
 * Supports multi-select mode with checkbox overlays.
 */
export function SmartStack({
  stackId,
  stackType,
  imageCount,
  images,
  personName,
  onImageClick,
  onSetCover,
  isSelecting,
  selectedIds,
}: SmartStackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cover = images[0];

  if (!cover) return null;

  // In selection mode, count how many images in this stack are selected
  const selectedCount = isSelecting
    ? images.filter((img) => selectedIds?.has(img.id)).length
    : 0;
  const allSelected = isSelecting && selectedCount === images.length;

  return (
    <div className="group relative">
      {/* ─── Collapsed view ─── */}
      {!isExpanded && (
        <button
          onClick={() => {
            if (isSelecting) {
              // Toggle all images in stack
              images.forEach((img) => onImageClick?.(img.id));
            } else {
              setIsExpanded(true);
            }
          }}
          className={cn(
            "relative block w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2",
            isSelecting && allSelected && "ring-2 ring-accent ring-inset"
          )}
        >
          {/* Selection checkbox */}
          {isSelecting && (
            <div className="absolute top-2 left-2 z-10">
              <div
                className={`w-5 h-5 border-2 flex items-center justify-center transition-all duration-150 ${
                  allSelected
                    ? "bg-accent border-accent"
                    : selectedCount > 0
                    ? "bg-accent/50 border-accent"
                    : "border-white/80 bg-black/20 backdrop-blur-sm"
                }`}
              >
                {(allSelected || selectedCount > 0) && (
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                )}
              </div>
            </div>
          )}

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
              className={cn(
                "h-full w-full object-cover transition-transform duration-500",
                !isSelecting && "group-hover:scale-[1.03]"
              )}
              loading="lazy"
            />

            {/* Selection overlay tint */}
            {isSelecting && allSelected && (
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
        </button>
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
                <button
                  key={img.id}
                  onClick={() => onImageClick?.(img.id)}
                  className={cn(
                    "group/img relative aspect-[3/4] overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
                    !isSelecting && img.id === cover.id && "ring-2 ring-stone-900",
                    isSelecting && isSelected && "ring-2 ring-accent ring-inset"
                  )}
                >
                  {/* Selection checkbox in expanded view */}
                  {isSelecting && (
                    <div className="absolute top-1 left-1 z-10">
                      <div
                        className={`w-4 h-4 border-2 flex items-center justify-center transition-all duration-150 ${
                          isSelected
                            ? "bg-accent border-accent"
                            : "border-white/80 bg-black/20 backdrop-blur-sm"
                        }`}
                      >
                        {isSelected && (
                          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                        )}
                      </div>
                    </div>
                  )}

                  <img
                    src={img.thumbnailUrl}
                    alt={img.originalFilename}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />

                  {/* Selection overlay tint */}
                  {isSelecting && isSelected && (
                    <div className="absolute inset-0 bg-accent/10 pointer-events-none" />
                  )}

                  {/* Best shot indicator */}
                  {!isSelecting && img.id === cover.id && (
                    <div className="absolute left-1.5 top-1.5 bg-stone-900 p-1">
                      <Star className="h-2.5 w-2.5 fill-white text-white" />
                    </div>
                  )}

                  {/* Set as cover button */}
                  {!isSelecting && img.id !== cover.id && (
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
                  {!isSelecting && img.aestheticScore != null && (
                    <div className="absolute bottom-1 right-1 bg-black/50 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-white/80">
                      {Math.round(img.aestheticScore * 100)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
