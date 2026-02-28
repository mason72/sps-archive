"use client";

import { useState, useEffect, useCallback, useMemo, useRef, use } from "react";
import Link from "next/link";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
import { useRouter } from "next/navigation";
import { UploadZone } from "@/components/upload/UploadZone";
import { SearchBar } from "@/components/search/SearchBar";
import { ImageGrid } from "@/components/gallery/ImageGrid";
import { FilmStrip } from "@/components/gallery/FilmStrip";
import { Lightbox } from "@/components/lightbox/Lightbox";
import { ShareModal } from "@/components/shares/ShareModal";
import { SelectionToolbar } from "@/components/gallery/SelectionToolbar";
import { EventSettingsPanel } from "@/components/settings/EventSettingsPanel";
import { SectionManager } from "@/components/sections/SectionManager";
import { ActivitiesPanel } from "@/components/events/ActivitiesPanel";
import { MoreMenu } from "@/components/events/MoreMenu";
import { useSelection } from "@/hooks/useSelection";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import { useGalleryShortcuts } from "@/hooks/useGalleryShortcuts";
import { ShortcutsHelp } from "@/components/command/ShortcutsHelp";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Plus, FolderOpen, Activity, AlertTriangle, X, LayoutGrid, Rows3 } from "lucide-react";
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
  const router = useRouter();
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
  const [showSettings, setShowSettings] = useState(false);
  const [showSectionManager, setShowSectionManager] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [activitiesTab, setActivitiesTab] = useState<"shares" | "favorites" | "emails">("shares");
  const [eventSettings, setEventSettings] = useState<EventSettings>(DEFAULT_EVENT_SETTINGS);
  const [failedUploads, setFailedUploads] = useState<File[]>([]);
  const [retryFiles, setRetryFiles] = useState<File[] | undefined>(undefined);
  const [viewMode, setViewMode] = useState<"grid" | "filmstrip">("grid");

  // Section image IDs (for filtering when a section is active)
  const [sectionImageIds, setSectionImageIds] = useState<Set<string> | null>(null);

  // Selection state
  const selection = useSelection();

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

  // Escape key exits selection mode
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selection.isSelecting) {
        selection.deselectAll();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection.isSelecting, selection.deselectAll]);

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
      const count = selection.count;
      const res = await fetch("/api/images/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: selection.selectedArray }),
      });
      if (!res.ok) throw new Error("Delete failed");
      selection.deselectAll();
      fetchEvent();
      toast.success(`Deleted ${count} images`);
    } catch (err) {
      console.error("Batch delete failed:", err);
      toast.error("Failed to delete images");
    }
  }, [selection, fetchEvent]);

  const handleBatchFavorite = useCallback(async () => {
    try {
      // Find the first active share for this event to attach favorites to
      const sharesRes = await fetch(`/api/shares?eventId=${eventId}`);
      if (!sharesRes.ok) throw new Error("Failed to load shares");
      const sharesData = await sharesRes.json();
      const activeShare = sharesData.shares?.find(
        (s: { isActive: boolean }) => s.isActive
      );

      if (!activeShare) {
        toast.error("Create a share link first before marking favorites.");
        return;
      }

      const res = await fetch("/api/images/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageIds: selection.selectedArray,
          action: "favorite",
          shareId: activeShare.id,
        }),
      });
      if (!res.ok) throw new Error("Favorite failed");
      selection.deselectAll();
      toast.success(`Starred ${selection.count} images`);
    } catch (err) {
      console.error("Batch favorite failed:", err);
      toast.error("Failed to star images");
    }
  }, [eventId, selection]);

  const handleCreateSelectionLink = useCallback(() => {
    setShareModalImageIds([...selection.selectedArray]);
    setShowShareModal(true);
  }, [selection.selectedArray]);

  const handleBatchDownload = useCallback(() => {
    const selectedImages = images.filter((img) =>
      selection.selectedIds.has(img.id)
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
  }, [images, selection.selectedIds]);

  const handleAddToSection = useCallback(
    async (sectionId: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: selection.selectedArray }),
        });
        if (!res.ok) throw new Error("Failed to add images to section");
        // Refresh to update section counts
        fetchEvent();
        toast.success("Added to section");
      } catch (err) {
        console.error("Add to section failed:", err);
        toast.error("Failed to add to section");
      }
    },
    [selection, fetchEvent]
  );

  const handleSectionsChange = useCallback((updated: SectionData[]) => {
    setSections(updated);
  }, []);

  const standalone = images.filter((img) => !img.stackId);

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
        setShareModalImageIds(undefined);
        setShowShareModal(true);
      },
      selectionCount: selection.count,
      enabled: !selectedImageId && !showSettings && !showShareModal,
    });

  // Flat list of all images for lightbox navigation
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

  // Grid settings from event settings
  const gridSettings = eventSettings.grid;

  return (
    <div className="min-h-screen">
      {/* ─── Nav ─── */}
      <Nav>
        <button onClick={() => setShowUpload((v) => !v)} className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300">
          {showUpload ? "Hide Upload" : "Upload"}
        </button>
        <button onClick={() => { setShareModalImageIds(undefined); setShowShareModal(true); }} className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300">
          Share
        </button>
        <button onClick={() => setShowSettings((v) => !v)} className="editorial-link text-stone-400 hover:text-stone-700 transition-colors duration-300">
          Settings
        </button>
        <button onClick={() => { setActivitiesTab("shares"); setShowActivities(true); }} className="text-stone-400 hover:text-stone-700 transition-colors duration-300" aria-label="Activity">
          <Activity size={16} />
        </button>
        <MoreMenu eventId={eventId} eventName={event?.name || "Event"} onShowEmails={() => { setActivitiesTab("emails"); setShowActivities(true); }} />
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

            {/* ─── Search ─── */}
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

            {/* ─── Section tabs ─── */}
            <div className="mb-10 flex items-center gap-3 overflow-x-auto">
              {sections.length > 0 && (
                <>
                  <button
                    onClick={() => setActiveSection(null)}
                    className={cn(
                      "px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border transition-all duration-300 shrink-0",
                      !activeSection
                        ? "border-stone-900 bg-stone-900 text-white"
                        : "border-stone-200 text-stone-500 hover:border-stone-400"
                    )}
                  >
                    All
                  </button>
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        "px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-medium border transition-all duration-300 shrink-0",
                        activeSection === section.id
                          ? "border-stone-900 bg-stone-900 text-white"
                          : "border-stone-200 text-stone-500 hover:border-stone-400"
                      )}
                    >
                      {section.name}
                      {section.imageCount > 0 && (
                        <span className="ml-1.5 text-[10px] opacity-60">
                          {section.imageCount}
                        </span>
                      )}
                    </button>
                  ))}

                  {/* Add section button */}
                  <button
                    onClick={() => setShowSectionManager(true)}
                    className="px-3 py-2 text-[12px] border border-dashed border-stone-200 text-stone-400 hover:border-stone-400 hover:text-stone-600 transition-all duration-300 shrink-0 flex items-center gap-1.5"
                    aria-label="Add section"
                  >
                    <Plus size={12} />
                    <span className="hidden sm:inline">Add Set</span>
                  </button>

                  {/* Manage sections button (if sections exist) */}
                  {sections.length > 0 && (
                    <button
                      onClick={() => setShowSectionManager(true)}
                      className="px-3 py-2 text-[12px] text-stone-400 hover:text-stone-600 transition-colors shrink-0 flex items-center gap-1.5"
                      aria-label="Manage sections"
                    >
                      <FolderOpen size={12} />
                      <span className="hidden sm:inline">Manage</span>
                    </button>
                  )}
                </>
              )}
            </div>

            {/* ─── Gallery divider ─── */}
            <div className="editorial-divider mb-10">
              <span className="label-caps shrink-0">
                {activeSection
                  ? sections.find((s) => s.id === activeSection)?.name || "Section"
                  : "Gallery"}
              </span>
              <div className="flex items-center gap-2">
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
            {viewMode === "grid" ? (
              <ImageGrid
                images={images}
                stacks={stacks}
                standalone={standalone}
                onImageClick={(id, shiftKey) => {
                  if (selection.isSelecting) {
                    selection.toggle(id);
                  } else if (shiftKey) {
                    // Shift+click enters selection mode
                    selection.toggle(id);
                  } else {
                    setSelectedImageId(id);
                  }
                }}
                onSetCover={async (stackId, imageId) => {
                  await fetch(`/api/stacks/${stackId}/cover`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ imageId }),
                  });
                  fetchEvent();
                }}
                isSelecting={selection.isSelecting}
                selectedIds={selection.selectedIds}
                onToggleSelect={selection.toggle}
                columnCount={gridSettings?.columns}
                gap={gridSettings?.gap}
              />
            ) : (
              <FilmStrip
                images={images}
                stacks={stacks}
                standalone={standalone}
                onImageClick={(id) => {
                  if (selection.isSelecting) {
                    selection.toggle(id);
                  } else {
                    setSelectedImageId(id);
                  }
                }}
                isSelecting={selection.isSelecting}
                selectedIds={selection.selectedIds}
                onToggleSelect={selection.toggle}
              />
            )}
          </>
        )}
      </main>

      {/* ─── Footer ─── */}
      <Footer />

      {/* ─── Selection Toolbar ─── */}
      {selection.isSelecting && (
        <SelectionToolbar
          count={selection.count}
          onDeselectAll={selection.deselectAll}
          onDelete={handleBatchDelete}
          onFavorite={handleBatchFavorite}
          onCreateShareLink={handleCreateSelectionLink}
          onDownload={handleBatchDownload}
          onAddToSection={handleAddToSection}
          sections={sections.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}

      {/* ─── Section Manager ─── */}
      {showSectionManager && (
        <SectionManager
          eventId={eventId}
          sections={sections}
          onSectionsChange={handleSectionsChange}
          onClose={() => setShowSectionManager(false)}
        />
      )}

      {/* ─── Settings Panel ─── */}
      {showSettings && (
        <EventSettingsPanel
          eventId={eventId}
          settings={eventSettings}
          onSettingsChange={setEventSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ─── Activities Panel ─── */}
      <ActivitiesPanel
        eventId={eventId}
        open={showActivities}
        onClose={() => setShowActivities(false)}
        initialTab={activitiesTab}
      />

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
      {selectedImageId && flatImageList.length > 0 && !selection.isSelecting && (
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
    </div>
  );
}
