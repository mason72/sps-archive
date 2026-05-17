"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppNav } from "@/components/layout/AppNav";
import { PixelMosaic } from "@/components/ui/PixelMosaic";
import { Footer } from "@/components/layout/Footer";

import { UploadZone } from "@/components/upload/UploadZone";
import { SearchBar } from "@/components/search/SearchBar";
import { ImageGrid } from "@/components/gallery/ImageGrid";
import { FilmStrip } from "@/components/gallery/FilmStrip";
import { Lightbox } from "@/components/lightbox/Lightbox";
import { ShareModal } from "@/components/shares/ShareModal";
import { SelectionToolbar } from "@/components/gallery/SelectionToolbar";
import { EventSidebar, type Panel } from "@/components/events/EventSidebar";
import { useSelection } from "@/hooks/useSelection";
import { useMarqueeSelect } from "@/hooks/useMarqueeSelect";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import { useGalleryShortcuts } from "@/hooks/useGalleryShortcuts";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { BrandButton } from "@/components/ui/brand-button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertTriangle, X, LayoutGrid, Rows3, Eye, EyeOff, ArrowUpDown, Check, CheckSquare, Upload, Trash2, Star, ImageIcon } from "lucide-react";
import type { ImageData, StackData } from "@/types/image";
import type { EventSettings } from "@/types/event-settings";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
import { ImageGridSkeleton } from "@/components/ui/Skeleton";
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
}

export default function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventData | null>(null);
  const [images, setImages] = useState<ImageData[]>([]);
  const [stacks, setStacks] = useState<StackData[]>([]);
  const [sections, setSections] = useState<SectionData[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [allStacks, setAllStacks] = useState<StackData[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareModalImageIds, setShareModalImageIds] = useState<string[] | undefined>(undefined);
  const [eventSettings, setEventSettings] = useState<EventSettings>(DEFAULT_EVENT_SETTINGS);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [retryFiles, setRetryFiles] = useState<File[] | undefined>(undefined);
  const hadUploadErrors = useRef(false);
  const [viewMode, setViewMode] = useState<"grid" | "filmstrip">("grid");
  /** Filter the grid to photographer-starred images only (toolbar toggle). */
  const [starredOnly, setStarredOnly] = useState(false);
  const [sortBy, setSortByState] = useState<"upload" | "filename" | "date-taken">("upload");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [hasActiveShare, setHasActiveShare] = useState(false);
  const [activeShareSlug, setActiveShareSlug] = useState<string | null>(null);

  // Section image IDs (for filtering when a section is active)
  const [sectionImageIds, setSectionImageIds] = useState<Set<string> | null>(null);
  // Stable ref for activeSection so UploadZone always has the current value
  const activeSectionRef = useRef<string | null>(null);
  activeSectionRef.current = activeSection;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPanel, setSidebarPanel] = useState<Panel | null>("sections");
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const previewRefreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Selection state
  const selection = useSelection();
  // Destructure stable references for use in dependency arrays
  // (the `selection` object itself is recreated every render)
  const { selectedArray, selectedIds, count: selectionCount, hasSelection, deselectAll } = selection;

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

  // Processing status
  const processing = useProcessingStatus(eventId, true);
  const wasProcessingRef = useRef(false);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`);
      if (!res.ok) throw new Error("Failed to load event");
      const data = await res.json();

      setEvent(data.event);
      setImages(data.images);
      setAllImages(data.images);
      setStacks(data.stacks);
      setAllStacks(data.stacks);
      setSections(data.sections);
      setShowUpload(data.images.length === 0);
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

  // Open the lightbox on the deep-linked image once it's loaded. Used by
  // the global search results page: clicking a thumbnail navigates here
  // with `?image=<id>` and the user lands on that specific photo instead
  // of the top of the gallery.
  const searchParams = useSearchParams();
  const deepLinkImageId = searchParams.get("image");
  const deepLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (deepLinkAppliedRef.current || !deepLinkImageId) return;
    if (!allImages.some((img) => img.id === deepLinkImageId)) return;
    deepLinkAppliedRef.current = true;
    setSelectedImageId(deepLinkImageId);
  }, [deepLinkImageId, allImages]);

  // Fire celebration toast when processing completes (debounced to prevent oscillation)
  useEffect(() => {
    if (processing.isProcessing) {
      wasProcessingRef.current = true;
      // Cancel any pending celebration — processing resumed
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    } else if (wasProcessingRef.current && processing.total > 0) {
      // Debounce: wait 5s to confirm processing is truly done
      processingTimerRef.current = setTimeout(() => {
        processingTimerRef.current = null;
        wasProcessingRef.current = false;
        toast.success(`${processing.total} photos processed`);
        fetchEvent();
      }, 5000);
    }

    return () => {
      if (processingTimerRef.current) {
        clearTimeout(processingTimerRef.current);
      }
    };
  }, [processing.isProcessing, processing.total, fetchEvent]);

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

  // ─── Section filtering ───
  // Single effect: fetch section image IDs AND filter the grid sequentially
  // (prevents race condition where filter runs before new IDs arrive)
  useEffect(() => {
    if (isSearching) return; // Don't override search results

    if (!activeSection) {
      // Show all images
      setSectionImageIds(null);
      setImages(allImages);
      setStacks(allStacks);
      return;
    }

    // Fetch section image IDs from the API, then filter
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sections/${activeSection}/images?list=true`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ids = new Set<string>(data.imageIds || []);
        if (cancelled) return;

        setSectionImageIds(ids);

        // Filter images to only those in the section
        const filtered = allImages.filter((img) => ids.has(img.id));
        setImages(filtered);

        // Filter stacks
        const filteredStacks = allStacks
          .map((stack) => ({
            ...stack,
            images: stack.images.filter((img) => ids.has(img.id)),
          }))
          .filter((stack) => stack.images.length > 0);
        setStacks(filteredStacks);
      } catch {
        // If fetch fails, just show all images
        if (!cancelled) {
          setSectionImageIds(null);
          setImages(allImages);
          setStacks(allStacks);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, allImages, allStacks, isSearching]);

  const handleUploadComplete = useCallback(
    async (imageIds: string[]) => {
      // Images are already assigned to the correct section by /api/upload via sectionId.
      // No auto-assignment needed — just refresh and celebrate.
      fetchEvent();
      toast.success(`${imageIds.length} images uploaded`);
      // Clear retry state on successful upload (retry worked)
      setRetryFiles(undefined);

      // Celebrate! Subtle confetti burst for large uploads (suppress if errors occurred)
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
    [fetchEvent, eventId]
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
      setImages(searchImages);
      setStacks([]);
    },
    []
  );

  const handleSearchClear = useCallback(() => {
    setIsSearching(false);
    setImages(allImages);
    setStacks(allStacks);
  }, [allImages, allStacks]);

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

  const handleBatchFavorite = useCallback(async () => {
    // F-key + bulk-star button now toggles the photographer-private
    // `starred` flag on the selected images. Pre-Phase-3 this auto-
    // created a public share and inserted rows into the favorites
    // table — terrifying for organizational use, since the
    // photographer's culling marks would leak as if a client had
    // picked them.
    //
    // If any of the selected images are unstarred we star them all;
    // if they're all already starred we unstar them all.
    if (selectedArray.length === 0) return;
    const anyUnstarred = selectedArray.some(
      (id) => !allImages.find((img) => img.id === id)?.starred
    );
    const action = anyUnstarred ? "star" : "unstar";
    const nextValue = anyUnstarred;

    // Optimistic local update so the grid + lightbox reflect the new
    // state immediately. Roll back on failure.
    const previousStarred = new Map(
      selectedArray.map((id) => [
        id,
        allImages.find((img) => img.id === id)?.starred ?? false,
      ])
    );
    const apply = (next: boolean) => {
      setAllImages((prev) =>
        prev.map((i) =>
          previousStarred.has(i.id) ? { ...i, starred: next } : i
        )
      );
      setImages((prev) =>
        prev.map((i) =>
          previousStarred.has(i.id) ? { ...i, starred: next } : i
        )
      );
    };
    apply(nextValue);

    try {
      const res = await fetch("/api/images/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageIds: selectedArray,
          action,
        }),
      });
      if (!res.ok) throw new Error("Star failed");
      const cnt = selectionCount;
      deselectAll();
      toast.success(
        nextValue ? `Starred ${cnt} ${cnt === 1 ? "image" : "images"}` : `Unstarred ${cnt} ${cnt === 1 ? "image" : "images"}`
      );
    } catch (err) {
      console.error("Batch star failed:", err);
      // Roll back to the per-image previous state.
      setAllImages((prev) =>
        prev.map((i) =>
          previousStarred.has(i.id)
            ? { ...i, starred: previousStarred.get(i.id)! }
            : i
        )
      );
      setImages((prev) =>
        prev.map((i) =>
          previousStarred.has(i.id)
            ? { ...i, starred: previousStarred.get(i.id)! }
            : i
        )
      );
      toast.error("Failed to update stars");
    }
  }, [allImages, selectedArray, selectionCount, deselectAll]);

  const handleCreateSelectionLink = useCallback(() => {
    setShareModalImageIds([...selectedArray]);
    setShowShareModal(true);
  }, [selectedArray]);

  const handleBatchDownload = useCallback(() => {
    const selectedImages = images.filter((img) =>
      selectedIds.has(img.id)
    );
    selectedImages.forEach((img) => {
      const url = img.originalUrl || img.thumbnailUrl;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = img.originalFilename || "image";
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
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
      // Always add to the target FIRST, then remove from the source.
      // Pre-fix this was DELETE-then-POST; if the POST failed, the
      // image landed in zero sections (sections are not exclusive, so
      // it's safe to be in both briefly mid-move, but it's never safe
      // to be in neither).
      const isMove = !!activeSection && activeSection !== sectionId;
      try {
        const addRes = await fetch(`/api/sections/${sectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds }),
        });
        if (!addRes.ok) throw new Error("Failed to add to target section");

        if (isMove) {
          const removeRes = await fetch(
            `/api/sections/${activeSection}/images`,
            {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageIds }),
            }
          );
          if (!removeRes.ok) {
            // The add succeeded but the remove failed — the image is
            // now in BOTH sections, which is non-destructive (sections
            // are non-exclusive). Surface so the photographer knows
            // and can clean up.
            console.error("Section move: remove-from-source step failed");
            toast(
              `Copied ${imageIds.length} ${imageIds.length === 1 ? "image" : "images"} — couldn't remove from the original section`,
              { duration: 5000 }
            );
            deselectAll();
            fetchEvent();
            return;
          }
        }

        deselectAll();
        fetchEvent();
        const action = isMove ? "Moved" : "Added";
        toast.success(
          `${action} ${imageIds.length} ${imageIds.length === 1 ? "image" : "images"} to section`
        );
      } catch (err) {
        console.error("Drop to section failed:", err);
        toast.error("Couldn't move images to that section");
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

  // Sort images based on user selection (stacks keep internal rank order)
  const sortedImages = useMemo(() => {
    let working = images;
    if (starredOnly) working = working.filter((img) => img.starred);
    const sorted = [...working];
    switch (sortBy) {
      case "filename":
        sorted.sort((a, b) =>
          (a.parsedName || a.originalFilename).localeCompare(
            b.parsedName || b.originalFilename
          )
        );
        break;
      case "date-taken":
        sorted.sort((a, b) => {
          if (!a.takenAt && !b.takenAt) return 0;
          if (!a.takenAt) return 1;
          if (!b.takenAt) return -1;
          return a.takenAt.localeCompare(b.takenAt);
        });
        break;
      default:
        break; // "upload" — keep API order (created_at asc)
    }
    return sorted;
  }, [images, sortBy, starredOnly]);

  const standalone = sortedImages.filter((img) => !img.stackId);

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
    for (const stack of stacks) {
      for (const img of stack.images) {
        list.push(img);
      }
    }
    for (const img of standalone) {
      list.push(img);
    }
    return list;
  }, [stacks, standalone]);

  // Ordered IDs for shift+click range selection
  const flatOrderedIds = useMemo(
    () => flatImageList.map((img) => img.id),
    [flatImageList]
  );

  // Grid settings from event settings
  const gridSettings = eventSettings.grid;

  // Persist sort selection to event settings
  const setSortBy = useCallback(async (value: "upload" | "filename" | "date-taken") => {
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
          onSetActiveSection={setActiveSection}
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
      <AppNav
        active="events"
        actions={
          <>
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

            {/* Preview — opens the client-facing gallery in a new tab so
                the photographer can see exactly what their client will. */}
            <a
              href={activeShareSlug ? `/gallery/${activeShareSlug}` : `/gallery/preview/${eventId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300"
              title="Open the gallery the way your client sees it"
            >
              Preview as client
            </a>

            {/* Send to client — single canonical CTA. Compose page handles
                share creation if none exists; share-link copy if just
                wanting a URL. */}
            <Link
              href={
                hasActiveShare
                  ? `/events/${eventId}/share?slug=${activeShareSlug}`
                  : `/events/${eventId}/share`
              }
            >
              <BrandButton
                size={hasActiveShare ? "sm" : "md"}
                color="emerald"
                celebrate={!hasActiveShare}
              >
                Send to client
              </BrandButton>
            </Link>
          </>
        }
      />

      <main className="px-8 md:px-16 pt-12 pb-24">
        {/* ─── Event header ─── */}
        <div className="mb-12">
          <Link
            href="/"
            className="label-caps text-accent hover:text-accent-hover transition-colors duration-300 mb-4 inline-block"
          >
            ← Back to archive
          </Link>
          <h1 className="font-editorial text-[clamp(36px,5vw,64px)] leading-[0.95] text-stone-900 reveal">
            {event?.name || "Event"}
          </h1>
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
            {/* ─── Processing indicator ─── */}
            {(processing.isProcessing || processing.failed > 0) && (
              <div className="mb-8 reveal" style={{ animationDelay: "0.05s" }}>
                {/* Progress bar with dual colors: emerald for complete, red for failed */}
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full flex">
                    {processing.complete > 0 && (
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${(processing.complete / processing.total) * 100}%` }}
                      />
                    )}
                    {processing.failed > 0 && (
                      <div
                        className="h-full bg-red-400 transition-all duration-500"
                        style={{ width: `${(processing.failed / processing.total) * 100}%` }}
                      />
                    )}
                    {(processing.pending + processing.processing) > 0 && (
                      <div
                        className="h-full processing-bar transition-all duration-500"
                        style={{ width: `${((processing.pending + processing.processing) / processing.total) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                {processing.isProcessing && (
                  <p className="mt-1.5 text-[11px] text-stone-300 tracking-wide">
                    Generating thumbnails
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[13px] text-stone-500 tabular-nums">
                    {processing.isProcessing ? (
                      <>
                        <span className="text-stone-400">Processing</span>
                        <span className="text-stone-300"> — </span>
                        <span className="text-emerald-600 font-medium">{processing.complete.toLocaleString()}</span>
                        <span className="text-stone-300"> of </span>
                        <span className="font-medium">{processing.total.toLocaleString()}</span>
                        <span className="text-stone-300"> complete</span>
                        {processing.processing > 0 && (
                          <span className="text-stone-400"> · {processing.processing} active</span>
                        )}
                        {processing.pending > 0 && (
                          <span className="text-stone-400"> · {processing.pending.toLocaleString()} queued</span>
                        )}
                        {processing.failed > 0 && (
                          <span className="text-red-400"> · {processing.failed.toLocaleString()} failed</span>
                        )}
                      </>
                    ) : processing.failed > 0 ? (
                      <span className="text-stone-400">
                        Processing failed for{" "}
                        <span className="text-red-400 font-medium">{processing.failed.toLocaleString()}</span>
                        {" "}{processing.failed === 1 ? "image" : "images"}
                        {processing.complete > 0 && (
                          <> · <span className="text-emerald-600">{processing.complete.toLocaleString()} complete</span></>
                        )}
                        {" — "}
                        <span className="text-stone-500">
                          thumbnails & search won&apos;t work for these until retried
                        </span>
                      </span>
                    ) : null}
                  </p>
                  {(processing.failed > 0 || (processing.pending > 0 && !processing.processing)) && (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/events/${eventId}/retry-processing`, { method: "POST" });
                          if (res.ok) {
                            toast.success("Retrying stuck images...");
                          } else {
                            toast.error("Failed to retry");
                          }
                        } catch {
                          toast.error("Failed to retry");
                        }
                      }}
                      className="text-[12px] font-medium text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                    >
                      {processing.failed > 0 ? "Retry Failed →" : "Retry Processing →"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ─── Upload zone ─── */}
            <div
              className={cn(
                "transition-all duration-300 ease-in-out overflow-hidden",
                showUpload ? "max-h-[500px] opacity-100 mb-12" : "max-h-0 opacity-0"
              )}
            >
              <UploadZone
                eventId={eventId}
                sectionId={activeSection}
                sectionName={activeSection ? sections.find((s) => s.id === activeSection)?.name : null}
                onUploadComplete={handleUploadComplete}
                onUploadFailed={handleUploadFailed}
                retryFiles={retryFiles}
              />
            </div>

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
            {allImages.length === 0 && !processing.isProcessing && (
              <div className="flex flex-col items-center justify-center py-20 text-center fade-in">
                <div className="text-stone-300 mb-6">
                  <PixelMosaic size={36} className="opacity-100" />
                </div>
                <p className="font-editorial text-xl text-stone-400 italic mb-2">
                  Your gallery awaits
                </p>
                <p className="text-[13px] text-stone-400 max-w-xs leading-relaxed">
                  Drop images above or click upload to begin. They&apos;ll
                  appear here as they finish uploading.
                </p>
              </div>
            )}

            {/* ─── Empty section state ─── */}
            {activeSection && allImages.length > 0 && images.length === 0 && sidebarPanel !== "design" && (
              <div
                onClick={() => setShowUpload(true)}
                className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-stone-200 hover:border-stone-300 rounded-lg cursor-pointer transition-colors group fade-in"
              >
                <Upload className="h-8 w-8 text-stone-300 group-hover:text-stone-400 transition-colors mb-4" />
                <p className="text-[13px] font-medium text-stone-400 group-hover:text-stone-600 transition-colors">
                  Drag images here or click to upload
                </p>
                <p className="text-[11px] text-stone-300 mt-1">
                  to {sections.find((s) => s.id === activeSection)?.name || "this section"}
                </p>
              </div>
            )}

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
                    {sortBy === "upload" ? "Upload Date" : sortBy === "filename" ? "Filename" : "Date Taken"}
                  </button>
                  {sortOpen && (
                    <div className="absolute top-full right-0 mt-2 bg-white border border-stone-200 shadow-lg py-1 min-w-[140px] z-30 scale-in">
                      {([
                        ["upload", "Upload Date"],
                        ["filename", "Filename"],
                        ["date-taken", "Date Taken"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => { setSortBy(value); setSortOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] flex items-center justify-between gap-3 transition-colors ${
                            sortBy === value
                              ? "text-stone-900 bg-stone-50"
                              : "text-stone-500 hover:bg-stone-50 hover:text-stone-700"
                          }`}
                        >
                          {label}
                          {sortBy === value && <Check className="h-3.5 w-3.5 text-accent" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="w-px h-4 bg-stone-200" />

                {/* Starred-only filter */}
                <button
                  onClick={() => setStarredOnly((v) => !v)}
                  className={`p-1.5 transition-colors ${
                    starredOnly
                      ? "text-amber-500"
                      : "text-stone-300 hover:text-stone-500"
                  }`}
                  aria-label="Show only starred"
                  aria-pressed={starredOnly}
                  title={starredOnly ? "Show all" : "Show only starred"}
                >
                  <Star
                    className="h-4 w-4"
                    fill={starredOnly ? "currentColor" : "none"}
                  />
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
              {viewMode === "grid" ? (
                <ImageGrid
                  images={images}
                  stacks={stacks}
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
                />
              ) : (
                <FilmStrip
                  images={images}
                  stacks={stacks}
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
            {
              id: "star",
              label: "Star this image",
              // Filled-in when currently starred; outline otherwise. Resolved
              // by looking up the latest state of the image in allImages so
              // the icon updates as you press F repeatedly.
              icon: (
                <Star
                  className="h-[18px] w-[18px]"
                  fill={allImages.find((i) => i.id === selectedImageId)?.starred ? "currentColor" : "none"}
                />
              ),
              shortcut: "f",
              onAct: async (image) => {
                const willStar = !image.starred;
                // Optimistic update — flip the local state so the next
                // press of F (and the badge in the grid) reads correctly.
                setAllImages((prev) =>
                  prev.map((i) => (i.id === image.id ? { ...i, starred: willStar } : i))
                );
                setImages((prev) =>
                  prev.map((i) => (i.id === image.id ? { ...i, starred: willStar } : i))
                );
                try {
                  const res = await fetch(`/api/images/${image.id}/star`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ starred: willStar }),
                  });
                  if (!res.ok) throw new Error("star failed");
                  toast(willStar ? "Starred" : "Unstarred", { duration: 1200 });
                } catch (err) {
                  console.error("[lightbox] star failed:", err);
                  // Roll back.
                  setAllImages((prev) =>
                    prev.map((i) => (i.id === image.id ? { ...i, starred: !willStar } : i))
                  );
                  setImages((prev) =>
                    prev.map((i) => (i.id === image.id ? { ...i, starred: !willStar } : i))
                  );
                  toast.error("Failed to update star");
                }
              },
            },
            {
              id: "set-as-cover",
              label: "Set as event cover",
              icon: <ImageIcon className="h-[18px] w-[18px]" />,
              shortcut: "c",
              onAct: async (image) => {
                try {
                  const res = await fetch(`/api/events/${eventId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      settings: { cover: { enabled: true, imageId: image.id } },
                    }),
                  });
                  if (!res.ok) throw new Error("set cover failed");
                  toast.success("Cover image set");
                  fetchEvent();
                } catch (err) {
                  console.error("[lightbox] set cover failed:", err);
                  toast.error("Failed to set cover");
                }
              },
            },
            {
              id: "delete",
              label: "Delete image",
              icon: <Trash2 className="h-[18px] w-[18px]" />,
              shortcut: "Delete",
              destructive: true,
              // Inline two-stage confirm rather than native confirm() —
              // the browser dialog felt jarring against the editorial
              // lightbox. The Trash icon flips to "Confirm" in red for
              // ~3s; a second press commits.
              requiresConfirm: true,
              confirmLabel: "Confirm delete",
              onAct: async (image) => {
                try {
                  const res = await fetch("/api/images/batch", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ imageIds: [image.id] }),
                  });
                  if (!res.ok) throw new Error("delete failed");
                  toast.success("Image deleted");
                  fetchEvent();
                  return "close" as const;
                } catch (err) {
                  console.error("[lightbox] delete failed:", err);
                  toast.error("Failed to delete image");
                }
              },
            },
          ]}
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
