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
      {/* ─── Tab bar ─── */}
      <div className="flex gap-1 mb-8 overflow-x-auto pb-px scrollbar-hide">
        {showAllTab && (
          <button
            onClick={() => setActiveTab("all")}
            className={cn(
              "px-4 py-2 text-[13px] font-medium rounded-full transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0",
              activeTab === "all"
                ? "text-white"
                : "hover:opacity-80"
            )}
            style={{
              backgroundColor: activeTab === "all" ? colors.primary : `${colors.secondary}15`,
              color: activeTab === "all" ? colors.background : colors.secondary,
            }}
          >
            All ({images.length})
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
                "px-4 py-2 text-[13px] font-medium rounded-full transition-colors duration-200 cursor-pointer whitespace-nowrap shrink-0",
                activeTab === section.id
                  ? "text-white"
                  : "hover:opacity-80"
              )}
              style={{
                backgroundColor: activeTab === section.id ? colors.primary : `${colors.secondary}15`,
                color: activeTab === section.id ? colors.background : colors.secondary,
              }}
            >
              {section.name} ({count})
            </button>
          );
        })}
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
