"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

import { UploadZone } from "@/components/upload/UploadZone";
import { SearchBar } from "@/components/search/SearchBar";
import { ImageGrid } from "@/components/gallery/ImageGrid";
import { FilmStrip } from "@/components/gallery/FilmStrip";
import { Lightbox } from "@/components/lightbox/Lightbox";
import { ShareModal } from "@/components/shares/ShareModal";
import { SelectionToolbar } from "@/components/gallery/SelectionToolbar";
import { FocalPointModal } from "@/components/gallery/FocalPointModal";
import { CurationModal } from "@/components/gallery/CurationModal";
import { EventSidebar, type Panel } from "@/components/events/EventSidebar";
import { useSelection } from "@/hooks/useSelection";
import { useMarqueeSelect } from "@/hooks/useMarqueeSelect";
import { useGalleryShortcuts } from "@/hooks/useGalleryShortcuts";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { BrandButton } from "@/components/ui/brand-button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertTriangle, X, LayoutGrid, Rows3, Eye, EyeOff, ArrowUpDown, Check, CheckSquare, Image as ImageIcon, Heart } from "lucide-react";
import type { ImageData, StackData } from "@/types/image";
import { deriveDisplayImages, deriveDisplayStacks } from "@/lib/gallery/derive-display";
import { sortImages, type GallerySortMode } from "@/lib/gallery/sort-images";
import { orderBySectionManual, orderByPrimarySection } from "@/lib/gallery/order-manual";
import type { EventSettings } from "@/types/event-settings";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
import { ImageGridSkeleton, EventSidebarSkeleton, Skeleton } from "@/components/ui/Skeleton";
import confetti from "canvas-confetti";

interface EventData {
  id: string;
  name: string;
  slug: string;
  event_type: string | null;
  event_date: string | null;
  description: string | null;
  settings?: Record<string, unknown>;
  created_at: string;
}

interface SectionData {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
  /** Section position within the event (sections.sort_order). */
  sortOrder?: number;
  /** Member image ids in manual (section_images.sort_order) order. */
  imageIds?: string[];
  /** Website scene this section feeds (TDP Website gallery), else null. */
  siteSceneKey?: string | null;
}

export default function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventData | null>(null);
  // `images` and `stacks` are DERIVED below (useMemo) from allImages/allStacks
  // + the active section + search — never set imperatively, so timing can't
  // leave the grid wrongly empty ("No images yet" while the section has photos).
  const [sections, setSections] = useState<SectionData[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [allStacks, setAllStacks] = useState<StackData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Search results live in their own state; the displayed list is derived.
  const [searchResults, setSearchResults] = useState<ImageData[] | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalImageIds, setShareModalImageIds] = useState<string[] | undefined>(undefined);
  const [eventSettings, setEventSettings] = useState<EventSettings>(DEFAULT_EVENT_SETTINGS);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [retryFiles, setRetryFiles] = useState<File[] | undefined>(undefined);
  const hadUploadErrors = useRef(false);
  const [viewMode, setViewMode] = useState<"grid" | "filmstrip">("grid");
  const [sortBy, setSortByState] = useState<GallerySortMode>("upload");
  const [sortOpen, setSortOpen] = useState(false);
  // Optimistic per-section manual order overrides (sectionId -> ordered ids).
  // Seeded from the server's stored order; updated immediately on drag, then
  // persisted in the background.
  const [manualOrderBySection, setManualOrderBySection] = useState<
    Record<string, string[]>
  >({});
  const sortRef = useRef<HTMLDivElement>(null);
  const [hasActiveShare, setHasActiveShare] = useState(false);
  const [activeShareSlug, setActiveShareSlug] = useState<string | null>(null);

  // Stable ref for activeSection so UploadZone always has the current value
  const activeSectionRef = useRef<string | null>(null);
  activeSectionRef.current = activeSection;
  // Ensures we only auto-select the default section once, on initial load.
  const didInitSectionRef = useRef(false);

  // Favorites filter (client/team favorites from the event's active share).
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  // ─── Derived displayed list (race-proof) ───
  // Pure function of (search, active section, section IDs, full set). Lives in
  // src/lib/gallery/derive-display.ts so it's unit-tested in isolation — this
  // is the logic whose imperative version caused "No images yet" on populated
  // sections. A section with un-loaded IDs falls back to the full set.
  const images = useMemo<ImageData[]>(
    () =>
      deriveDisplayImages({
        isSearching,
        searchResults,
        activeSection,
        allImages,
        allStacks,
        favoritesOnly,
        favoriteIds,
      }),
    [isSearching, searchResults, activeSection, allImages, allStacks, favoritesOnly, favoriteIds]
  );

  const stacks = useMemo<StackData[]>(
    () =>
      deriveDisplayStacks({
        isSearching,
        searchResults,
        activeSection,
        allImages,
        allStacks,
        favoritesOnly,
        favoriteIds,
      }),
    [isSearching, searchResults, activeSection, allImages, allStacks, favoritesOnly, favoriteIds]
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPanel, setSidebarPanel] = useState<Panel | null>("sections");
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const previewRefreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Selection state
  const selection = useSelection();
  // Destructure stable references for use in dependency arrays
  // (the `selection` object itself is recreated every render)
  const { selectedArray, selectedIds, count: selectionCount, hasSelection, deselectAll } = selection;

  // Switching sections re-scopes the grid, so a selection carried across is a
  // trap: it looks empty but the toolbar still acts on now-hidden photos.
  // Clear it on any actual section change (sidebar clicks).
  const handleSetActiveSection = useCallback(
    (id: string | null) => {
      if (id !== activeSectionRef.current) deselectAll();
      setActiveSection(id);
    },
    [deselectAll]
  );

  // Marquee / rubber-band selection
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const { isDrawing: isMarqueeDrawing, rect: marqueeRect } = useMarqueeSelect({
    containerRef: gridAreaRef,
    onSelect: selection.addToSelection,
    enabled: !selectedImageId && !showShareModal,
  });

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handle = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [sortOpen]);

  // Refresh preview iframe when design settings change
  const settingsKeyRef = useRef(JSON.stringify(eventSettings));
  useEffect(() => {
    const key = JSON.stringify(eventSettings);
    if (key === settingsKeyRef.current) return;
    settingsKeyRef.current = key;
    if (sidebarPanel !== "design") return;
    // Wait for the debounced save to complete before refreshing
    clearTimeout(previewRefreshTimer.current);
    previewRefreshTimer.current = setTimeout(() => {
      if (previewIframeRef.current) {
        // Use cache-busting query parameter for reliable reload
        const base = `/gallery/preview/${eventId}`;
        previewIframeRef.current.src = `${base}?t=${Date.now()}`;
      }
    }, 1200);
    return () => clearTimeout(previewRefreshTimer.current);
  }, [eventId, eventSettings, sidebarPanel]);

  // Live upload progress, owned here so a single unified bar can render it.
  const [uploadProgress, setUploadProgress] = useState<{
    active: boolean;
    total: number;
    uploaded: number;
    failed: number;
  }>({ active: false, total: 0, uploaded: 0, failed: 0 });

  // Uploads always target a real section: the selected one, or — when "All
  // Images" is the view (activeSection null) — the first section. Never null
  // once sections exist, so uploads can never become orphans.
  const uploadTargetId = activeSection ?? sections[0]?.id ?? null;

  // Active website SLOT section (slot/* — explicit single-image positions):
  // enables the focal-point action and the "first image wins" hint.
  const activeSectionData = sections.find((s) => s.id === activeSection) ?? null;
  const isSlotSection = !!activeSectionData?.siteSceneKey?.startsWith("slot/");
  const [focalImageId, setFocalImageId] = useState<string | null>(null);
  // Website curation modal (event/city/service/featured) — offered where the
  // team curates the site: the TDP Website gallery or any website section.
  const isWebsiteContext =
    event?.event_type === "website" || !!activeSectionData?.siteSceneKey;
  const [showCuration, setShowCuration] = useState(false);
  const uploadTargetName =
    sections.find((s) => s.id === uploadTargetId)?.name ?? null;

  const fetchEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`);
      if (!res.ok) throw new Error("Failed to load event");
      const data = await res.json();

      setEvent(data.event);
      setAllImages(data.images);
      setAllStacks(data.stacks);
      setSections(data.sections);

      // Auto-show the upload zone ONLY on first load (empty event). On later
      // refreshes — especially the live refresh fired while images are landing
      // — never touch showUpload, or the zone (and its queue) would vanish the
      // moment the first image arrives. After init it's user-controlled via the
      // "Add Images / Hide Upload" toggle.
      if (!didInitSectionRef.current) {
        setShowUpload(data.images.length === 0);
        // Default-select the first section (e.g. "Highlights") rather than
        // "All Images" — reinforces that uploads land in a section.
        if (data.sections.length > 0) setActiveSection(data.sections[0].id);
        didInitSectionRef.current = true;
      }
      // Load event settings
      if (data.event.settings && Object.keys(data.event.settings).length > 0) {
        const loaded = { ...DEFAULT_EVENT_SETTINGS, ...data.event.settings };
        setEventSettings(loaded);
        // Restore persisted sort preference
        if (loaded.grid?.sortBy) {
          setSortByState(loaded.grid.sortBy);
        }
      }

      // Check for active shares (for Publish/Share button + Preview link)
      try {
        const sharesRes = await fetch(`/api/shares?eventId=${eventId}`);
        if (sharesRes.ok) {
          const sharesData = await sharesRes.json();
          const activeShares = sharesData.shares?.filter(
            (s: { isActive: boolean }) => s.isActive
          ) || [];
          setHasActiveShare(activeShares.length > 0);
          // Prefer "full" share for preview; fall back to any active share
          const fullShare = activeShares.find(
            (s: { shareType: string }) => s.shareType === "full"
          );
          setActiveShareSlug(fullShare?.slug || activeShares[0]?.slug || null);
        }
      } catch {
        // Non-critical — default to no active shares
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);


  // Escape key clears selection
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && hasSelection) {
        deselectAll();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasSelection, deselectAll]);

  // Section filtering needs no effect: each image carries its own sectionIds
  // (loaded in the main event payload), so switching sections is a synchronous
  // in-memory filter in the derivation above — no fetch, no race, no blank grid.

  // Live grid population: refresh as images land, throttled so a 90-file
  // upload doesn't fire 90 fetches. Trailing-edge so the last one always runs.
  const liveRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleImageUploaded = useCallback(() => {
    if (liveRefreshTimer.current) return; // already scheduled
    liveRefreshTimer.current = setTimeout(() => {
      liveRefreshTimer.current = null;
      fetchEvent();
    }, 1500);
  }, [fetchEvent]);

  useEffect(() => {
    return () => {
      if (liveRefreshTimer.current) clearTimeout(liveRefreshTimer.current);
    };
  }, []);

  const handleUploadComplete = useCallback(
    async (imageIds: string[]) => {
      // Images are already linked to the correct section by /api/upload.
      // Final refresh to reconcile the grid, then celebrate.
      fetchEvent();
      toast.success(`${imageIds.length} images uploaded`);
      setRetryFiles(undefined);

      // Celebrate! Subtle confetti for large uploads (suppress if errors occurred)
      if (imageIds.length >= 5 && !hadUploadErrors.current) {
        confetti({
          particleCount: Math.min(imageIds.length * 3, 150),
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#1C1917", "#78716C", "#D6D3D1", "#10B981", "#A8A29E"],
          disableForReducedMotion: true,
        });
      }
    },
    [fetchEvent]
  );

  const handleUploadFailed = useCallback((files: File[]) => {
    hadUploadErrors.current = true;
    setFailedUploads((prev) => [...prev, ...files]);
    toast.error(
      `${files.length} ${files.length === 1 ? "image" : "images"} failed to upload`
    );
  }, []);

  const handleRetryUpload = useCallback((files: File[]) => {
    // Clear the failed list and trigger retry via the UploadZone retryFiles prop
    setFailedUploads([]);
    setShowUpload(true);
    // Create a new array reference so the effect in UploadZone fires
    setRetryFiles([...files]);
  }, []);

  const handleSearchResults = useCallback(
    (
      results: Array<{
        id: string;
        filename: string;
        r2Key: string;
        score: number;
        thumbnailUrl?: string;
        originalUrl?: string;
      }>,
      type: string
    ) => {
      setIsSearching(true);
      setActiveSection(null); // Clear section filter when searching
      const searchImages: ImageData[] = results.map((r) => ({
        id: r.id,
        r2Key: r.r2Key,
        thumbnailUrl: r.thumbnailUrl || "",
        originalUrl: r.originalUrl || r.thumbnailUrl || "",
        originalFilename: r.filename,
        aestheticScore: null,
        sharpnessScore: null,
        stackId: null,
        stackRank: null,
        parsedName: null,
        processingStatus: "complete",
        width: null,
        height: null,
        createdAt: new Date().toISOString(),
        takenAt: null,
      }));
      setSearchResults(searchImages);
    },
    []
  );

  const handleSearchClear = useCallback(() => {
    setIsSearching(false);
    setSearchResults(null);
    // The derived images/stacks fall back to the active section (or all).
  }, []);

  // ─── Selection actions ───
  const handleBatchDelete = useCallback(async () => {
    try {
      const cnt = selectionCount;
      const res = await fetch("/api/images/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: selectedArray }),
      });
      if (!res.ok) throw new Error("Delete failed");
      deselectAll();
      fetchEvent();
      toast.success(`Deleted ${cnt} images`);
    } catch (err) {
      console.error("Batch delete failed:", err);
      toast.error("Failed to delete images");
    }
  }, [selectedArray, selectionCount, deselectAll, fetchEvent]);

  // Load client/team favorites for this event (from the active share) when the
  // Favorites filter is switched on. Favorites are per-share and shared across
  // everyone on that link, so this reflects the team's picks.
  const loadFavorites = useCallback(async () => {
    try {
      const sharesRes = await fetch(`/api/shares?eventId=${eventId}`);
      if (!sharesRes.ok) return;
      const sharesData = await sharesRes.json();
      const active = sharesData.shares?.find((s: { isActive: boolean }) => s.isActive);
      if (!active) {
        setFavoriteIds(new Set());
        return;
      }
      const favRes = await fetch(`/api/gallery/${active.slug}/favorites?shareId=${active.id}`);
      if (!favRes.ok) return;
      const favData = await favRes.json();
      setFavoriteIds(new Set<string>((favData.favorites ?? []).map((f: { imageId: string }) => f.imageId)));
    } catch {
      /* non-critical */
    }
  }, [eventId]);

  const toggleFavoritesFilter = useCallback(() => {
    setFavoritesOnly((on) => {
      const next = !on;
      if (next) loadFavorites(); // refresh on enable
      return next;
    });
  }, [loadFavorites]);

  // Set an image as the gallery cover (event.settings.cover.imageId). The
  // public gallery hero uses this. PATCH merges settings server-side.
  const handleSetCover = useCallback(
    async (imageId: string) => {
      try {
        const nextCover = {
          ...eventSettings.cover,
          enabled: true,
          imageId,
        };
        const res = await fetch(`/api/events/${eventId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { cover: nextCover } }),
        });
        if (!res.ok) throw new Error("Failed to set cover");
        setEventSettings((prev) => ({ ...prev, cover: nextCover }));
        toast.success("Cover image set");
      } catch {
        toast.error("Failed to set cover image");
      }
    },
    [eventId, eventSettings.cover]
  );

  const handleBatchFavorite = useCallback(async () => {
    try {
      // Find the first active share for this event to attach favorites to
      const sharesRes = await fetch(`/api/shares?eventId=${eventId}`);
      if (!sharesRes.ok) throw new Error("Failed to load shares");
      const sharesData = await sharesRes.json();
      let activeShare = sharesData.shares?.find(
        (s: { isActive: boolean }) => s.isActive
      );

      // Auto-create share if none exists
      if (!activeShare) {
        const createRes = await fetch("/api/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            shareType: "full",
            allowDownload: true,
            allowFavorites: true,
          }),
        });
        if (!createRes.ok) throw new Error("Failed to create share");
        const createData = await createRes.json();
        activeShare = createData.share;
        setHasActiveShare(true);
        setActiveShareSlug(activeShare.slug);
      }

      const res = await fetch("/api/images/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageIds: selectedArray,
          action: "favorite",
          shareId: activeShare.id,
        }),
      });
      if (!res.ok) throw new Error("Favorite failed");
      deselectAll();
      const msg = !hasActiveShare
        ? `Share link created. ${selectionCount} images starred.`
        : `Starred ${selectionCount} images`;
      toast.success(msg);
    } catch (err) {
      console.error("Batch favorite failed:", err);
      toast.error("Failed to star images");
    }
  }, [eventId, selectedArray, selectionCount, deselectAll, hasActiveShare]);

  const handleCreateSelectionLink = useCallback(() => {
    setShareModalImageIds([...selectedArray]);
    setShowShareModal(true);
  }, [selectedArray]);

  // Pull selected images out of EVERY website section (unpublishes them).
  const handleRemoveFromWebsite = useCallback(async () => {
    try {
      const res = await fetch("/api/site/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: selectedArray }),
      });
      if (!res.ok) throw new Error("Remove from website failed");
      const data = await res.json();
      deselectAll();
      toast.success(`Removed ${data.removed} from the website`);
      fetchEvent();
    } catch (err) {
      console.error("Remove from website failed:", err);
      toast.error("Failed to remove from the website");
    }
  }, [selectedArray, deselectAll, fetchEvent]);

  const handleBatchDownload = useCallback(async () => {
    const selectedImages = images.filter((img) => selectedIds.has(img.id));
    // Originals aren't in the list payload anymore — fetch each image's signed
    // download URL on demand, then trigger the download.
    for (const img of selectedImages) {
      let url = img.originalUrl;
      if (!url) {
        try {
          const res = await fetch(`/api/images/${img.id}`);
          if (res.ok) {
            const detail = await res.json();
            url = detail.downloadUrl || detail.originalUrl;
          }
        } catch {
          /* fall through to thumbnail */
        }
      }
      url = url || img.thumbnailUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = img.originalFilename || "image";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  }, [images, selectedIds]);

  const handleAddToSection = useCallback(
    async (sectionId: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selectedArray }),
        });
        if (!res.ok) throw new Error("Failed to add images to section");
        fetchEvent();
        toast.success("Added to section");
      } catch (err) {
        console.error("Add to section failed:", err);
        toast.error("Failed to add to section");
      }
    },
    [selectedArray, fetchEvent]
  );

  const handleMoveToSection = useCallback(
    async (targetSectionId: string) => {
      if (!activeSection) return;
      try {
        await fetch(`/api/sections/${activeSection}/images`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selectedArray }),
        });
        await fetch(`/api/sections/${targetSectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selectedArray }),
        });
        deselectAll();
        fetchEvent();
        toast.success("Moved to section");
      } catch (err) {
        console.error("Move to section failed:", err);
        toast.error("Failed to move images");
      }
    },
    [activeSection, selectedArray, deselectAll, fetchEvent]
  );

  const handleRemoveFromSection = useCallback(async () => {
    if (!activeSection) return;
    try {
      await fetch(`/api/sections/${activeSection}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: selectedArray }),
      });
      deselectAll();
      fetchEvent();
      toast.success("Removed from section");
    } catch (err) {
      console.error("Remove from section failed:", err);
      toast.error("Failed to remove images");
    }
  }, [activeSection, selectedArray, deselectAll, fetchEvent]);

  const handleDropImagesToSection = useCallback(
    async (sectionId: string, imageIds: string[]) => {
      try {
        // If viewing a specific section, remove from the current section first (move)
        if (activeSection && activeSection !== sectionId) {
          await fetch(`/api/sections/${activeSection}/images`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds }),
          });
        }
        // Add to the target section
        await fetch(`/api/sections/${sectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds }),
        });
        deselectAll();
        fetchEvent();
        const action = activeSection && activeSection !== sectionId ? "Moved" : "Added";
        toast.success(`${action} ${imageIds.length} ${imageIds.length === 1 ? "image" : "images"} to section`);
      } catch (err) {
        console.error("Drop to section failed:", err);
        toast.error("Failed to move images");
      }
    },
    [activeSection, deselectAll, fetchEvent]
  );

  const handleBatchRename = useCallback(
    async (pattern: string) => {
      try {
        const res = await fetch("/api/images/batch", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageIds: selectedArray,
            action: "rename",
            pattern,
          }),
        });
        if (!res.ok) throw new Error("Rename failed");
        deselectAll();
        fetchEvent();
        toast.success(`Renamed ${selectionCount} images`);
      } catch (err) {
        console.error("Batch rename failed:", err);
        toast.error("Failed to rename images");
      }
    },
    [selectedArray, selectionCount, deselectAll, fetchEvent]
  );

  const handleSectionsChange = useCallback((updated: SectionData[]) => {
    setSections(updated);
  }, []);

  // Sort images based on user selection. "manual" is per-section drag order
  // (order-manual.ts); the other three use the shared comparator the public
  // gallery uses, so "Filename"/"Date taken"/"Latest" order identically in both.
  const manualMode = sortBy === "manual";
  const sortedImages = useMemo(() => {
    if (sortBy !== "manual") return sortImages(images, sortBy);
    if (activeSection) {
      const order =
        manualOrderBySection[activeSection] ??
        sections.find((s) => s.id === activeSection)?.imageIds ??
        [];
      return orderBySectionManual(images, order);
    }
    // "All Images" — read-only reflection of every section's manual order.
    const manualSections = sections.map((s) => ({
      id: s.id,
      sortOrder: s.sortOrder ?? 0,
      imageIds: manualOrderBySection[s.id] ?? s.imageIds ?? [],
    }));
    return orderByPrimarySection(images, manualSections);
  }, [images, sortBy, activeSection, manualOrderBySection, sections]);

  // Drag-to-reorder is available inside any real section (not "All Images",
  // search, or favorites — a filtered/cross-section subset can't be persisted to
  // a single sort_order sequence). Dragging while in another sort auto-switches
  // to Manual (see handleReorder), so users never have to pick Manual first.
  const dndEnabled = !!activeSection && !isSearching && !favoritesOnly;

  // When Manual is active OR a drag could begin, every tile must be an
  // individually-reorderable image, so stacks are expanded into loose tiles;
  // otherwise stacks render as groups. (No stacks exist today — AI stacking is
  // off — so the expand-on-dndEnabled branch only matters if it's re-enabled.)
  const expandTiles = manualMode || dndEnabled;
  const gridStacks = expandTiles ? [] : stacks;
  const gridStandalone = expandTiles
    ? sortedImages
    : sortedImages.filter((img) => !img.stackId);
  // Kept name `standalone` for the existing render/filmstrip props below.
  const standalone = gridStandalone;

  // ─── Gallery keyboard shortcuts ───
  const { showHelp: showShortcutsHelp, setShowHelp: setShowShortcutsHelp } =
    useGalleryShortcuts({
      onSelectAll: () => {
        const allIds = images.map((img) => img.id);
        selection.selectAll(allIds);
      },
      onDeselectAll: () => selection.deselectAll(),
      onFavoriteSelected: handleBatchFavorite,
      onDeleteSelected: handleBatchDelete,
      onToggleUpload: () => setShowUpload((v) => !v),
      onShare: () => {
        // Navigate to email compose page
        window.location.href = hasActiveShare
          ? `/events/${eventId}/share?slug=${activeShareSlug}`
          : `/events/${eventId}/share`;
      },
      selectionCount: selection.count,
      enabled: !selectedImageId && !showShareModal,
    });

  // Flat list of all images for lightbox navigation + range selection
  const flatImageList = useMemo(() => {
    const list: ImageData[] = [];
    for (const stack of gridStacks) {
      for (const img of stack.images) {
        list.push(img);
      }
    }
    for (const img of standalone) {
      list.push(img);
    }
    return list;
  }, [gridStacks, standalone]);

  // Ordered IDs for shift+click range selection
  const flatOrderedIds = useMemo(
    () => flatImageList.map((img) => img.id),
    [flatImageList]
  );

  // Grid settings from event settings
  const gridSettings = eventSettings.grid;

  // Persist sort selection to event settings
  const setSortBy = useCallback(async (value: GallerySortMode) => {
    setSortByState(value);
    const newGrid = { ...gridSettings, sortBy: value };
    setEventSettings((prev) => ({ ...prev, grid: newGrid }));
    try {
      await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { grid: newGrid } }),
      });
    } catch {
      /* non-critical */
    }
  }, [gridSettings, eventId]);

  // Persist a new manual order for the active section (optimistic + background).
  // Dragging while in a non-manual sort AUTO-SWITCHES to Manual, seeding the
  // arrangement from what's on screen (WYSIWYG) — and offers a one-click Undo
  // that restores both the previous sort and the section's prior saved order, so
  // accidentally clobbering a careful arrangement is fully recoverable.
  const handleReorder = useCallback(
    (orderedIds: string[]) => {
      if (!activeSection) return;
      const sectionId = activeSection;
      const wasManual = sortBy === "manual";
      const prevSort = sortBy;
      const prevOrder =
        manualOrderBySection[sectionId] ??
        sections.find((s) => s.id === sectionId)?.imageIds ??
        null;

      const persistOrder = async (ids: string[]) => {
        const res = await fetch(`/api/sections/${sectionId}/images/reorder`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: ids }),
        });
        if (!res.ok) throw new Error(String(res.status));
      };

      // Optimistic: apply the new order and enter Manual so it sticks.
      setManualOrderBySection((m) => ({ ...m, [sectionId]: orderedIds }));
      if (!wasManual) setSortBy("manual");

      (async () => {
        try {
          await persistOrder(orderedIds);
          if (!wasManual) {
            toast.success("Switched to Manual order", {
              action: prevOrder
                ? {
                    label: "Undo",
                    onClick: () => {
                      setManualOrderBySection((m) => ({
                        ...m,
                        [sectionId]: prevOrder,
                      }));
                      setSortBy(prevSort);
                      persistOrder(prevOrder).catch(() =>
                        toast.error("Couldn't undo — please try again.")
                      );
                    },
                  }
                : undefined,
            });
          }
        } catch {
          // Revert the optimistic order (and the sort switch) on failure.
          setManualOrderBySection((m) => {
            const next = { ...m };
            if (prevOrder) next[sectionId] = prevOrder;
            else delete next[sectionId];
            return next;
          });
          if (!wasManual) setSortBy(prevSort);
          toast.error("Couldn't save the new order — please try again.");
        }
      })();
    },
    [activeSection, manualOrderBySection, sortBy, sections, setSortBy]
  );

  // Toggle filename overlay (persists to event settings)
  const toggleFilenames = useCallback(async () => {
    const newVal = !gridSettings?.showFilenames;
    const newGrid = { ...gridSettings, showFilenames: newVal };
    setEventSettings((prev) => ({ ...prev, grid: newGrid }));
    try {
      await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { grid: newGrid } }),
      });
    } catch {
      /* non-critical */
    }
  }, [gridSettings, eventId]);

  return (
    <div className="flex min-h-screen">
      {/* ─── Left Sidebar ─── */}
      {/* Show a placeholder of the real sidebar's footprint while the event
          payload loads, so the gallery never shifts sideways when it pops in. */}
      {!event && isLoading && <EventSidebarSkeleton />}
      {event && (
        <EventSidebar
          eventId={eventId}
          eventName={event.name}
          eventType={event.event_type}
          eventDate={event.event_date}
          eventDescription={event.description}
          eventCreatedAt={event.created_at}
          totalImageCount={allImages.length}
          sections={sections}
          onSectionsChange={handleSectionsChange}
          activeSection={activeSection}
          onSetActiveSection={handleSetActiveSection}
          settings={eventSettings}
          onSettingsChange={setEventSettings}
          images={allImages.map((img) => ({
            id: img.id,
            thumbnailUrl: img.thumbnailUrl,
            originalFilename: img.originalFilename,
          }))}
          onRefreshImages={fetchEvent}
          onEventUpdate={(updates) => {
            setEvent((prev) =>
              prev ? { ...prev, ...updates } : prev
            );
          }}
          onOpenChange={setSidebarOpen}
          onActivePanelChange={setSidebarPanel}
          onDropImagesToSection={handleDropImagesToSection}
        />
      )}

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* ─── Nav ─── */}
      <Nav>
        {/* Add Images / Upload */}
        <button
          onClick={() => {
            setShowUpload((v) => !v);
            hadUploadErrors.current = false;
          }}
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          {showUpload ? "Hide Upload" : allImages.length > 0 ? "Add Images" : "Upload"}
        </button>

        {/* Preview — opens client gallery in new tab */}
        <a
          href={activeShareSlug ? `/gallery/${activeShareSlug}` : `/gallery/preview/${eventId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Preview
        </a>

        {/* Publish / Share — both go to email compose page */}
        <Link href={hasActiveShare
          ? `/events/${eventId}/share?slug=${activeShareSlug}`
          : `/events/${eventId}/share`
        }>
          <BrandButton size={hasActiveShare ? "sm" : "md"} color={hasActiveShare ? "blue" : "emerald"} celebrate={!hasActiveShare}>
            {hasActiveShare ? "Share" : "Publish"}
          </BrandButton>
        </Link>
      </Nav>

      <main className="px-8 md:px-16 pt-12 pb-24">
        {/* ─── Event header ─── */}
        <div className="mb-12">
          <Link
            href="/"
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-block"
          >
            ← Back to archive
          </Link>
          {event ? (
            <h1 className="font-editorial text-[clamp(36px,5vw,64px)] leading-[0.95] text-stone-900 reveal">
              {event.name}
              {activeSection && (
                <span className="text-accent">
                  {" // "}
                  {sections.find((s) => s.id === activeSection)?.name}
                </span>
              )}
            </h1>
          ) : (
            /* No fake "Event" title while loading — shimmer where the name goes. */
            <Skeleton className="h-[clamp(36px,5vw,64px)] w-[min(420px,70%)]" />
          )}
          {event?.event_date && (
            <p className="caption-italic mt-3">
              {event.event_date}
              {event.event_type && ` — ${event.event_type}`}
            </p>
          )}
        </div>

        {/* ─── Loading skeleton ─── */}
        {isLoading && (
          <div className="mt-4">
            <ImageGridSkeleton count={12} />
          </div>
        )}

        {/* ─── Error state ─── */}
        {!isLoading && loadError && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="font-editorial text-xl text-stone-300 italic mb-2">
              Failed to load event
            </p>
            <p className="text-[13px] text-stone-400 mb-6">
              Something went wrong. Please try again.
            </p>
            <button
              onClick={() => { setLoadError(false); setIsLoading(true); fetchEvent(); }}
              className="px-6 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-all duration-300"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !loadError && (
          <>
            {/* ─── Unified upload bar (owns progress while uploading) ─── */}
            {uploadProgress.active && (
              <div className="mb-8 reveal" style={{ animationDelay: "0.05s" }}>
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{
                      width: `${
                        uploadProgress.total > 0
                          ? ((uploadProgress.uploaded + uploadProgress.failed) /
                              uploadProgress.total) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-[13px] text-stone-500 tabular-nums">
                  <span className="text-stone-400">Uploading</span>{" "}
                  <span className="font-medium text-accent">
                    {uploadProgress.uploaded.toLocaleString()}
                  </span>
                  <span className="text-stone-300"> of </span>
                  <span className="font-medium">
                    {uploadProgress.total.toLocaleString()}
                  </span>
                  {uploadProgress.failed > 0 && (
                    <span className="text-red-400">
                      {" "}· {uploadProgress.failed.toLocaleString()} failed
                    </span>
                  )}
                  <span className="text-stone-300">
                    {" "}— keep adding files anytime
                  </span>
                </p>
              </div>
            )}

            {/* ─── Upload zone ─── */}
            {/* Shown when the user opted in (Add Images) OR when the active
                section is empty — so an empty section presents the REAL
                dropzone directly (one working box, never a dead placeholder).
                Keyed by target section so each section keeps its own queue.
                No max-height clip: the file list scrolls internally. */}
            {(showUpload ||
              (!isLoading &&
                sidebarPanel !== "design" &&
                images.length === 0 &&
                !!uploadTargetId)) && (
              <div className="mb-12">
                <UploadZone
                  key={uploadTargetId ?? "no-section"}
                  eventId={eventId}
                  sectionId={uploadTargetId}
                  sectionName={uploadTargetName}
                  onUploadComplete={handleUploadComplete}
                  onUploadFailed={handleUploadFailed}
                  onImageUploaded={handleImageUploaded}
                  onProgressChange={setUploadProgress}
                  retryFiles={retryFiles}
                />
              </div>
            )}

            {/* ─── Failed uploads banner ─── */}
            {failedUploads.length > 0 && (
              <div className="mb-8 p-4 border border-amber-200 bg-amber-50/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <div>
                      <p className="text-[13px] font-medium text-amber-900">
                        {failedUploads.length} {failedUploads.length === 1 ? "image" : "images"} failed to upload
                      </p>
                      <p className="text-[12px] text-amber-600 mt-0.5">
                        {failedUploads.map(f => f.name).slice(0, 3).join(", ")}
                        {failedUploads.length > 3 && ` and ${failedUploads.length - 3} more`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRetryUpload(failedUploads)}
                      className="px-4 py-1.5 text-[12px] font-medium text-amber-900 border border-amber-300 hover:bg-amber-100 transition-colors"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => setFailedUploads([])}
                      className="p-1.5 text-amber-400 hover:text-amber-600 transition-colors"
                      aria-label="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Empty state ─── */}
            {allImages.length === 0 && !uploadProgress.active && (
              <div className="flex flex-col items-center justify-center py-20 text-center fade-in">
                <div className="w-16 h-16 mb-6 text-stone-200">
                  <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="8" y="12" width="48" height="36" rx="3" stroke="currentColor" strokeWidth="2" />
                    <circle cx="24" cy="28" r="5" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 40 L24 30 L36 38 L48 26 L56 32 L56 48 L8 48 Z" fill="currentColor" opacity="0.15" />
                    <path d="M24 30 L36 38 L48 26" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="font-editorial text-xl text-stone-300 italic mb-2">
                  Your gallery awaits
                </p>
                <p className="text-[13px] text-stone-400 max-w-xs leading-relaxed">
                  Drop images above or click upload to begin. AI will organize everything automatically.
                </p>
              </div>
            )}

            {/* Empty-section placeholder removed: an empty section now shows the
                real UploadZone above (sectionIsEmpty), so there's exactly one
                working dropzone — never a dead duplicate. */}

            {/* ─── Live gallery preview (when Design tab is active) ─── */}
            {sidebarPanel === "design" && allImages.length > 0 && (
              <div className="flex-1 flex flex-col reveal" style={{ animationDelay: "0.1s" }}>
                <div className="flex items-center gap-3 mb-4">
                  <Eye size={14} className="text-stone-400" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-stone-400 font-medium">
                    Live Preview
                  </span>
                  <span className="text-[11px] text-stone-300">
                    — changes appear after saving
                  </span>
                </div>
                <div className="flex-1 border border-stone-200 bg-stone-50 overflow-hidden" style={{ minHeight: "60vh" }}>
                  <iframe
                    ref={previewIframeRef}
                    src={`/gallery/preview/${eventId}`}
                    className="w-full h-full border-0"
                    style={{ minHeight: "60vh" }}
                    title="Gallery preview"
                  />
                </div>
              </div>
            )}

            {/* ─── Search + Gallery (only show when images exist and not in design mode) ─── */}
            {allImages.length > 0 && sidebarPanel !== "design" && (
            <>
            <div
              className="mb-10 max-w-2xl reveal"
              style={{ animationDelay: "0.15s" }}
            >
              <SearchBar
                eventId={eventId}
                onResults={handleSearchResults}
                onClear={handleSearchClear}
              />
            </div>

            {/* ─── Gallery divider ─── */}
            <div className="editorial-divider mb-10">
              <span className="label-caps shrink-0">
                {activeSection
                  ? sections.find((s) => s.id === activeSection)?.name || "Section"
                  : "Gallery"}
                {images.length > 0 && (
                  <span className="ml-2 text-stone-300 font-normal tabular-nums">{images.length.toLocaleString()}</span>
                )}
              </span>
              <div className="flex items-center gap-3">
                {/* Select All / Deselect */}
                <button
                  onClick={() => {
                    const allIds = images.map((img) => img.id);
                    if (selection.count === images.length && images.length > 0) {
                      selection.deselectAll();
                    } else {
                      selection.selectAll(allIds);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1.5 text-[12px] transition-colors cursor-pointer",
                    selection.count > 0
                      ? "text-emerald-600 hover:text-emerald-700"
                      : "text-stone-400 hover:text-stone-700"
                  )}
                  title={selection.count === images.length && images.length > 0 ? "Deselect all" : "Select all images"}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                  {selection.count > 0
                    ? selection.count === images.length
                      ? "Deselect All"
                      : `${selection.count} selected`
                    : "Select All"}
                </button>

                <div className="w-px h-4 bg-stone-200" />

                {/* Sort dropdown */}
                <div ref={sortRef} className="relative">
                  <button
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-stone-700 transition-colors cursor-pointer"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {sortBy === "upload"
                      ? "Upload Date"
                      : sortBy === "filename"
                      ? "Filename"
                      : sortBy === "date-taken"
                      ? "Date Taken"
                      : "Manual"}
                  </button>
                  {sortOpen && (
                    <div className="absolute top-full right-0 mt-2 bg-white border border-stone-200 shadow-lg py-1 min-w-[140px] z-30 scale-in">
                      {([
                        ["upload", "Upload Date"],
                        ["filename", "Filename"],
                        ["date-taken", "Date Taken"],
                        ["manual", "Manual"],
                      ] as const).map(([value, label]) => {
                        // Manual is cross-section-incoherent while searching.
                        const disabled = value === "manual" && isSearching;
                        return (
                          <button
                            key={value}
                            disabled={disabled}
                            title={
                              disabled
                                ? "Clear search to use manual order"
                                : undefined
                            }
                            onClick={() => { setSortBy(value); setSortOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-[12px] flex items-center justify-between gap-3 transition-colors ${
                              disabled
                                ? "text-stone-300 cursor-not-allowed"
                                : sortBy === value
                                ? "text-stone-900 bg-stone-50"
                                : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                            }`}
                          >
                            {label}
                            {sortBy === value && !disabled && (
                              <Check className="h-3.5 w-3.5 text-accent" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="w-px h-4 bg-stone-200" />

                {/* Favorites filter */}
                <button
                  onClick={toggleFavoritesFilter}
                  className={`p-1.5 transition-colors ${favoritesOnly ? "text-accent" : "text-stone-300 hover:text-stone-500"}`}
                  aria-label="Filter to favorites"
                  title={favoritesOnly ? "Showing favorites" : "Show favorites only"}
                >
                  <Heart className="h-4 w-4" fill={favoritesOnly ? "currentColor" : "none"} />
                </button>

                <div className="w-px h-4 bg-stone-200" />

                {/* Filename overlay toggle */}
                <button
                  onClick={toggleFilenames}
                  className={`p-1.5 transition-colors ${gridSettings?.showFilenames ? "text-stone-900" : "text-stone-300 hover:text-stone-500"}`}
                  aria-label="Toggle filenames"
                  title={gridSettings?.showFilenames ? "Hide filenames" : "Show filenames"}
                >
                  {gridSettings?.showFilenames ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </button>

                <div className="w-px h-4 bg-stone-200" />

                {/* View mode toggles */}
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-1.5 transition-colors ${viewMode === "grid" ? "text-stone-900" : "text-stone-300 hover:text-stone-500"}`}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setViewMode("filmstrip")}
                  className={`p-1.5 transition-colors ${viewMode === "filmstrip" ? "text-stone-900" : "text-stone-300 hover:text-stone-500"}`}
                  aria-label="Film strip view"
                >
                  <Rows3 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ─── Gallery view ─── */}
            <div ref={gridAreaRef} className="relative">
              {isSlotSection && (activeSectionData?.imageCount ?? 0) > 1 && (
                <p className="mb-3 text-[12px] text-amber-600">
                  Slot section — the website uses only the first image. Drag
                  your pick to the front; extras are ignored.
                </p>
              )}
              {viewMode === "grid" ? (
                <>
                  {(dndEnabled || manualMode) && (
                    <p className="mb-3 text-[12px] text-stone-400">
                      {dndEnabled
                        ? manualMode
                          ? "Drag photos to rearrange your Manual order."
                          : "Drag photos to arrange them — this switches to your Manual order."
                        : activeSection
                        ? "Clear search or favorites to rearrange this section."
                        : "Manual order is read-only in “All Images.” Open a section to rearrange it."}
                    </p>
                  )}
                  <ImageGrid
                    images={images}
                    stacks={gridStacks}
                    standalone={standalone}
                    onToggleSelect={selection.toggle}
                    onRangeSelect={(id) => selection.rangeSelect(id, flatOrderedIds)}
                    onImageDoubleClick={(id) => setSelectedImageId(id)}
                    onSetCover={async (stackId, imageId) => {
                      await fetch(`/api/stacks/${stackId}/cover`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ imageId }),
                      });
                      fetchEvent();
                    }}
                    hasSelection={selection.hasSelection}
                    selectedIds={selection.selectedIds}
                    columnCount={gridSettings?.columns}
                    gap={gridSettings?.gap}
                    style={gridSettings?.style}
                    showFilenames={gridSettings?.showFilenames}
                    dndEnabled={dndEnabled}
                    onReorder={handleReorder}
                    showFocalBadge={isSlotSection}
                  />
                </>
              ) : (
                <FilmStrip
                  images={images}
                  stacks={gridStacks}
                  standalone={standalone}
                  onToggleSelect={selection.toggle}
                  onImageDoubleClick={(id) => setSelectedImageId(id)}
                  hasSelection={selection.hasSelection}
                  selectedIds={selection.selectedIds}
                />
              )}

              {/* Marquee selection overlay */}
              {isMarqueeDrawing && marqueeRect && (
                <div
                  className="absolute marquee-rect"
                  style={{
                    left: marqueeRect.x,
                    top: marqueeRect.y,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                  }}
                />
              )}
            </div>
            </>
            )}
          </>
        )}
      </main>

      {/* ─── Footer ─── */}
      <Footer />

      {/* ─── Selection Toolbar ─── */}
      {selection.hasSelection && (
        <SelectionToolbar
          count={selection.count}
          onDeselectAll={selection.deselectAll}
          onDelete={handleBatchDelete}
          onFavorite={handleBatchFavorite}
          onCreateShareLink={handleCreateSelectionLink}
          onDownload={handleBatchDownload}
          onAddToSection={handleAddToSection}
          onMoveToSection={handleMoveToSection}
          onRemoveFromSection={activeSection ? handleRemoveFromSection : undefined}
          onRename={handleBatchRename}
          onSetCover={
            selection.count === 1
              ? () => handleSetCover(selectedArray[0])
              : undefined
          }
          onRemoveFromWebsite={
            isWebsiteContext ? handleRemoveFromWebsite : undefined
          }
          onSetFocalPoint={
            selection.count === 1 && isSlotSection
              ? () => setFocalImageId(selectedArray[0])
              : undefined
          }
          onEditWebsiteDetails={
            isWebsiteContext ? () => setShowCuration(true) : undefined
          }
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
          activeSection={activeSection}
          sidebarOffset={sidebarOpen ? 320 : 48}
        />
      )}

      {/* ─── Share Modal ─── */}
      <ShareModal
        eventId={eventId}
        eventName={event?.name || "Event"}
        isOpen={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setShareModalImageIds(undefined);
        }}
        imageIds={shareModalImageIds}
      />

      {/* ─── Lightbox ─── */}
      {selectedImageId && flatImageList.length > 0 && (
        <Lightbox
          images={flatImageList}
          initialImageId={selectedImageId}
          onClose={() => setSelectedImageId(null)}
          actions={[
            { icon: ImageIcon, label: "Make Cover", onClick: handleSetCover },
          ]}
        />
      )}

      {/* ─── Focal point picker (website slot sections) ─── */}
      {focalImageId &&
        (() => {
          const img = allImages.find((i) => i.id === focalImageId);
          if (!img) return null;
          return (
            <FocalPointModal
              imageId={img.id}
              thumbnailUrl={img.thumbnailUrl}
              initialFocal={
                img.focalX != null && img.focalY != null
                  ? { x: img.focalX, y: img.focalY }
                  : null
              }
              onClose={() => setFocalImageId(null)}
              onSaved={(focal) =>
                setAllImages((prev) =>
                  prev.map((i) =>
                    i.id === img.id
                      ? { ...i, focalX: focal?.x ?? null, focalY: focal?.y ?? null }
                      : i
                  )
                )
              }
            />
          );
        })()}

      {/* ─── Website curation details (event, city, service, featured) ─── */}
      {showCuration && (
        <CurationModal
          images={allImages.filter((i) => selection.selectedIds.has(i.id))}
          onClose={() => setShowCuration(false)}
          onSaved={(result) => {
            const ids = new Set(result.imageIds);
            const eventUpdates = new Map(
              result.eventUpdates.map((u) => [u.eventId, u])
            );
            setAllImages((prev) =>
              prev.map((img) => {
                let next = img;
                if (ids.has(img.id)) {
                  next = {
                    ...next,
                    ...(result.service !== undefined
                      ? { service: result.service }
                      : {}),
                    ...(result.featured !== undefined
                      ? { featured: result.featured }
                      : {}),
                  };
                }
                const evt = img.eventId
                  ? eventUpdates.get(img.eventId)
                  : undefined;
                if (evt) {
                  next = {
                    ...next,
                    ...(evt.name !== undefined ? { eventName: evt.name } : {}),
                    ...(evt.city !== undefined ? { eventCity: evt.city } : {}),
                  };
                }
                return next;
              })
            );
          }}
        />
      )}

      {/* ─── Keyboard Shortcuts Help ─── */}
      {showShortcutsHelp && (
        <ShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      )}
      </div>{/* end main content flex child */}
    </div>
  );
}
