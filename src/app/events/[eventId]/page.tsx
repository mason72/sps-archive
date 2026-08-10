"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";

import { UploadZone } from "@/components/upload/UploadZone";
import {
  useEventUploadProgress,
  useUploadManager,
} from "@/components/upload/UploadManager";
import { SearchBar } from "@/components/search/SearchBar";
import { ImageGrid, type TileBadge } from "@/components/gallery/ImageGrid";
import { FilmStrip } from "@/components/gallery/FilmStrip";
import { Lightbox } from "@/components/lightbox/Lightbox";
import { ShareModal } from "@/components/shares/ShareModal";
import { SelectionToolbar } from "@/components/gallery/SelectionToolbar";
import { FocalPointModal } from "@/components/gallery/FocalPointModal";
import { GalleryTransferModal } from "@/components/gallery/GalleryTransferModal";
import { sceneForKey, sceneUsageHint, sceneUrl } from "@/lib/site/scenes";
import { isJobSceneKey, jobMissingFields, parseJobMeta } from "@/lib/site/jobs";
import { CurationModal } from "@/components/gallery/CurationModal";
import { JobDetailsModal } from "@/components/gallery/JobDetailsModal";
import { EventSidebar, type Panel } from "@/components/events/EventSidebar";
import { SortSectionsModal } from "@/components/events/SortSectionsModal";
import { useSelection } from "@/hooks/useSelection";
import { useMarqueeSelect } from "@/hooks/useMarqueeSelect";
import { useGalleryShortcuts } from "@/hooks/useGalleryShortcuts";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { BrandButton } from "@/components/ui/brand-button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertTriangle, X, LayoutGrid, Rows3, Eye, EyeOff, ArrowUpDown, Check, CheckSquare, Image as ImageIcon, Heart, Lock, Crosshair, ExternalLink, Layers, Sparkles, Users } from "lucide-react";
import { PeopleView, type Person } from "@/components/events/PeopleView";
import type { ImageData, StackData } from "@/types/image";
import { deriveDisplayImages } from "@/lib/gallery/derive-display";
import { buildStacks } from "@/lib/gallery/stacks";
import { detectStackable } from "@/lib/gallery/stackable";
import { sortImages, type GallerySortMode } from "@/lib/gallery/sort-images";
import { orderBySectionManual, orderByPrimarySection } from "@/lib/gallery/order-manual";
import { findIntakeSectionId } from "@/lib/sections/intake";
import type { EventSettings } from "@/types/event-settings";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
import { ImageGridSkeleton, EventSidebarSkeleton, Skeleton } from "@/components/ui/Skeleton";
import confetti from "canvas-confetti";

/** Read the server's {error} message for a failed response, with a fallback. */
async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

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
  /** Soft guard: locked sections reject membership/order edits until unlocked. */
  locked?: boolean;
  /** Job-sheet metadata (TDP Work gallery job sections), raw jsonb. */
  jobMeta?: unknown;
}

/** Most frequent non-null value, or null. Used for job-form prefills. */
function mostCommon<T>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const v of values) {
    if (v == null) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
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
  // Filename search runs CLIENT-SIDE over the already-loaded images, scoped to
  // the active section (search a section → that section; "All Images" → all).
  // Deriving from the query (rather than separate isSearching/results state)
  // is what keeps clearing the search from stranding you: empty query → the
  // view falls straight back to the active section.
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalImageIds, setShareModalImageIds] = useState<string[] | undefined>(undefined);
  const [eventSettings, setEventSettings] = useState<EventSettings>(DEFAULT_EVENT_SETTINGS);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [retryFiles, setRetryFiles] = useState<File[] | undefined>(undefined);
  const hadUploadErrors = useRef(false);
  const [viewMode, setViewMode] = useState<"grid" | "filmstrip" | "people">("grid");
  // Filter the grid to one clustered person (set by clicking a face in the
  // People view). Composes with sections/search/favorites in the images memo.
  const [personFilter, setPersonFilter] = useState<{
    id: string;
    name: string | null;
    imageIds: string[];
  } | null>(null);
  // People-button badge: pending suggestion count (fetched once on load,
  // kept live by PeopleView while it's open).
  const [suggestionCount, setSuggestionCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/people/suggestions-count`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSuggestionCount(data.count ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId]);
  const [sortBy, setSortByState] = useState<GallerySortMode>("upload");
  const [sortOpen, setSortOpen] = useState(false);
  // Optimistic per-section manual order overrides (sectionId -> ordered ids).
  // Seeded from the server's stored order; updated immediately on drag, then
  // persisted in the background.
  const [manualOrderBySection, setManualOrderBySection] = useState<
    Record<string, string[]>
  >({});
  const sortRef = useRef<HTMLDivElement>(null);
  /** A FULL share exists — i.e. the gallery itself is published. */
  const [hasFullShare, setHasFullShare] = useState(false);
  /** Slug of the full share only; never a selection share. */
  const [fullShareSlug, setFullShareSlug] = useState<string | null>(null);

  // Stable ref for activeSection so UploadZone always has the current value
  const activeSectionRef = useRef<string | null>(null);
  activeSectionRef.current = activeSection;
  // Ensures we only auto-select the default section once, on initial load.
  const didInitSectionRef = useRef(false);

  // Favorites filter (client/team favorites from the event's active share).
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  // ─── Client-side, section-scoped filename search ───
  // Matches the server's filename search (original_filename / parsed_name,
  // case-insensitive substring) but over the loaded images, so results carry
  // real thumbnails/dimensions and the scope is just the active section.
  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const searchResults = useMemo<ImageData[] | null>(() => {
    if (!isSearching) return null;
    const q = trimmedQuery.toLowerCase();
    const base = activeSection
      ? allImages.filter((img) => img.sectionIds?.includes(activeSection))
      : allImages;
    return base.filter(
      (img) =>
        (img.originalFilename ?? "").toLowerCase().includes(q) ||
        (img.parsedName ?? "").toLowerCase().includes(q)
    );
  }, [isSearching, trimmedQuery, activeSection, allImages]);

  // ─── Derived displayed list (race-proof) ───
  // Pure function of (search, active section, section IDs, full set). Lives in
  // src/lib/gallery/derive-display.ts so it's unit-tested in isolation — this
  // is the logic whose imperative version caused "No images yet" on populated
  // sections. A section with un-loaded IDs falls back to the full set.
  const images = useMemo<ImageData[]>(() => {
    const base = deriveDisplayImages({
      isSearching,
      searchResults,
      activeSection,
      allImages,
      allStacks,
      favoritesOnly,
      favoriteIds,
    });
    if (!personFilter) return base;
    const keep = new Set(personFilter.imageIds);
    return base.filter((img) => keep.has(img.id));
  }, [isSearching, searchResults, activeSection, allImages, allStacks, favoritesOnly, favoriteIds, personFilter]);

  // Thumbnail + filename lookup for the People compare view
  // (already-presigned grid URLs; filenames for the compare captions).
  const imageThumbById = useMemo(
    () =>
      new Map(
        allImages.map((img) => [
          img.id,
          { thumbnailUrl: img.thumbnailUrl, filename: img.originalFilename ?? "" },
        ])
      ),
    [allImages]
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
      // Picking a section is a deliberate context change — exit any active
      // search so you see the section, not stale filtered results.
      setSearchQuery("");
    },
    [deselectAll]
  );

  // One-click unlock from the locked-section banner; relock in the sidebar.
  const handleUnlockActiveSection = useCallback(async () => {
    const id = activeSectionRef.current;
    if (!id) return;
    try {
      const res = await fetch(`/api/sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: false }),
      });
      if (!res.ok) throw new Error(await apiError(res, "Failed to unlock"));
      setSections((prev) =>
        prev.map((s) => (s.id === id ? { ...s, locked: false } : s))
      );
      toast.success("Section unlocked — lock it again from the sidebar");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unlock");
    }
  }, []);

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

  // Live upload-session state: suppresses the empty state mid-upload, feeds
  // the Sort modal's mid-upload preview, and arms the sort nudge. (The visual
  // progress bar itself lives in UploadZone's list header.)
  // Read straight from the upload manager, which owns every batch for this
  // event regardless of which section is selected or which page started them.
  const uploadProgress = useEventUploadProgress(eventId);

  // "Sort into sections" modal — page-owned so one instance serves both the
  // sidebar button and the post-upload nudge (and can preview mid-upload).
  const [showSort, setShowSort] = useState(false);
  // Nudge for big dumps into Unsorted: hidden → shown (big session detected)
  // → dismissed (sticky for this visit). Sorting also hides it.
  const [sortNudge, setSortNudge] = useState<"hidden" | "shown" | "dismissed">(
    "hidden"
  );

  // Uploads target the SELECTED section, or — when "All Images" is the view —
  // the "Unsorted" intake (never Highlights). null when no intake exists yet;
  // the upload route then creates one, so uploads still can't become orphans.
  const uploadTargetId = activeSection ?? findIntakeSectionId(sections) ?? null;

  // Arm the sort nudge when a big session dumps into the Unsorted intake —
  // the moment it starts, not after: rows register ahead of their binaries,
  // so the plan preview is accurate while files are still uploading.
  const NUDGE_MIN_FILES = 50;
  useEffect(() => {
    if (!uploadProgress.active || uploadProgress.total < NUDGE_MIN_FILES) return;
    const targetIsIntake =
      uploadTargetId === null || uploadTargetId === findIntakeSectionId(sections);
    if (targetIsIntake) {
      setSortNudge((s) => (s === "dismissed" ? s : "shown"));
    }
  }, [uploadProgress.active, uploadProgress.total, uploadTargetId, sections]);

  // Active website section's registry entry: drives the focal-point action
  // (slots) and the "extras are ignored" hints (slots + position-mapped).
  const activeSectionData = sections.find((s) => s.id === activeSection) ?? null;
  const activeScene = activeSectionData?.siteSceneKey
    ? sceneForKey(activeSectionData.siteSceneKey)
    : undefined;
  const isSlotSection = activeScene?.kind === "slot";
  const [focalImageId, setFocalImageId] = useState<string | null>(null);
  // When the focal sweep is opened for the whole section ("Focal points"
  // button), order unset images first so you set the new ones and know you're
  // done the moment already-set images start appearing.
  const [focalUnsetFirst, setFocalUnsetFirst] = useState(false);
  // Cross-gallery copy/move picker ("Another gallery…" in the toolbar).
  const [transferMode, setTransferMode] = useState<"copy" | "move" | null>(null);
  // Website curation modal (event/city/service/featured) — offered where the
  // team curates the site: the TDP Website gallery or any website section.
  const isWebsiteContext =
    event?.event_type === "website" || !!activeSectionData?.siteSceneKey;
  const [showCuration, setShowCuration] = useState(false);

  // ─── TDP Work gallery (sections are jobs) ───
  const isWorkGallery =
    (event?.settings as Record<string, unknown> | undefined)?.work === true;
  const activeJobSection =
    isWorkGallery && isJobSceneKey(activeSectionData?.siteSceneKey)
      ? activeSectionData
      : null;
  const [jobModalSectionId, setJobModalSectionId] = useState<string | null>(null);
  const jobModalSection =
    sections.find((s) => s.id === jobModalSectionId && isJobSceneKey(s.siteSceneKey)) ??
    null;
  // The job's cover = first image by drag order; badge it in the grid.
  const jobCoverImageId = activeJobSection
    ? (manualOrderBySection[activeJobSection.id] ??
        activeJobSection.imageIds ??
        [])[0] ?? null
    : null;
  // After a save, patch the section in place (status dot, banner, modal).
  const handleJobSaved = useCallback(
    (sectionId: string, jobMeta: unknown, siteSceneKey: string) => {
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, jobMeta, siteSceneKey } : s))
      );
    },
    []
  );
  const uploadTargetName =
    sections.find((s) => s.id === uploadTargetId)?.name ?? null;
  const uploadTargetLocked =
    sections.find((s) => s.id === uploadTargetId)?.locked ?? false;

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
        // Default-select the "Unsorted" intake so a fresh dump lands there,
        // never Highlights. If there's no intake (e.g. an already-sorted
        // event), open on "All Images" — a dump then creates a new intake
        // rather than polluting a curated/named section.
        setActiveSection(findIntakeSectionId(data.sections));
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

      // The event's gallery link is the FULL share, and only that.
      //
      // This used to fall back to "any active share", so a one-off selection
      // link — 20 photos of one person, made to hand to that person — became
      // the event's identity: Preview opened HER gallery instead of the event,
      // the button read "Share" as though the gallery were published, and the
      // compose page targeted the 20-image subset. A subset is a delivery, not
      // a publication.
      try {
        const sharesRes = await fetch(`/api/shares?eventId=${eventId}`);
        if (sharesRes.ok) {
          const sharesData = await sharesRes.json();
          const activeShares = sharesData.shares?.filter(
            (s: { isActive: boolean }) => s.isActive
          ) || [];
          const fullShare = activeShares.find(
            (s: { shareType: string }) => s.shareType === "full"
          );
          setHasFullShare(!!fullShare);
          setFullShareSlug(fullShare?.slug ?? null);
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

  // The manager runs above this page, so it pushes events rather than the page
  // passing callbacks down. Filtered to this event — another gallery may be
  // uploading in the same session.
  const { subscribe } = useUploadManager();
  useEffect(
    () =>
      subscribe((e) => {
        if (e.eventId !== eventId) return;
        if (e.type === "image-uploaded") handleImageUploaded();
        else if (e.type === "batch-complete") handleUploadComplete(e.imageIds);
        else if (e.type === "batch-failed") handleUploadFailed(e.files);
      }),
    [
      subscribe,
      eventId,
      handleImageUploaded,
      handleUploadComplete,
      handleUploadFailed,
    ]
  );

  const handleRetryUpload = useCallback((files: File[]) => {
    // Clear the failed list and trigger retry via the UploadZone retryFiles prop
    setFailedUploads([]);
    setShowUpload(true);
    // Create a new array reference so the effect in UploadZone fires
    setRetryFiles([...files]);
  }, []);

  // Broaden a section-scoped search to the whole event: drop into "All Images"
  // but keep the query, so the same search re-runs across everything.
  const handleSearchAllImages = useCallback(() => {
    deselectAll();
    setActiveSection(null);
  }, [deselectAll]);

  // ─── Selection actions ───
  // Section-scoped "copies" delete: with a section open, photos that also
  // live in other sections only lose this section's copy; photos in their
  // last section are deleted for real. In "All Images" delete is permanent.
  const handleBatchDelete = useCallback(async () => {
    try {
      const res = await fetch("/api/images/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageIds: selectedArray,
          sectionId: activeSectionRef.current ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(await apiError(res, "Delete failed"));
      const data = (await res.json()) as {
        deleted: number;
        removedFromSection?: number;
      };
      deselectAll();
      fetchEvent();
      const removed = data.removedFromSection ?? 0;
      const deleted = data.deleted ?? 0;
      toast.success(
        removed && deleted
          ? `Removed ${removed} from this section · ${deleted} deleted (last section)`
          : removed
          ? `Removed ${removed} from this section`
          : `Deleted ${deleted} ${deleted === 1 ? "photo" : "photos"}`
      );
    } catch (err) {
      console.error("Batch delete failed:", err);
      toast.error(err instanceof Error ? err.message : "Failed to delete images");
    }
  }, [selectedArray, deselectAll, fetchEvent]);

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
        setHasFullShare(true);
        setFullShareSlug(activeShare.slug);
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
      const msg = !hasFullShare
        ? `Share link created. ${selectionCount} images starred.`
        : `Starred ${selectionCount} images`;
      toast.success(msg);
    } catch (err) {
      console.error("Batch favorite failed:", err);
      toast.error("Failed to star images");
    }
  }, [eventId, selectedArray, selectionCount, deselectAll, hasFullShare]);

  const handleCreateSelectionLink = useCallback(() => {
    setShareModalImageIds([...selectedArray]);
    setShowShareModal(true);
  }, [selectedArray]);

  const handleBatchDownload = useCallback(async () => {
    const selectedImages = images.filter((img) => selectedIds.has(img.id));
    // Fetch each image's signed DOWNLOAD url (attachment disposition) on
    // demand — the list payload carries only display urls, which render
    // inline. No target="_blank": the attachment disposition makes the
    // browser save the file, and a new tab is exactly the bug to avoid.
    for (const img of selectedImages) {
      let url: string | undefined;
      try {
        const res = await fetch(`/api/images/${img.id}`);
        if (res.ok) {
          const detail = await res.json();
          url = detail.downloadUrl || detail.originalUrl;
        }
      } catch {
        /* fall through to thumbnail */
      }
      url = url || img.thumbnailUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = img.originalFilename || "image";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Stagger multi-selection so the browser doesn't drop rapid downloads.
        if (selectedImages.length > 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
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
        if (!res.ok) throw new Error(await apiError(res, "Failed to add to section"));
        fetchEvent();
        toast.success("Added to section");
      } catch (err) {
        console.error("Add to section failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to add to section");
      }
    },
    [selectedArray, fetchEvent]
  );

  const handleMoveToSection = useCallback(
    async (targetSectionId: string) => {
      if (!activeSection) return;
      try {
        const removeRes = await fetch(`/api/sections/${activeSection}/images`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selectedArray }),
        });
        if (!removeRes.ok)
          throw new Error(await apiError(removeRes, "Failed to move images"));
        const addRes = await fetch(`/api/sections/${targetSectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selectedArray }),
        });
        if (!addRes.ok)
          throw new Error(await apiError(addRes, "Failed to move images"));
        deselectAll();
        fetchEvent();
        toast.success("Moved to section");
      } catch (err) {
        console.error("Move to section failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to move images");
      }
    },
    [activeSection, selectedArray, deselectAll, fetchEvent]
  );

  const handleDropImagesToSection = useCallback(
    async (sectionId: string, imageIds: string[]) => {
      try {
        // If viewing a specific section, remove from the current section first (move)
        if (activeSection && activeSection !== sectionId) {
          const removeRes = await fetch(`/api/sections/${activeSection}/images`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds }),
          });
          if (!removeRes.ok)
            throw new Error(await apiError(removeRes, "Failed to move images"));
        }
        // Add to the target section
        const addRes = await fetch(`/api/sections/${sectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds }),
        });
        if (!addRes.ok)
          throw new Error(await apiError(addRes, "Failed to move images"));
        deselectAll();
        fetchEvent();
        const action = activeSection && activeSection !== sectionId ? "Moved" : "Added";
        toast.success(`${action} ${imageIds.length} ${imageIds.length === 1 ? "image" : "images"} to section`);
      } catch (err) {
        console.error("Drop to section failed:", err);
        toast.error(err instanceof Error ? err.message : "Failed to move images");
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

  // "Sort into sections" applied — merge the returned list, preserving fields
  // the auto-sections endpoint doesn't echo (siteSceneKey/jobMeta/locked),
  // then refetch so every image's sectionIds reflect the new membership.
  const handleSortApplied = useCallback(
    (returned: { id: string; name: string; isAuto: boolean; imageCount: number }[]) => {
      setSections((prev) => {
        const byId = new Map(prev.map((s) => [s.id, s]));
        return returned.map((r) => {
          const existing = byId.get(r.id);
          return {
            ...(existing ?? {}),
            id: r.id,
            name: r.name,
            isAuto: r.isAuto,
            imageCount: r.imageCount,
          };
        });
      });
      handleSetActiveSection(null); // show All Images so the new sections are visible
      setSortNudge("hidden");
      fetchEvent();
    },
    [handleSetActiveSection, fetchEvent]
  );

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
  const dndEnabled =
    !!activeSection && !isSearching && !favoritesOnly && !activeSectionData?.locked;

  // Stacks default themselves from the FILENAMES rather than a blanket ON.
  // Headshot days stack; photo booth dumps and weddings must not (a wedding's
  // two filename prefixes would collapse 1,000 photos into two tiles — see
  // detectStackable). An explicit setting always wins.
  const stackDetection = useMemo(() => detectStackable(images), [images]);
  const showStacks = eventSettings.grid?.smartStacks ?? stackDetection.stackable;
  /** True while the value is coming from the filenames rather than a choice. */
  const stacksAreAuto = eventSettings.grid?.smartStacks === undefined;

  // Stacks used to be flattened whenever Manual was active OR a drag could
  // begin — and `dndEnabled` is true in every unlocked section. Since EVERY
  // image must live in a section ("All Images" is a derived view), that gated
  // stacks out of the only place the work actually happens: the feature was
  // effectively dead in the editor from the day it shipped. Stacks now render
  // in section views and drag as a single block; ImageGrid expands a dropped
  // stack into its member ids so the manual order stays one row per image.
  // Grouping is the SAME filename derivation the public gallery uses
  // (buildStacks), so the editor shows exactly the stacks a guest would see.
  // Groups of one fall back to standalone tiles.
  const { gridStacks, gridStandalone } = useMemo<{
    gridStacks: StackData[];
    gridStandalone: ImageData[];
  }>(() => {
    // Search is a flat result list, and the toggle turns grouping off entirely.
    if (isSearching || !showStacks) {
      return { gridStacks: [], gridStandalone: sortedImages };
    }
    const stacks: StackData[] = [];
    const loose: ImageData[] = [];
    for (const group of buildStacks(sortedImages)) {
      if (group.images.length > 1) {
        stacks.push({
          id: `name:${group.key}`,
          stackType: "face",
          imageCount: group.images.length,
          personName: group.personName,
          // Cover = first by current sort; rank tracks display order.
          images: group.images.map((img, i) => ({ ...img, stackRank: i })),
        });
      } else {
        loose.push(group.images[0]);
      }
    }
    return { gridStacks: stacks, gridStandalone: loose };
  }, [isSearching, showStacks, sortedImages]);
  // Kept name `standalone` for the existing render/filmstrip props below.
  const standalone = gridStandalone;

  // Per-tile slot badges for TDP Website scenes: which live-site position each
  // photo fills. Only truthful in Manual drag order (positions map to
  // section_images.sort_order), so it's computed there and nowhere else.
  const positionBadges = useMemo(() => {
    const m = new Map<string, TileBadge>();
    if (!activeScene || !activeSection || !manualMode) return m;

    if (activeScene.kind === "ordered") {
      const limit = activeScene.positions ?? sortedImages.length;
      sortedImages.forEach((img, i) => {
        const pos = i + 1;
        if (pos <= limit) {
          const label = activeScene.positionLabels?.[i];
          m.set(img.id, {
            variant: "position",
            label: label ? `${pos} · ${label}` : String(pos),
            title: label ? `Position ${pos} — ${label}` : `Position ${pos}`,
          });
        } else {
          m.set(img.id, {
            variant: "extra",
            label: "Extra",
            title: "Beyond the positions this page uses — not shown on the site",
          });
        }
      });
    } else if (activeScene.kind === "slot" && !activeScene.rotates) {
      // Single-image slot (e.g. OG): the first by drag order is the one used.
      sortedImages.forEach((img, i) =>
        m.set(
          img.id,
          i === 0
            ? { variant: "cover", label: "Live", title: "The image this slot uses on the site" }
            : { variant: "extra", label: "Extra", title: "Slot uses only the first image — not shown" }
        )
      );
    } else if (activeScene.pinned && activeScene.pinned > 0) {
      // Rotating slots (service heroes, homepage slices) and any pinned pool:
      // the first N always render every load; the rest sample at random.
      sortedImages.slice(0, activeScene.pinned).forEach((img) =>
        m.set(img.id, {
          variant: "pinned",
          label: "Always",
          title: "Always shown — pinned; the rest rotate at random",
        })
      );
    }
    return m;
  }, [activeScene, activeSection, manualMode, sortedImages]);

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
        window.location.href = hasFullShare
          ? `/events/${eventId}/share?slug=${fullShareSlug}`
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

  // ONE stacks setting, driving the editor AND the guest gallery. They used to
  // be separate (`showStacks` defaulting ON here, `smartStacks` defaulting OFF
  // publicly), so the editor showed stacks the gallery never had — the split was
  // invisible and nobody could have guessed it.
  const toggleStacks = useCallback(async () => {
    const newVal = !(gridSettings?.smartStacks ?? stackDetection.stackable);
    const newGrid = { ...gridSettings, smartStacks: newVal };
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
  }, [gridSettings, eventId, stackDetection.stackable]);

  return (
    <div className="flex min-h-screen">
      {/* ─── Left Sidebar ─── */}
      {/* Show a placeholder of the real sidebar's footprint while the event
          payload loads, so the gallery never shifts sideways when it pops in. */}
      {!event && isLoading && <EventSidebarSkeleton />}
      {event && (
        <EventSidebar
          eventId={eventId}
          stacksResolved={showStacks}
          stacksAreAuto={stacksAreAuto}
          stacksDetectedPeople={stackDetection.people}
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
            focalX: img.focalX,
            focalY: img.focalY,
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
          isWorkGallery={isWorkGallery}
          onSectionCreated={
            // A new job opens its form right away — name, then details.
            isWorkGallery ? (s) => setJobModalSectionId(s.id) : undefined
          }
          onRequestSort={() => setShowSort(true)}
        />
      )}

      {/* ─── Sort into sections (page-owned: sidebar button + nudge share it,
             and it can preview live during an upload session) ─── */}
      {showSort && (
        <SortSectionsModal
          eventId={eventId}
          onClose={() => setShowSort(false)}
          onApplied={handleSortApplied}
          uploading={
            uploadProgress.active
              ? {
                  active: true,
                  uploaded: uploadProgress.uploaded,
                  total: uploadProgress.total,
                }
              : undefined
          }
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

        {/* Preview — ALWAYS the owner preview route, never a live share URL.
            Opening the share meant (a) a selection link could hijack it, which
            is how Preview once landed on one person's gallery, (b) every
            preview ran increment_share_views and logged a share_view, so
            checking your own work inflated the client's view count, and (c) a
            password-protected gallery made the photographer type the password
            to see their own event. The preview route mirrors the public
            gallery by design. */}
        <a
          href={`/gallery/preview/${eventId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
        >
          Preview
        </a>

        {/* Publish / Share — both go to email compose page */}
        <Link href={hasFullShare
          ? `/events/${eventId}/share?slug=${fullShareSlug}`
          : `/events/${eventId}/share`
        }>
          <BrandButton size={hasFullShare ? "sm" : "md"} color={hasFullShare ? "blue" : "emerald"} celebrate={!hasFullShare}>
            {hasFullShare ? "Share" : "Publish"}
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
            {/* ─── Upload zone ─── */}
            {/* Session progress (bar, speed, ETA) renders inside UploadZone's
                list header — one bar, next to the counts it describes. */}
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
                {isWorkGallery && !uploadTargetId ? (
                  // Fresh work gallery: photos belong to a job, so there's
                  // nowhere to upload until the first job exists.
                  <div className="flex items-center gap-3 border border-dashed border-stone-300 bg-stone-50/60 px-6 py-8">
                    <p className="text-[13px] text-stone-500">
                      Photos here belong to a job — create your first job in
                      the sidebar (&ldquo;New job…&rdquo;), then upload into it.
                    </p>
                  </div>
                ) : uploadTargetLocked ? (
                  <div className="flex items-center gap-3 border border-dashed border-amber-300 bg-amber-50/40 px-6 py-8">
                    <Lock className="h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-[13px] text-amber-900">
                      &ldquo;{uploadTargetName}&rdquo; is locked — uploads are
                      off. Unlock it to add photos here.
                    </p>
                  </div>
                ) : (
                // NO `key` here, deliberately. It used to be keyed on the
                // upload target, so switching sections destroyed the component
                // — and the in-flight queue with it. The engine lives in
                // UploadManager now; this is just a view and may re-render
                // freely as the selection changes.
                <UploadZone
                  eventId={eventId}
                  eventName={event?.name ?? null}
                  sectionId={uploadTargetId}
                  sectionName={uploadTargetName}
                  retryFiles={retryFiles}
                />
                )}
              </div>
            )}

            {/* ─── Sort nudge: a big dump is headed for Unsorted ─── */}
            {/* Appears as the session starts (the plan works off filenames,
                which register ahead of the binaries) and stays until acted on
                or dismissed — so it still catches eyes after the upload. */}
            {sortNudge === "shown" && !isWorkGallery && (
              <div className="mb-8 flex items-center gap-3 border border-emerald-200 bg-emerald-50/50 px-4 py-3">
                <Sparkles className="h-4 w-4 shrink-0 text-emerald-500" />
                <p className="flex-1 text-[13px] text-emerald-900">
                  <span className="font-medium tabular-nums">
                    {uploadProgress.total >= NUDGE_MIN_FILES
                      ? uploadProgress.total.toLocaleString()
                      : "These"}
                  </span>{" "}
                  photos are headed for Unsorted. Want them sorted into
                  sections? You can preview the plan while they upload.
                </p>
                <button
                  onClick={() => setShowSort(true)}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-emerald-700"
                >
                  Preview sections
                </button>
                <button
                  onClick={() => setSortNudge("dismissed")}
                  className="shrink-0 p-1 text-emerald-700/50 transition-colors hover:text-emerald-900"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
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
                value={searchQuery}
                onChange={setSearchQuery}
                onClear={() => setSearchQuery("")}
                placeholder={
                  activeSection
                    ? `Search in ${
                        sections.find((s) => s.id === activeSection)?.name ??
                        "this section"
                      }…`
                    : "Search all images…"
                }
              />
              {/* Section-scoped search → offer to widen to the whole event,
                  carrying the query into the All Images context. */}
              {isSearching && activeSection && (
                <p className="mt-2 text-[12px] text-stone-400">
                  {images.length === 0
                    ? "No matches in this section. "
                    : `${images.length} in this section. `}
                  <button
                    onClick={handleSearchAllImages}
                    className="text-accent hover:text-accent/80 transition-colors"
                  >
                    Search all images
                  </button>
                </p>
              )}
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
                {/* Focal sweep — set focal points for the whole section, no
                    selection needed. Starts at the first image without one. */}
                {images.length > 0 && (
                  <>
                    <button
                      onClick={() => {
                        const firstUnset = flatImageList.find(
                          (i) => i.focalX == null
                        );
                        setFocalUnsetFirst(true);
                        setFocalImageId(
                          (firstUnset ?? flatImageList[0])?.id ?? null
                        );
                      }}
                      className="flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                      title="Sweep through this section setting focal points"
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                      Focal points
                    </button>
                    <div className="w-px h-4 bg-stone-200" />
                  </>
                )}

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

                {/* Stacks — LABELLED, because this one setting also decides
                    what guests see. An unlabelled icon among the view toggles
                    read as a view preference; Mason went looking for it in the
                    Details panel and Jerrick assumed the admin state was the
                    gallery state. The chip states who's steering (Auto when it
                    came from the filenames), matching the focal picker. */}
                <button
                  onClick={toggleStacks}
                  className={`flex items-center gap-1.5 px-2 py-1 transition-colors ${
                    showStacks
                      ? "text-stone-900"
                      : "text-stone-400 hover:text-stone-600"
                  }`}
                  aria-label={
                    showStacks
                      ? "Stacks on — click to show every photo"
                      : "Stacks off — click to group photos by person"
                  }
                  title={
                    stacksAreAuto
                      ? `Stacks ${showStacks ? "on" : "off"} automatically — ${
                          stackDetection.people
                        } people detected in the filenames. Guests see this too. Click to set it yourself.`
                      : `Stacks ${showStacks ? "on" : "off"} — you set this. Guests see this too.`
                  }
                >
                  <Layers className="h-4 w-4 shrink-0" />
                  {/* The word drops on narrow screens; the state chip never
                      does, since that's the part you can't infer from an icon. */}
                  <span className="hidden sm:inline text-[11px] uppercase tracking-[0.12em] font-medium">
                    Stacks
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-[0.1em] px-1 py-px border ${
                      showStacks
                        ? "border-accent/40 text-accent"
                        : "border-stone-200 text-stone-400"
                    }`}
                  >
                    {stacksAreAuto ? "Auto" : showStacks ? "On" : "Off"}
                  </span>
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
                <button
                  onClick={() => setViewMode("people")}
                  className={`relative p-1.5 transition-colors ${viewMode === "people" ? "text-stone-900" : "text-stone-300 hover:text-stone-500"}`}
                  aria-label="People view"
                >
                  <Users className="h-4 w-4" />
                  {suggestionCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-medium leading-[14px] text-center">
                      {suggestionCount > 9 ? "9+" : suggestionCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* ─── Person filter chip ─── */}
            {personFilter && viewMode !== "people" && (
              <div className="-mt-7 mb-10 flex items-center gap-2 text-[12px]">
                <span className="text-stone-400">Showing</span>
                <button
                  onClick={() => {
                    setViewMode("people");
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-stone-300 text-stone-700 hover:border-stone-500 transition-colors"
                >
                  <Users className="h-3 w-3" />
                  {personFilter.name ?? "Unnamed person"}
                  <span className="text-stone-400 tabular-nums">
                    {personFilter.imageIds.length}
                  </span>
                </button>
                <button
                  onClick={() => setPersonFilter(null)}
                  aria-label="Clear person filter"
                  className="p-1 text-stone-300 hover:text-stone-600 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* ─── Where this scene lives on the site ─── */}
            {activeScene && (
              <div className="-mt-7 mb-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-stone-400">
                <span>{activeScene.description}</span>
                <span className="text-stone-300">·</span>
                <span className="text-stone-500">
                  {sceneUsageHint(activeScene)}
                </span>
                <a
                  href={sceneUrl(activeScene)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent transition-colors hover:text-accent/80"
                >
                  View live
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* ─── Gallery view ─── */}
            <div ref={gridAreaRef} className="relative">
              {activeSectionData?.locked && (
                <div className="mb-4 flex items-center justify-between gap-4 border border-amber-200 bg-amber-50/70 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Lock className="h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-[13px] text-amber-900">
                      This section is locked — adding, removing, and
                      rearranging are off so nothing shifts by accident.
                    </p>
                  </div>
                  <button
                    onClick={handleUnlockActiveSection}
                    className="shrink-0 border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-amber-700 transition-colors hover:bg-amber-100"
                  >
                    Unlock
                  </button>
                </div>
              )}
              {activeJobSection &&
                (() => {
                  const missing = jobMissingFields(
                    parseJobMeta(activeJobSection.jobMeta)
                  );
                  const live =
                    missing.length === 0 && activeJobSection.imageCount > 0;
                  return (
                    <div
                      className={cn(
                        "mb-4 flex items-center justify-between gap-4 border px-4 py-3",
                        live
                          ? "border-emerald-200 bg-emerald-50/50"
                          : "border-amber-200 bg-amber-50/70"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            live ? "bg-emerald-500" : "bg-amber-400"
                          )}
                        />
                        <p
                          className={cn(
                            "text-[13px] truncate",
                            live ? "text-emerald-900" : "text-amber-900"
                          )}
                        >
                          {live
                            ? "This job is live on the site — the first photo is its cover."
                            : missing.length > 0
                            ? `Not on the site yet — missing ${missing.join(", ")}.`
                            : "Details complete — add photos to put this job live."}
                        </p>
                      </div>
                      <button
                        onClick={() => setJobModalSectionId(activeJobSection.id)}
                        className={cn(
                          "shrink-0 border bg-white px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.15em] transition-colors",
                          live
                            ? "border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                            : "border-amber-300 text-amber-700 hover:bg-amber-100"
                        )}
                      >
                        Job details
                      </button>
                    </div>
                  );
                })()}
              {isSlotSection && (activeSectionData?.imageCount ?? 0) > 1 && (
                activeScene?.rotates ? (
                  <p className="mb-3 text-[12px] text-stone-500">
                    Carousel slot — the page rotates through every photo here
                    in drag order. Your first pick opens.
                  </p>
                ) : (
                  <p className="mb-3 text-[12px] text-amber-600">
                    Slot section — the website uses only the first image. Drag
                    your pick to the front; extras are ignored.
                  </p>
                )
              )}
              {activeScene?.kind === "ordered" &&
                activeScene.positions !== undefined &&
                (activeSectionData?.imageCount ?? 0) > activeScene.positions && (
                  <p className="mb-3 text-[12px] text-amber-600">
                    Position-mapped — the website shows the first{" "}
                    {activeScene.positions} photos in drag order, one per spot;
                    extras are ignored.
                    {!manualMode && (
                      <> Switch to Manual sort to see and arrange the positions.</>
                    )}
                  </p>
                )}
              {viewMode === "people" ? (
                <PeopleView
                  eventId={eventId}
                  activePersonId={personFilter?.id ?? null}
                  imageById={imageThumbById}
                  onSuggestionsCount={setSuggestionCount}
                  onSelectPerson={(person: Person | null) => {
                    if (!person) {
                      setPersonFilter(null);
                      return;
                    }
                    setPersonFilter({
                      id: person.id,
                      name: person.name,
                      imageIds: person.imageIds,
                    });
                    setViewMode("grid");
                  }}
                />
              ) : viewMode === "grid" ? (
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
                    hasSelection={selection.hasSelection}
                    selectedIds={selection.selectedIds}
                    columnCount={gridSettings?.columns}
                    gap={gridSettings?.gap}
                    style={gridSettings?.style}
                    showFilenames={gridSettings?.showFilenames}
                    dndEnabled={dndEnabled}
                    onReorder={handleReorder}
                    showFocalBadge
                    coverImageId={jobCoverImageId}
                    positionBadges={positionBadges}
                  />
                  {/* Bottom-of-results escape hatch: widen a section search to
                      the whole event without losing the query. */}
                  {isSearching && activeSection && (
                    <div className="mt-8 border-t border-stone-100 pt-5 text-center">
                      <p className="text-[13px] text-stone-400">
                        Searching{" "}
                        <span className="text-stone-600">
                          {sections.find((s) => s.id === activeSection)?.name ??
                            "this section"}
                        </span>
                        .{" "}
                        <button
                          onClick={handleSearchAllImages}
                          className="font-medium text-accent hover:text-accent/80 transition-colors"
                        >
                          Search all images instead
                        </button>
                      </p>
                    </div>
                  )}
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
          onRename={handleBatchRename}
          singleImageName={
            selection.count === 1
              ? allImages.find((i) => i.id === selectedArray[0])?.originalFilename
              : null
          }
          onSetCover={
            selection.count === 1
              ? () => handleSetCover(selectedArray[0])
              : undefined
          }
          deleteHint={
            activeSection
              ? `Removes the photos from this section${
                  activeSectionData?.siteSceneKey ? " (and the live site)" : ""
                }. A photo in no other section is deleted from your archive permanently.`
              : "Permanently deletes the selected photos from your archive."
          }
          onCopyToGallery={() => setTransferMode("copy")}
          onMoveToGallery={() => setTransferMode("move")}
          onSetFocalPoint={
            // Anywhere in the website gallery (sections AND All Images): the
            // site crops focal-aware everywhere, so the tool follows the
            // image, not the view. Opens the sweep at the first selected
            // image — ←/→ then reach the whole visible set.
            selection.count >= 1
              ? () => {
                  // From a selection, keep display order and start at the pick.
                  setFocalUnsetFirst(false);
                  setFocalImageId(selectedArray[0]);
                }
              : undefined
          }
          onEditWebsiteDetails={
            isWebsiteContext ? () => setShowCuration(true) : undefined
          }
          sections={sections.map((s) => ({ id: s.id, name: s.name, locked: s.locked }))}
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

      {/* ─── Cross-gallery copy/move picker ─── */}
      {transferMode && selectedArray.length > 0 && (
        <GalleryTransferModal
          mode={transferMode}
          imageIds={selectedArray}
          currentEventId={eventId}
          onClose={() => setTransferMode(null)}
          onDone={({ mode, galleryName, sectionName }) => {
            deselectAll();
            fetchEvent();
            toast.success(
              `${mode === "copy" ? "Copied" : "Moved"} ${selectedArray.length} ${
                selectedArray.length === 1 ? "image" : "images"
              } to ${galleryName} › ${sectionName}`
            );
          }}
        />
      )}

      {/* ─── Focal point sweep (website sections) ─── */}
      {focalImageId && flatImageList.length > 0 && (
        <FocalPointModal
          images={flatImageList}
          initialImageId={focalImageId}
          prioritizeUnset={focalUnsetFirst}
          onClose={() => setFocalImageId(null)}
          onSaved={(imageId, focal) =>
            setAllImages((prev) =>
              prev.map((i) =>
                i.id === imageId
                  ? { ...i, focalX: focal?.x ?? null, focalY: focal?.y ?? null }
                  : i
              )
            )
          }
          onBulkSuggest={
            activeSection
              ? async (onProgress) => {
                  // Chunked: ~10 scans per request so the button can show
                  // real progress and no single call risks a timeout. The
                  // exclude list carries already-attempted ids (a faceless
                  // image writes no rows, so the server can't tell it apart
                  // from a never-scanned one).
                  let exclude: string[] = [];
                  let total: number | null = null;
                  let written = 0;
                  for (;;) {
                    const res = await fetch(
                      `/api/sections/${activeSection}/suggest-focal`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ limit: 10, exclude }),
                      }
                    );
                    if (!res.ok) {
                      throw new Error(await apiError(res, "Bulk suggest failed"));
                    }
                    const data = (await res.json()) as {
                      count: number;
                      suggestions: Array<{ imageId: string; x: number; y: number }>;
                      scannedIds?: string[];
                      remaining?: number;
                    };
                    written += data.count;
                    const byId = new Map(
                      data.suggestions.map((s) => [s.imageId, s])
                    );
                    setAllImages((prev) =>
                      prev.map((i) => {
                        const s = byId.get(i.id);
                        return s ? { ...i, focalX: s.x, focalY: s.y } : i;
                      })
                    );
                    const attempted = data.scannedIds ?? [];
                    exclude = exclude.concat(attempted);
                    const remaining = data.remaining ?? 0;
                    if (total === null) total = attempted.length + remaining;
                    onProgress(exclude.length, total);
                    if (remaining <= 0 || attempted.length === 0) break;
                  }
                  return written;
                }
              : undefined
          }
        />
      )}

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

      {/* ─── Job details (TDP Work gallery — one form per job) ─── */}
      {jobModalSection?.siteSceneKey &&
        (() => {
          // Prefills from the job's own photos: the year they were taken and
          // their source event's city. Empty fields only — saved values win.
          const memberImages = (jobModalSection.imageIds ?? [])
            .map((id) => allImages.find((img) => img.id === id))
            .filter((img): img is ImageData => !!img);
          const prefillYear = mostCommon(
            memberImages.map((img) =>
              img.takenAt ? new Date(img.takenAt).getFullYear() : null
            )
          );
          const prefillCity = mostCommon(
            memberImages.map((img) => img.eventCity ?? null)
          );
          return (
            <JobDetailsModal
              sectionId={jobModalSection.id}
              sectionName={jobModalSection.name}
              siteSceneKey={jobModalSection.siteSceneKey}
              initialMeta={jobModalSection.jobMeta}
              imageCount={jobModalSection.imageCount}
              prefill={{ city: prefillCity, year: prefillYear }}
              onClose={() => setJobModalSectionId(null)}
              onSaved={handleJobSaved}
            />
          );
        })()}

      {/* ─── Keyboard Shortcuts Help ─── */}
      {showShortcutsHelp && (
        <ShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      )}
      </div>{/* end main content flex child */}
    </div>
  );
}
