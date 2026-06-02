"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown, Heart, Tag, Check } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import type { GalleryImage, GallerySection } from "@/types/gallery";

type SortBy = "upload" | "filename" | "date-taken";

/**
 * Tabbed gallery renderer for public + preview galleries.
 *
 * Section navigation is rendered as elegant inline tabs (text separated by
 * hairline dividers, the active one underlined in the accent color) rather than
 * pill "filter" chips. A toolbar offers Sort, an All/Favorites filter, and a
 * filename-display toggle — matching the editor.
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
  const [activeTab, setActiveTab] = useState<string>(
    showAllTab ? "all" : sections[0]?.id ?? "all"
  );
  const [sortBy, setSortBy] = useState<SortBy>("upload");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const imageMap = useMemo(
    () => new Map(images.map((img) => [img.id, img])),
    [images]
  );

  // Base set for the active tab.
  const tabImages = useMemo(() => {
    if (activeTab === "all") return images;
    return (
      sections
        .find((s) => s.id === activeTab)
        ?.imageIds.map((id) => imageMap.get(id))
        .filter((img): img is GalleryImage => !!img) ?? []
    );
  }, [activeTab, images, sections, imageMap]);

  // Apply favorites filter + sort.
  const visibleImages = useMemo(() => {
    let list = favoritesOnly
      ? tabImages.filter((img) => favoriteIds.has(img.id))
      : tabImages;
    list = [...list];
    if (sortBy === "filename") {
      list.sort((a, b) =>
        (a.originalFilename || "").localeCompare(b.originalFilename || "")
      );
    } else if (sortBy === "date-taken") {
      list.sort((a, b) => {
        const at = a.takenAt || "";
        const bt = b.takenAt || "";
        if (!at && !bt) return 0;
        if (!at) return 1;
        if (!bt) return -1;
        return at.localeCompare(bt);
      });
    }
    // "upload" keeps the server order.
    return list;
  }, [tabImages, favoritesOnly, favoriteIds, sortBy]);

  const sectionCounts = useMemo(
    () =>
      new Map(
        sections.map((s) => [
          s.id,
          s.imageIds.filter((id) => imageMap.has(id)).length,
        ])
      ),
    [sections, imageMap]
  );

  const activeSection = sections.find((s) => s.id === activeTab);
  const favCount = favoriteIds.size;

  const tabs: Array<{ id: string; label: string; count: number }> = [
    ...(showAllTab ? [{ id: "all", label: "All", count: images.length }] : []),
    ...sections
      .map((s) => ({
        id: s.id,
        label: s.name,
        count: sectionCounts.get(s.id) || 0,
      }))
      .filter((t) => t.count > 0),
  ];

  const SORT_LABELS: Record<SortBy, string> = {
    upload: "Latest",
    filename: "Filename",
    "date-taken": "Date taken",
  };

  return (
    <div>
      {/* ─── Section tabs (inline, hairline-divided, active underlined) ─── */}
      <div className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-2">
        {tabs.map((tab, i) => {
          const isActive = activeTab === tab.id;
          return (
            <span key={tab.id} className="flex items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className="mx-3 select-none text-[12px]"
                  style={{ color: `${colors.secondary}40` }}
                >
                  |
                </span>
              )}
              <button
                onClick={() => setActiveTab(tab.id)}
                className="group relative pb-1 text-[13px] tracking-wide transition-opacity duration-200 whitespace-nowrap cursor-pointer"
                style={{
                  color: isActive ? colors.primary : colors.secondary,
                  fontWeight: isActive ? 600 : 400,
                  opacity: isActive ? 1 : 0.7,
                }}
              >
                {tab.label}
                <span
                  className="ml-1.5 text-[11px] tabular-nums"
                  style={{ opacity: 0.5 }}
                >
                  {tab.count}
                </span>
                {/* Active underline */}
                <span
                  className="absolute -bottom-px left-0 h-[2px] transition-all duration-300"
                  style={{
                    width: isActive ? "100%" : "0%",
                    backgroundColor: colors.accent,
                  }}
                />
              </button>
            </span>
          );
        })}
      </div>

      {/* ─── Controls: sort / favorites filter / filename toggle ─── */}
      <div
        className="mb-8 flex items-center gap-5 border-y py-2.5 text-[12px]"
        style={{ borderColor: `${colors.secondary}1f` }}
      >
        {/* Sort */}
        <div className="relative">
          <button
            onClick={() => setSortOpen((o) => !o)}
            onBlur={() => setTimeout(() => setSortOpen(false), 150)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: colors.secondary }}
          >
            <ArrowUpDown size={13} />
            {SORT_LABELS[sortBy]}
          </button>
          {sortOpen && (
            <div
              className="absolute left-0 top-7 z-20 min-w-[150px] overflow-hidden rounded-md border bg-white py-1 shadow-lg"
              style={{ borderColor: `${colors.secondary}1f` }}
            >
              {(Object.keys(SORT_LABELS) as SortBy[]).map((key) => (
                <button
                  key={key}
                  onMouseDown={() => {
                    setSortBy(key);
                    setSortOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-stone-50"
                  style={{ color: colors.primary }}
                >
                  {SORT_LABELS[key]}
                  {sortBy === key && <Check size={13} style={{ color: colors.accent }} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Favorites filter (only when favorites are enabled) */}
        {allowFavorites && (
          <button
            onClick={() => setFavoritesOnly((v) => !v)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: favoritesOnly ? colors.accent : colors.secondary }}
          >
            <Heart size={13} fill={favoritesOnly ? colors.accent : "none"} />
            {favoritesOnly ? "Favorites" : "All images"}
            {favCount > 0 && (
              <span className="text-[11px] tabular-nums" style={{ opacity: 0.6 }}>
                {favoritesOnly ? "" : `· ${favCount} ♥`}
              </span>
            )}
          </button>
        )}

        {/* Filename toggle */}
        <button
          onClick={() => setShowFilenames((v) => !v)}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          style={{ color: showFilenames ? colors.accent : colors.secondary }}
        >
          <Tag size={13} />
          {showFilenames ? "Filenames on" : "Filenames off"}
        </button>
      </div>

      {/* ─── Active section description ─── */}
      {activeSection?.description && (
        <p className="mb-6 -mt-2 text-[14px] italic" style={{ color: colors.secondary }}>
          {activeSection.description}
        </p>
      )}

      {/* ─── Gallery grid ─── */}
      {visibleImages.length > 0 ? (
        <GalleryGrid
          images={visibleImages}
          allowDownload={allowDownload}
          allowFavorites={allowFavorites}
          favoriteIds={favoriteIds}
          onFavorite={onFavorite}
          onImageClick={onImageClick}
          onDownloadClick={onDownloadClick}
          gridStyle={gridStyle}
          gridColumns={gridColumns}
          gridGap={gridGap}
          showFilenames={showFilenames}
        />
      ) : (
        <p
          className="py-16 text-center text-[14px] italic"
          style={{ color: colors.secondary }}
        >
          {favoritesOnly ? "No favorites in this section" : "No photos in this section"}
        </p>
      )}
    </div>
  );
}
