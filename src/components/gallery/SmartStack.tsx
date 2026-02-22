"use client";

import { useState } from "react";
import { Layers, ChevronDown, Star } from "lucide-react";
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
  /** Stack metadata */
  stackId: string;
  stackType: "face" | "burst" | "similar";
  imageCount: number;
  /** The best image (cover) is first */
  images: StackImage[];
  /** Person name if face stack */
  personName?: string | null;
  /** Callback when an image is clicked */
  onImageClick?: (imageId: string) => void;
  /** Callback when the cover image is changed */
  onSetCover?: (stackId: string, imageId: string) => void;
}

/**
 * SmartStack — Expandable image stack with best shot on top.
 *
 * Collapsed: Shows the cover image with a stack count badge.
 *            A subtle "fanned cards" effect hints at more images underneath.
 *
 * Expanded:  Fan out all images in a grid, best first.
 *            Photographer can click to change the cover image.
 */
export function SmartStack({
  stackId,
  stackType,
  imageCount,
  images,
  personName,
  onImageClick,
  onSetCover,
}: SmartStackProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cover = images[0];

  if (!cover) return null;

  return (
    <div className="group relative">
      {/* Collapsed view — cover image with stack indicator */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="relative block w-full overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
        >
          {/* Fanned card effect behind cover */}
          {imageCount > 1 && (
            <>
              <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-lg bg-stone-200" />
              {imageCount > 2 && (
                <div className="absolute inset-0 translate-x-3 translate-y-3 rounded-lg bg-stone-300/60" />
              )}
            </>
          )}

          {/* Cover image */}
          <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-stone-100">
            <img
              src={cover.thumbnailUrl}
              alt={cover.originalFilename}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
            />

            {/* Stack count badge */}
            {imageCount > 1 && (
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
                <Layers className="h-3 w-3" />
                {imageCount}
              </div>
            )}

            {/* Person name */}
            {personName && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
                <p className="text-sm font-medium text-white">{personName}</p>
              </div>
            )}
          </div>
        </button>
      )}

      {/* Expanded view — all images in a grid */}
      {isExpanded && (
        <div className="space-y-2">
          <button
            onClick={() => setIsExpanded(false)}
            className="flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
            {personName || `${imageCount} shots`}
            <span className="text-stone-400">— pick best</span>
          </button>

          <div className="grid grid-cols-3 gap-1.5">
            {images.map((img) => (
              <button
                key={img.id}
                onClick={() => onImageClick?.(img.id)}
                className={cn(
                  "group/img relative aspect-[3/4] overflow-hidden rounded-lg bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500",
                  img.id === cover.id && "ring-2 ring-stone-900"
                )}
              >
                <img
                  src={img.thumbnailUrl}
                  alt={img.originalFilename}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />

                {/* Best shot indicator */}
                {img.id === cover.id && (
                  <div className="absolute left-1.5 top-1.5 rounded-full bg-stone-900 p-1">
                    <Star className="h-3 w-3 fill-white text-white" />
                  </div>
                )}

                {/* Set as cover button */}
                {img.id !== cover.id && (
                  <div className="absolute inset-0 flex items-end justify-center bg-black/0 pb-2 opacity-0 transition-all group-hover/img:bg-black/30 group-hover/img:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetCover?.(stackId, img.id);
                      }}
                      className="rounded-full bg-white/90 px-2 py-1 text-xs font-medium text-stone-900 shadow-sm hover:bg-white"
                    >
                      Set as best
                    </button>
                  </div>
                )}

                {/* Quality score */}
                {img.aestheticScore != null && (
                  <div className="absolute bottom-1 right-1 rounded bg-black/50 px-1 py-0.5 text-[10px] text-white/80">
                    {Math.round(img.aestheticScore * 100)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
