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
import { EventSidebar } from "@/components/events/EventSidebar";
import { useSelection } from "@/hooks/useSelection";
import { useMarqueeSelect } from "@/hooks/useMarqueeSelect";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import { useGalleryShortcuts } from "@/hooks/useGalleryShortcuts";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { BrandButton } from "@/components/ui/brand-button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertTriangle, X, LayoutGrid, Rows3, Eye, EyeOff, ArrowUpDown } from "lucide-react";
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
  const [viewMode, setViewMode] = useState<"grid" | "filmstrip">("grid");
  const [sortBy, setSortBy] = useState<"upload" | "filename" | "date-taken">("upload");
  const [hasActiveShare, setHasActiveShare] = useState(false);
  const [activeShareSlug, setActiveShareSlug] = useState<string | null>(null);

  // Section image IDs (for filtering when a section is active)
  const [sectionImageIds, setSectionImageIds] = useState<Set<string> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  // Processing status
  const processing = useProcessingStatus(eventId, true);
  const wasProcessingRef = useRef(false);

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
        setEventSettings({ ...DEFAULT_EVENT_SETTINGS, ...data.event.settings });
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

  // Fire celebration toast when processing completes
  useEffect(() => {
    if (processing.isProcessing) {
      wasProcessingRef.current = true;
    } else if (wasProcessingRef.current && processing.total > 0) {
      wasProcessingRef.current = false;
      toast.success(`${processing.total} photos processed`);
      // Refresh to show newly processed images
      fetchEvent();
    }
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
  // When a section is activated, fetch its image IDs and filter the grid
  useEffect(() => {
    if (!activeSection) {
      // Show all images
      setSectionImageIds(null);
      if (!isSearching) {
        setImages(allImages);
        setStacks(allStacks);
      }
      return;
    }

    // Fetch section image IDs from the API
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sections/${activeSection}/images?list=true`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ids = new Set<string>(data.imageIds || []);
        if (!cancelled) {
          setSectionImageIds(ids);
        }
      } catch {
        // If fetch fails, just show all images
        if (!cancelled) setSectionImageIds(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSection, allImages, allStacks, isSearching]);

  // Apply section filter to images/stacks whenever sectionImageIds changes
  useEffect(() => {
    if (isSearching) return; // Don't override search results
    if (!sectionImageIds) {
      setImages(allImages);
      setStacks(allStacks);
      return;
    }

    // Filter images to only those in the section
    const filtered = allImages.filter((img) => sectionImageIds.has(img.id));
    setImages(filtered);

    // Filter stacks: only include stacks that have at least one image in the section
    const filteredStacks = allStacks
      .map((stack) => ({
        ...stack,
        images: stack.images.filter((img) => sectionImageIds.has(img.id)),
      }))
      .filter((stack) => stack.images.length > 0);
    setStacks(filteredStacks);
  }, [sectionImageIds, allImages, allStacks, isSearching]);

  const handleUploadComplete = useCallback(
    (imageIds: string[]) => {
      fetchEvent();
      toast.success(`${imageIds.length} images uploaded`);
      // Clear retry state on successful upload (retry worked)
      setRetryFiles(undefined);

      // Celebrate! Subtle confetti burst for large uploads
      if (imageIds.length >= 5) {
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
    const sorted = [...images];
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
  }, [images, sortBy]);

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
        />
      )}

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* ─── Nav ─── */}
      <Nav>
        {/* Add Images / Upload */}
        <button
          onClick={() => setShowUpload((v) => !v)}
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
            {processing.isProcessing && (
              <div className="mb-8 reveal" style={{ animationDelay: "0.05s" }}>
                <div className="h-[2px] w-full overflow-hidden rounded-full bg-stone-100">
                  <div
                    className="h-full rounded-full processing-bar"
                    style={{
                      width: processing.total > 0
                        ? `${((processing.complete + processing.failed) / processing.total) * 100}%`
                        : "0%",
                    }}
                  />
                </div>
                <p className="mt-2 text-[13px] text-stone-400">
                  Processing {processing.complete + processing.failed} of{" "}
                  {processing.total} images...
                </p>
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

            {/* ─── Search + Gallery (only show when images exist) ─── */}
            {allImages.length > 0 && (
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
              </span>
              <div className="flex items-center gap-3">
                {/* Sort dropdown */}
                <div className="relative flex items-center gap-1.5">
                  <ArrowUpDown className="h-3.5 w-3.5 text-stone-400" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "upload" | "filename" | "date-taken")}
                    className="appearance-none bg-transparent text-[12px] text-stone-500 hover:text-stone-700 cursor-pointer pr-4 focus:outline-none transition-colors"
                  >
                    <option value="upload">Upload Date</option>
                    <option value="filename">Filename</option>
                    <option value="date-taken">Date Taken</option>
                  </select>
                </div>

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
          onMoveToSection={activeSection ? handleMoveToSection : undefined}
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
