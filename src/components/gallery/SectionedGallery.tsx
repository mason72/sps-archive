"use client";

import { useState } from "react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { cn } from "@/lib/utils";
import type { GalleryImage, GallerySection } from "@/types/gallery";

/**
 * Tabbed gallery renderer for public + preview galleries.
 *
 * Shows section tabs at the top. Clicking a tab shows only that
 * section's images. "All" tab shows every image.
 */
export function SectionedGallery({
  images,
  sections,
  allowDownload,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onImageClick,
  onDownloadClick,
  gridStyle,
  gridColumns,
  gridGap,
  colors,
  showAllTab = false,
}: {
  images: GalleryImage[];
  sections: GallerySection[];
  allowDownload: boolean;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  onImageClick: (id: string) => void;
  onDownloadClick?: (image: GalleryImage) => void;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
  colors: { primary: string; secondary: string; accent: string; background: string };
  /** Show "All" tab — true for preview/edit, false for public galleries */
  showAllTab?: boolean;
}) {
  // Default to first section when "All" tab is hidden
  const [activeTab, setActiveTab] = useState<string>(showAllTab ? "all" : sections[0]?.id ?? "all");

  const imageMap = new Map(images.map((img) => [img.id, img]));

  // Determine which images to show based on active tab
  const visibleImages =
    activeTab === "all"
      ? images
      : sections
          .find((s) => s.id === activeTab)
          ?.imageIds.map((id) => imageMap.get(id))
          .filter((img): img is GalleryImage => !!img) ?? [];

  // Count images per section for badge
  const sectionCounts = new Map(
    sections.map((s) => [
      s.id,
      s.imageIds.filter((id) => imageMap.has(id)).length,
    ])
  );

  const gridProps = {
    allowDownload,
    allowFavorites,
    favoriteIds,
    onFavorite,
    onImageClick,
    onDownloadClick,
    gridStyle,
    gridColumns,
    gridGap,
  };

  const activeSection = sections.find((s) => s.id === activeTab);

  return (
    <div>
      {/* ─── Tab bar ───
          Squared editorial chips with a 2px bottom hairline on the active
          tab. Wrapped in a fade-edge container so when the tab list
          overflows horizontally (common on mobile / 6+ sections) the
          edges fade out — quietly hinting that more sections live
          off-screen instead of cutting them off mid-letter. */}
      <div
        className="relative mb-8 border-b border-stone-200/60"
        style={{
          // Soft gradient mask on both ends; transparent at the edges,
          // opaque in the middle. The middle stop being only ~16px in
          // means a ~24px taper on each side regardless of viewport.
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
          maskImage:
            "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
        }}
      >
        <div className="flex gap-6 overflow-x-auto pb-2 scrollbar-hide">
          {showAllTab && (
            <button
              onClick={() => setActiveTab("all")}
              className={cn(
                "relative -mb-px pb-3 text-[12px] font-medium uppercase tracking-[0.18em] transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0",
                activeTab === "all" ? "" : "hover:opacity-80"
              )}
              style={{
                color: activeTab === "all" ? colors.primary : colors.secondary,
                borderBottom:
                activeTab === "all" ? `2px solid ${colors.primary}` : "2px solid transparent",
            }}
          >
            All <span className="opacity-50 ml-1 normal-case tracking-normal">({images.length})</span>
          </button>
        )}
        {sections.map((section) => {
          const count = sectionCounts.get(section.id) || 0;
          if (count === 0) return null;
          return (
            <button
              key={section.id}
              onClick={() => setActiveTab(section.id)}
              className={cn(
                "relative -mb-px pb-3 text-[12px] font-medium uppercase tracking-[0.18em] transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0",
                activeTab === section.id ? "" : "hover:opacity-80"
              )}
              style={{
                color: activeTab === section.id ? colors.primary : colors.secondary,
                borderBottom:
                  activeTab === section.id
                    ? `2px solid ${colors.primary}`
                    : "2px solid transparent",
              }}
            >
              {section.name}{" "}
              <span className="opacity-50 ml-1 normal-case tracking-normal">
                ({count})
              </span>
            </button>
          );
        })}
        </div>
      </div>

      {/* ─── Active section description ─── */}
      {activeSection?.description && (
        <p
          className="text-[14px] italic mb-6 -mt-2"
          style={{ color: colors.secondary }}
        >
          {activeSection.description}
        </p>
      )}

      {/* ─── Gallery grid ─── */}
      {visibleImages.length > 0 ? (
        <GalleryGrid images={visibleImages} {...gridProps} />
      ) : (
        <p
          className="text-center py-16 text-[14px] italic"
          style={{ color: colors.secondary }}
        >
          No photos in this section
        </p>
      )}
    </div>
  );
}
