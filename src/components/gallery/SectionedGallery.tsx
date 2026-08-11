"use client";

import { useState, useMemo, useRef, useLayoutEffect, useEffect } from "react";
import { ArrowUpDown, Heart, Tag, Check } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { shuffleSeeded, sortImages, type GallerySortMode } from "@/lib/gallery/sort-images";
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
  onOpenStack,
  onDownloadStack,
  celebrateFirstFavorite,
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
  /** Clicking a stack card opens its mini gallery (page-level modal). */
  onOpenStack?: (stack: GalleryStack) => void;
  /** Hover pill on stack cards — download the stack as one ZIP. */
  onDownloadStack?: (stack: GalleryStack) => void;
  /** D2: first-favorite celebration flag, threaded to the grid. */
  celebrateFirstFavorite?: boolean;
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
  // Land on the first real section; "All" (when enabled) is a supplementary
  // view at the END of the nav, never the default.
  const [activeTab, setActiveTab] = useState<string>(
    sections[0]?.id ?? "all"
  );
  // Seed from the photographer's chosen sort (event settings); visitors can
  // still re-sort via the dropdown. "manual" = the stored section arrangement.
  // null = "as arranged": each section renders in its own stored order. Set
  // only when the VISITOR picks a sort, and then it applies across tabs.
  const [sortBy, setSortBy] = useState<GallerySortMode | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Tab overflow: the row scrolls horizontally. It previously measured each
  // tab and collapsed the tail into a "More ▾" dropdown, which HID whole
  // sections on narrow screens — the gallery would show only its first
  // section while the rest sat behind an unlabeled "More", reading as though
  // most of the shoot was missing. The measurement also double-counted every
  // divider (the "|" lives INSIDE the tab span, yet a DIVIDER_W was added on
  // top), which on a ~375px phone was the difference between two tabs fitting
  // and one being buried. Scrolling can't hide a section, needs no
  // measurement, and scales from 2 tabs to the archive's 45-section events.
  // (2026-08-10)
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

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
  // The section being viewed decides its own order (sortMode), because the
  // photographer arranges each section separately — Highlights can be random
  // while an alphabetical section stays on filename. `sortBy` is the VISITOR's
  // override and wins once they touch the dropdown; until then it's null and
  // each tab renders as arranged.
  const activeSectionData = sections.find((s) => s.id === activeTab);
  const effectiveSort: GallerySortMode =
    sortBy ?? activeSectionData?.sortMode ?? defaultSort;
  const effectiveSeed = activeSectionData?.sortSeed ?? 1;

  const visibleImages = useMemo(() => {
    const filtered = favoritesOnly
      ? tabImages.filter((img) => favoriteIds.has(img.id))
      : tabImages;
    if (effectiveSort === "random") {
      return shuffleSeeded(filtered, effectiveSeed);
    }
    if (effectiveSort === "manual") {
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
    return sortImages(filtered, effectiveSort);
  }, [
    tabImages,
    favoritesOnly,
    favoriteIds,
    effectiveSort,
    effectiveSeed,
    activeTab,
    sections,
  ]);

  // Surface the visible list so the page's lightbox navigates what's on screen.
  useEffect(() => {
    onVisibleImagesChange?.(visibleImages);
  }, [visibleImages, onVisibleImagesChange]);

  // Counts follow the favorites filter: with it on, each tab shows how many
  // FAVORITES it holds and zero-favorite tabs drop out (they used to keep
  // their full counts and click through to an empty grid). With no favorites
  // at all, filtering the tabs away would leave a bare toolbar — keep the
  // unfiltered tabs and let the grid show its "No favorites" message.
  const countsFollowFavorites = favoritesOnly && favoriteIds.size > 0;
  const sectionCounts = useMemo(() => {
    const counted = (ids: string[]) =>
      ids.filter(
        (id) =>
          imageMap.has(id) && (!countsFollowFavorites || favoriteIds.has(id))
      ).length;
    return new Map(sections.map((s) => [s.id, counted(s.imageIds)]));
  }, [sections, imageMap, countsFollowFavorites, favoriteIds]);

  const activeSection = sections.find((s) => s.id === activeTab);

  const allCount = countsFollowFavorites
    ? images.filter((img) => favoriteIds.has(img.id)).length
    : images.length;

  const tabs: Array<{ id: string; label: string; count: number }> = [
    ...sections
      .map((s) => ({
        id: s.id,
        label: s.name,
        count: sectionCounts.get(s.id) || 0,
      }))
      .filter((t) => t.count > 0),
    // "All" trails the real sections (Mason, 2026-08-10) — a catch-all,
    // not the headline.
    ...(showAllTab ? [{ id: "all", label: "All", count: allCount }] : []),
  ];

  // If the favorites filter just hid the active tab, land on the first tab
  // that still has something to show instead of stranding the guest.
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsFollowFavorites, tabs.map((t) => t.id).join("|")]);

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
    random: "Shuffled",
  };

  // Edge fades are the only hint that the row scrolls — the scrollbar is
  // hidden — so keep them honest about which direction still has tabs.
  useLayoutEffect(() => {
    const el = tabScrollRef.current;
    if (!el) return;

    const measure = () => {
      // 1px tolerance: fractional scroll widths otherwise leave a fade stuck on.
      const maxScroll = el.scrollWidth - el.clientWidth;
      setEdges({
        left: el.scrollLeft > 1,
        right: maxScroll > 1 && el.scrollLeft < maxScroll - 1,
      });
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });

    // Observe the CONTENT box as well as the container. Overflow is a function
    // of content width, and content can grow without the container resizing —
    // when the webfont swaps in, the tabs get wider while the scroll box keeps
    // its exact size, so a container-only observer never fires and the fade
    // stays dark on an overflowing row. (Caught in review, 2026-08-10.)
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (tabContentRef.current) ro.observe(tabContentRef.current);

    // Belt and braces: fonts.ready resolves after the swap even if, on some
    // engine, the reflow doesn't surface as an observed resize.
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [tabs.length]);

  // Keep the active tab on screen — a guest landing on a section that sits off
  // the right edge would otherwise see no indication of which one they're in.
  useEffect(() => {
    const el = tabScrollRef.current;
    el?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      behavior: "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [activeTab]);

  return (
    <div>
      {/* ─── Header row: section tabs (left) + controls (right) ─── */}
      <div
        className="mb-8 flex items-center justify-between gap-6 border-y py-2.5 text-[12px]"
        style={{ borderColor: `${colors.secondary}1f` }}
      >
        {/* Tabs — a single scrolling row. Every section stays reachable at any
            width; the fades mark which side still has more. */}
        <div className="relative flex min-w-0 flex-1 items-center">
          <div
            ref={tabScrollRef}
            className="hide-scrollbar flex min-w-0 items-center overflow-x-auto scroll-smooth"
          >
          <div ref={tabContentRef} className="flex items-center">
          {tabs.map((tab, i) => {
            const isActive = activeTab === tab.id;
            return (
              <span key={tab.id} className="flex shrink-0 items-center">
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
                  data-active={isActive}
                  aria-current={isActive ? "true" : undefined}
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
          </div>

          {/* Edge fades — pointer-events-none so they never eat a tab tap.
              Tinted with the gallery's own background so themed galleries
              don't get a white smear. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-8 transition-opacity duration-200"
            style={{
              opacity: edges.left ? 1 : 0,
              background: `linear-gradient(to right, ${colors.background}, transparent)`,
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-8 transition-opacity duration-200"
            style={{
              opacity: edges.right ? 1 : 0,
              background: `linear-gradient(to left, ${colors.background}, transparent)`,
            }}
          />

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
              <span className="hidden sm:inline">{SORT_LABELS[effectiveSort]}</span>
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
                    {effectiveSort === key && <Check size={13} style={{ color: colors.accent }} />}
                  </button>
                ))}
              </div>
            )}
          </div>


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
          celebrateFirstFavorite={celebrateFirstFavorite}
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
