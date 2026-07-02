"use client";

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { ArrowUpDown, Heart, Tag, Check, ChevronDown, Layers } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { sortImages, type GallerySortMode } from "@/lib/gallery/sort-images";
import { orderByPrimarySection } from "@/lib/gallery/order-manual";
import type { GalleryStack } from "@/lib/gallery/stacks";
import type { GalleryImage, GallerySection } from "@/types/gallery";

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
  onFavoriteMany,
  onImageClick,
  onDownloadClick,
  gridStyle,
  gridColumns,
  gridGap,
  colors,
  showAllTab = false,
  defaultSort = "manual",
  smartStacks = false,
  stacksToggle,
  onOpenStack,
  onDownloadStack,
  onActiveSectionChange,
  onVisibleImagesChange,
}: {
  images: GalleryImage[];
  sections: GallerySection[];
  allowDownload: boolean;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  /** Batch favorite/unfavorite — powers smart stacks' heart-all. */
  onFavoriteMany?: (imageIds: string[], favorite: boolean) => void;
  onImageClick: (id: string) => void;
  onDownloadClick?: (image: GalleryImage) => void;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
  /** Group same-person photos into rotating stacks (event setting). */
  smartStacks?: boolean;
  /**
   * Guest-side stacks on/off control (shown only when the event enables
   * Smart Stacks). Local to the visitor — never changes the event setting.
   */
  stacksToggle?: { on: boolean; onToggle: () => void };
  /** Clicking a stack card opens its mini gallery (page-level modal). */
  onOpenStack?: (stack: GalleryStack) => void;
  /** Hover pill on stack cards — download the stack as one ZIP. */
  onDownloadStack?: (stack: GalleryStack) => void;
  colors: { primary: string; secondary: string; accent: string; background: string };
  /** Show "All" tab — true for preview/edit, false for public galleries */
  showAllTab?: boolean;
  /** Initial sort — the photographer's choice from event settings (grid.sortBy). */
  defaultSort?: GallerySortMode;
  /** Reports the active section up to the page (for the header section label). */
  onActiveSectionChange?: (
    info: { id: string; name: string; count: number } | null
  ) => void;
  /**
   * Reports the currently visible, ordered image list (active tab + favorites
   * filter + sort applied) so the page's lightbox can navigate what's on
   * screen instead of the full gallery.
   */
  onVisibleImagesChange?: (images: GalleryImage[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<string>(
    showAllTab ? "all" : sections[0]?.id ?? "all"
  );
  // Seed from the photographer's chosen sort (event settings); visitors can
  // still re-sort via the dropdown. "manual" = the stored section arrangement.
  const [sortBy, setSortBy] = useState<GallerySortMode>(defaultSort);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Tab overflow: measure each tab's width against the available space (row
  // minus the controls) and collapse the tail into a "More ▾" dropdown so tabs
  // never run into the sort/filter controls.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabWidthsRef = useRef<number[]>([]);
  const [visibleCount, setVisibleCount] = useState<number>(Infinity);

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

  // Apply favorites filter, then the chosen order. "Manual" uses the stored
  // per-section arrangement (tabImages already arrive in section.imageIds order;
  // the "All" tab reflects every section's order via primary-section). The other
  // modes use the shared comparator (same as the editor).
  const visibleImages = useMemo(() => {
    const filtered = favoritesOnly
      ? tabImages.filter((img) => favoriteIds.has(img.id))
      : tabImages;
    if (sortBy === "manual") {
      if (activeTab === "all") {
        const manualSections = sections.map((s, i) => ({
          id: s.id,
          sortOrder: i, // sections arrive pre-ordered by sort_order
          imageIds: s.imageIds,
        }));
        return orderByPrimarySection(filtered, manualSections);
      }
      // A section tab: filtered preserves section.imageIds order already.
      return filtered;
    }
    return sortImages(filtered, sortBy);
  }, [tabImages, favoritesOnly, favoriteIds, sortBy, activeTab, sections]);

  // Surface the visible list so the page's lightbox navigates what's on screen.
  useEffect(() => {
    onVisibleImagesChange?.(visibleImages);
  }, [visibleImages, onVisibleImagesChange]);

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

  // Surface the active section to the page so it can render the header label.
  const activeTabInfo = tabs.find((t) => t.id === activeTab) ?? null;
  useEffect(() => {
    onActiveSectionChange?.(
      activeTabInfo
        ? { id: activeTabInfo.id, name: activeTabInfo.label, count: activeTabInfo.count }
        : null
    );
    // Primitive deps so this only fires when the active section actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabInfo?.id, activeTabInfo?.label, activeTabInfo?.count, onActiveSectionChange]);

  const SORT_LABELS: Record<GallerySortMode, string> = {
    manual: "Featured",
    upload: "Latest",
    filename: "Filename",
    "date-taken": "Date taken",
  };

  // Recompute how many tabs fit whenever the row resizes or the tab set changes.
  useLayoutEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;

    const measure = () => {
      const widths = tabWidthsRef.current;
      if (widths.length === 0) {
        setVisibleCount(tabs.length);
        return;
      }
      const available = el.clientWidth;
      const MORE_W = 72; // reserve room for the "More ▾" button
      const DIVIDER_W = 25; // the "|" + margins between tabs
      let used = 0;
      let fit = 0;
      for (let i = 0; i < widths.length; i++) {
        const next = used + widths[i] + (i > 0 ? DIVIDER_W : 0);
        // Reserve MORE_W unless this is the last tab (no More needed then).
        const reserve = i === widths.length - 1 ? 0 : MORE_W;
        if (next + reserve > available) break;
        used = next;
        fit++;
      }
      setVisibleCount(Math.max(1, fit)); // always show at least one
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  // If the active tab is hidden in overflow, surface it as the last visible tab
  // so the user always sees which section they're in.
  const activeInOverflow = overflowTabs.some((t) => t.id === activeTab);

  return (
    <div>
      {/* ─── Header row: section tabs (left) + controls (right) ─── */}
      <div
        className="mb-8 flex items-center justify-between gap-6 border-y py-2.5 text-[12px]"
        style={{ borderColor: `${colors.secondary}1f` }}
      >
        {/* Tabs — overflow collapses into "More ▾" so they never hit controls.
            overflow-hidden clips the tab row ONLY; the More popover is a sibling
            outside this clip, or it'd be hidden along with the overflowing tabs. */}
        <div ref={tabBarRef} className="flex min-w-0 flex-1 items-center">
          <div className="flex min-w-0 items-center overflow-hidden">
          {visibleTabs.map((tab, i) => {
            const isActive = activeTab === tab.id;
            return (
              <span
                key={tab.id}
                ref={(el) => {
                  // Record each tab's full width once for the overflow math.
                  if (el) tabWidthsRef.current[i] = el.getBoundingClientRect().width;
                }}
                className="flex items-center"
              >
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
                  className="group relative whitespace-nowrap pb-1 text-[13px] tracking-wide transition-opacity duration-200 cursor-pointer"
                  style={{
                    color: isActive ? colors.primary : colors.secondary,
                    fontWeight: isActive ? 600 : 400,
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  {tab.label}
                  <span className="ml-1.5 text-[11px] tabular-nums" style={{ opacity: 0.5 }}>
                    {tab.count}
                  </span>
                  <span
                    className="absolute -bottom-px left-0 h-[2px] transition-all duration-300"
                    style={{ width: isActive ? "100%" : "0%", backgroundColor: colors.accent }}
                  />
                </button>
              </span>
            );
          })}
          </div>

          {/* More ▾ overflow dropdown — sibling of the clipped tab row so the
              popover renders fully instead of being cut off by overflow-hidden. */}
          {overflowTabs.length > 0 && (
            <div className="relative flex shrink-0 items-center">
              <span
                aria-hidden
                className="mx-3 select-none text-[12px]"
                style={{ color: `${colors.secondary}40` }}
              >
                |
              </span>
              <button
                onClick={() => setMoreOpen((o) => !o)}
                onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
                className="flex items-center gap-1 whitespace-nowrap pb-1 text-[13px] tracking-wide transition-opacity hover:opacity-100 cursor-pointer"
                style={{
                  color: activeInOverflow ? colors.primary : colors.secondary,
                  fontWeight: activeInOverflow ? 600 : 400,
                  opacity: activeInOverflow ? 1 : 0.7,
                }}
              >
                More
                <ChevronDown size={13} />
              </button>
              {moreOpen && (
                <div
                  className="absolute left-0 top-8 z-20 max-h-[320px] min-w-[180px] overflow-y-auto rounded-md border bg-white py-1 shadow-lg"
                  style={{ borderColor: `${colors.secondary}1f` }}
                >
                  {overflowTabs.map((tab) => (
                    <button
                      key={tab.id}
                      onMouseDown={() => {
                        setActiveTab(tab.id);
                        setMoreOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] hover:bg-stone-50"
                      style={{ color: activeTab === tab.id ? colors.accent : colors.primary }}
                    >
                      <span className="truncate">{tab.label}</span>
                      <span className="text-[11px] tabular-nums" style={{ opacity: 0.5 }}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls — sort / favorites / filename (right-aligned, same row) */}
        <div className="flex shrink-0 items-center gap-5">
          {/* Sort */}
          <div className="relative">
            <button
              onClick={() => setSortOpen((o) => !o)}
              onBlur={() => setTimeout(() => setSortOpen(false), 150)}
              className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
              style={{ color: colors.secondary }}
            >
              <ArrowUpDown size={13} />
              <span className="hidden sm:inline">{SORT_LABELS[sortBy]}</span>
            </button>
            {sortOpen && (
              <div
                className="absolute right-0 top-7 z-20 min-w-[150px] overflow-hidden rounded-md border bg-white py-1 shadow-lg"
                style={{ borderColor: `${colors.secondary}1f` }}
              >
                {(Object.keys(SORT_LABELS) as GallerySortMode[]).map((key) => (
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

          {/* Guest stacks toggle — only when the event has Smart Stacks on */}
          {stacksToggle && (
            <button
              onClick={stacksToggle.onToggle}
              className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
              style={{ color: stacksToggle.on ? colors.accent : colors.secondary }}
              title={
                stacksToggle.on
                  ? "Show every photo individually"
                  : "Group photos of the same person into stacks"
              }
            >
              <Layers size={13} />
              <span className="hidden sm:inline">Stacks</span>
            </button>
          )}

          {/* Favorites filter */}
          {allowFavorites && (
            <button
              onClick={() => setFavoritesOnly((v) => !v)}
              className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
              style={{ color: favoritesOnly ? colors.accent : colors.secondary }}
            >
              <Heart size={13} fill={favoritesOnly ? colors.accent : "none"} />
              <span className="hidden sm:inline">
                {favoritesOnly ? "Favorites" : "All"}
              </span>
            </button>
          )}

          {/* Filename toggle */}
          <button
            onClick={() => setShowFilenames((v) => !v)}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: showFilenames ? colors.accent : colors.secondary }}
          >
            <Tag size={13} />
            <span className="hidden sm:inline">Names</span>
          </button>
        </div>
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
          onFavoriteMany={onFavoriteMany}
          onImageClick={onImageClick}
          onDownloadClick={onDownloadClick}
          onOpenStack={onOpenStack}
          onDownloadStack={onDownloadStack}
          gridStyle={gridStyle}
          gridColumns={gridColumns}
          gridGap={gridGap}
          showFilenames={showFilenames}
          smartStacks={smartStacks}
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
