"use client";

import { SmartStack } from "./SmartStack";

interface ImageData {
  id: string;
  r2Key: string;
  thumbnailUrl: string;
  originalFilename: string;
  aestheticScore: number | null;
  stackId: string | null;
  stackRank: number | null;
  parsedName: string | null;
}

interface StackData {
  id: string;
  stackType: "face" | "burst" | "similar";
  imageCount: number;
  personName: string | null;
  images: ImageData[];
}

interface ImageGridProps {
  /** All images for the current view, already grouped */
  images: ImageData[];
  /** Stack groupings */
  stacks: StackData[];
  /** Standalone images (not in any stack) */
  standalone: ImageData[];
  /** Callback when image is clicked for lightbox */
  onImageClick?: (imageId: string) => void;
  /** Callback when stack cover is changed */
  onSetCover?: (stackId: string, imageId: string) => void;
}

/**
 * ImageGrid — Masonry-style grid that renders SmartStacks and standalone images.
 *
 * Stacks appear as single cards that expand in-place.
 * Standalone images render normally.
 * Uses CSS columns for masonry layout (no JS measurement needed).
 */
export function ImageGrid({
  stacks,
  standalone,
  onImageClick,
  onSetCover,
}: ImageGridProps) {
  // Interleave stacks and standalone images
  // Sort by: stacks first (by person name or timestamp), then standalone
  const gridItems: Array<
    | { type: "stack"; data: StackData }
    | { type: "image"; data: ImageData }
  > = [
    ...stacks.map((s) => ({ type: "stack" as const, data: s })),
    ...standalone.map((i) => ({ type: "image" as const, data: i })),
  ];

  if (gridItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-400">
        <p className="text-lg">No images yet</p>
        <p className="text-sm">Upload some photos to get started</p>
      </div>
    );
  }

  return (
    <div className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6">
      {gridItems.map((item) => {
        if (item.type === "stack") {
          return (
            <div key={`stack-${item.data.id}`} className="mb-3 break-inside-avoid">
              <SmartStack
                stackId={item.data.id}
                stackType={item.data.stackType}
                imageCount={item.data.imageCount}
                images={item.data.images.map((img) => ({
                  ...img,
                  stackRank: img.stackRank ?? 0,
                }))}
                personName={item.data.personName}
                onImageClick={onImageClick}
                onSetCover={onSetCover}
              />
            </div>
          );
        }

        return (
          <div key={`img-${item.data.id}`} className="mb-3 break-inside-avoid">
            <button
              onClick={() => onImageClick?.(item.data.id)}
              className="group relative block w-full overflow-hidden rounded-lg bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500"
            >
              <img
                src={item.data.thumbnailUrl}
                alt={item.data.originalFilename}
                className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                loading="lazy"
              />
              {item.data.parsedName && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-4">
                  <p className="text-xs font-medium text-white">
                    {item.data.parsedName}
                  </p>
                </div>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
