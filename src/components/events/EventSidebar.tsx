"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { lastViewedLabel } from "@/lib/shares/last-viewed";
import {
  ChevronRight,
  FolderOpen,
  Palette,
  Settings,
  Activity,
  Plus,
  Copy,
  Check,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  ImageIcon,
  CalendarDays,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  Download,
  Upload,
  Search,
  X,
  Sparkles,
  FolderTree,
} from "lucide-react";
import { SectionRow } from "@/components/sections/SectionRow";
import {
  CURATED_SECTION_NAME,
  INTAKE_SECTION_NAME,
  findIntakeSectionId,
} from "@/lib/sections/intake";
import { isJobSceneKey, jobMissingFields, parseJobMeta } from "@/lib/site/jobs";
import { sceneForKey } from "@/lib/site/scenes";
import { CoverLayoutTab } from "@/components/settings/CoverLayoutTab";
import { TypographyTab } from "@/components/settings/TypographyTab";
import { ColorTab } from "@/components/settings/ColorTab";
import { GridTab } from "@/components/settings/GridTab";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import type { EventSettings, SharingSettings } from "@/types/event-settings";
import {
  DEFAULT_SHARING_SETTINGS,
  normalizeCoverSettings,
  selfieSearchEnabled,
} from "@/types/event-settings";

/* ─── Types ─── */

interface SectionItem {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
  /** Soft guard: locked sections reject membership/order edits until unlocked. */
  locked?: boolean;
  /** Website scene / job key this section feeds, else null. */
  siteSceneKey?: string | null;
  /** Job-sheet metadata (TDP Work gallery), raw jsonb. */
  jobMeta?: unknown;
}

interface CoverImage {
  id: string;
  thumbnailUrl: string;
  originalFilename: string;
  /** Subject anchor (0–100) — face-derived or manual; the focal picker's auto pin. */
  focalX?: number | null;
  focalY?: number | null;
}

interface EventSidebarProps {
  eventId: string;
  /**
   * What Smart Stacks resolves to RIGHT NOW — the stored setting if the
   * photographer chose one, otherwise what the filenames detect. The toggle has
   * to show the effective state: rendering `undefined` as OFF while the gallery
   * stacks is exactly the lying control we just removed elsewhere.
   */
  stacksResolved?: boolean;
  /** True while stacks come from the filenames rather than an explicit choice. */
  stacksAreAuto?: boolean;
  /** People with multiple shots detected in the filenames. */
  stacksDetectedPeople?: number;
  eventName: string;
  eventType?: string | null;
  eventDate?: string | null;
  eventDescription?: string | null;
  eventCreatedAt?: string;
  totalImageCount?: number;
  sections: SectionItem[];
  onSectionsChange: (sections: SectionItem[]) => void;
  activeSection: string | null;
  onSetActiveSection: (id: string | null) => void;
  settings: EventSettings;
  onSettingsChange: (settings: EventSettings) => void;
  /** Images available for cover image selection */
  images?: CoverImage[];
  /** Callback to refresh image URLs (presigned URLs expire after 4hr) */
  onRefreshImages?: () => void;
  /** Callback when event metadata (type, date) changes */
  onEventUpdate?: (updates: { event_type?: string; event_date?: string }) => void;
  /** Notify parent when sidebar opens/closes (for toolbar centering) */
  onOpenChange?: (isOpen: boolean) => void;
  /** Notify parent when active panel changes (for live preview) */
  onActivePanelChange?: (panel: Panel | null) => void;
  /** Live per-section upload progress from the engine (same heartbeat as the
   *  dropzone bar); keyed by sectionId. */
  uploadProgressBySection?: Map<
    string,
    { total: number; completed: number; failed: number; inFlight: number }
  >;
  /** Opens the upload dock so failed files can be reviewed/retried. */
  onShowUploadIssues?: () => void;
  /** Callback when images are dropped onto a section row */
  onDropImagesToSection?: (sectionId: string, imageIds: string[]) => void;
  /** TDP Work gallery: sections are jobs ("New job…", live/draft dots). */
  isWorkGallery?: boolean;
  /** Fired after a section is created (the work gallery opens the job form). */
  onSectionCreated?: (section: SectionItem) => void;
  /**
   * Why Smart section can't run yet, or null when it can.
   *
   * Rendered as a DISABLED item with this reason attached, never hidden. A
   * control that disappears teaches nothing and leaves people hunting for it;
   * a greyed one with a wait explains itself and points at the option that does
   * work right now. Justin clicked Smart section on a freshly-uploaded gallery,
   * hit the AI requirement, and concluded he was blocked — when four of the five
   * sorting modes needed no AI at all.
   */
  smartSectionWait?: string | null;
  /** Opens the "Sort into sections" modal — owned by the page, so the same
   *  instance serves this button and the post-upload nudge. */
  onRequestSort?: () => void;
  /** Opens the additive "Smart section" modal (page-owned, like sort). */
  onRequestSmartSection?: () => void;
}

export type Panel = "sections" | "design" | "details" | "activity";

const STORAGE_KEY = "pixeltrunk-sidebar-open";

/**
 * Live/draft dot for TDP Work job sections: a job appears on the site only
 * when its required metadata is complete AND it has photos. Non-job sections
 * get no dot.
 */
function jobStatusFor(
  section: SectionItem
): { live: boolean; title: string } | undefined {
  if (!isJobSceneKey(section.siteSceneKey)) return undefined;
  const missing = jobMissingFields(parseJobMeta(section.jobMeta));
  if (missing.length > 0) {
    return { live: false, title: `Not live — missing ${missing.join(", ")}` };
  }
  if (section.imageCount === 0) {
    return { live: false, title: "Not live — no photos yet" };
  }
  return { live: true, title: "Live on the site" };
}

/**
 * EventSidebar — Collapsible left sidebar for event management.
 * Accordion panels: Sections, Design, Event Details, Activity.
 * Toggle with `[` keyboard shortcut or hamburger button.
 */
export function EventSidebar({
  eventId,
  stacksResolved,
  stacksAreAuto,
  stacksDetectedPeople,
  eventName,
  eventType,
  eventDate,
  eventDescription,
  eventCreatedAt,
  totalImageCount,
  sections,
  onSectionsChange,
  activeSection,
  onSetActiveSection,
  settings,
  onSettingsChange,
  images,
  onRefreshImages,
  onEventUpdate,
  onOpenChange,
  onActivePanelChange,
  uploadProgressBySection,
  onShowUploadIssues,
  onDropImagesToSection,
  isWorkGallery = false,
  onSectionCreated,
  onRequestSort,
  onRequestSmartSection,
  smartSectionWait,
}: EventSidebarProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== "false";
  });
  const [activePanel, setActivePanel] = useState<Panel | null>("sections");

  // Persist open state + notify parent
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isOpen));
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // `[` keyboard shortcut to toggle sidebar
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.key === "[") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const togglePanel = (panel: Panel) => {
    const next = activePanel === panel ? null : panel;
    setActivePanel(next);
    onActivePanelChange?.(next);
  };

  if (!isOpen) {
    return (
      <div className="shrink-0 border-r border-stone-200 flex flex-col items-center py-4 px-2 gap-2">
        <button
          onClick={() => setIsOpen(true)}
          className="p-2 text-stone-400 hover:text-stone-700 transition-colors"
          title="Open sidebar ([)"
        >
          <PanelLeft size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[320px] shrink-0 border-r border-stone-200 bg-white flex flex-col overflow-hidden h-screen sticky top-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-stone-400">
          Event
        </span>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1.5 text-stone-400 hover:text-stone-700 transition-colors"
          title="Close sidebar ([)"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Panel tabs */}
      <div className="flex border-b border-stone-100">
        <PanelTab
          icon={<FolderOpen size={14} />}
          label="Sections"
          active={activePanel === "sections"}
          onClick={() => togglePanel("sections")}
        />
        <PanelTab
          icon={<Palette size={14} />}
          label="Design"
          active={activePanel === "design"}
          onClick={() => togglePanel("design")}
        />
        <PanelTab
          icon={<Settings size={14} />}
          label="Details"
          active={activePanel === "details"}
          onClick={() => togglePanel("details")}
        />
        <PanelTab
          icon={<Activity size={14} />}
          label="Activity"
          active={activePanel === "activity"}
          onClick={() => togglePanel("activity")}
        />
      </div>

      {/* Panel content — sections panel manages its own scroll, others need overflow-y-auto */}
      <div className={`flex-1 ${activePanel === "sections" ? "overflow-hidden" : "overflow-y-auto"}`}>
        {activePanel === "sections" && (
          <SectionsPanel
            eventId={eventId}
            sections={sections}
            uploadProgressBySection={uploadProgressBySection}
            onShowUploadIssues={onShowUploadIssues}
            onSectionsChange={onSectionsChange}
            activeSection={activeSection}
            onSetActiveSection={onSetActiveSection}
            onDropImagesToSection={onDropImagesToSection}
            isWorkGallery={isWorkGallery}
            onSectionCreated={onSectionCreated}
            onRequestSort={onRequestSort}
            onRequestSmartSection={onRequestSmartSection}
            smartSectionWait={smartSectionWait}
          />
        )}
        {activePanel === "design" && (
          <DesignPanel
            eventId={eventId}
            settings={settings}
            onSettingsChange={onSettingsChange}
            images={images}
            sections={sections}
            onRefreshImages={onRefreshImages}
            stacksResolved={stacksResolved}
            stacksAreAuto={stacksAreAuto}
            stacksDetectedPeople={stacksDetectedPeople}
          />
        )}
        {activePanel === "details" && (
          <DetailsPanel
            eventId={eventId}
            eventName={eventName}
            eventType={eventType}
            eventDate={eventDate}
            eventDescription={eventDescription}
            eventCreatedAt={eventCreatedAt}
            totalImageCount={totalImageCount}
            settings={settings}
            onEventUpdate={onEventUpdate}
            onSettingsChange={onSettingsChange}
          />
        )}
        {activePanel === "activity" && (
          <ActivityPanel eventId={eventId} />
        )}
      </div>
    </div>
  );
}

/* ─── Panel Tab ─── */
function PanelTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[9px] uppercase tracking-[0.15em] font-medium transition-all duration-300 border-b-2",
        active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-400 hover:text-stone-600"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ─── Sections Panel ─── */
function SectionsPanel({
  eventId,
  sections,
  uploadProgressBySection,
  onShowUploadIssues,
  onSectionsChange,
  activeSection,
  onSetActiveSection,
  onDropImagesToSection,
  isWorkGallery = false,
  onSectionCreated,
  onRequestSort,
  onRequestSmartSection,
  smartSectionWait,
}: {
  eventId: string;
  smartSectionWait?: string | null;
  sections: SectionItem[];
  uploadProgressBySection?: Map<
    string,
    { total: number; completed: number; failed: number; inFlight: number }
  >;
  onShowUploadIssues?: () => void;
  onSectionsChange: (s: SectionItem[]) => void;
  activeSection: string | null;
  onSetActiveSection: (id: string | null) => void;
  onDropImagesToSection?: (sectionId: string, imageIds: string[]) => void;
  isWorkGallery?: boolean;
  onSectionCreated?: (section: SectionItem) => void;
  onRequestSort?: () => void;
  onRequestSmartSection?: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // ─── Section search + filters (long lists, e.g. the website gallery) ───
  const [sectionQuery, setSectionQuery] = useState("");
  const [lockFilter, setLockFilter] = useState<"all" | "locked" | "unlocked">("all");
  const [emptyOnly, setEmptyOnly] = useState(false);
  const filtersActive =
    sectionQuery.trim() !== "" || lockFilter !== "all" || emptyOnly;
  // Keep original indices: drag-reorder positions refer to the FULL list, so
  // reordering is disabled while a filter hides rows (indices would lie).
  const visibleSections = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => {
      const q = sectionQuery.trim().toLowerCase();
      if (q && !section.name.toLowerCase().includes(q)) return false;
      if (lockFilter === "locked" && !section.locked) return false;
      if (lockFilter === "unlocked" && section.locked) return false;
      if (emptyOnly && section.imageCount > 0) return false;
      return true;
    });

  // New uploads land in the selected section, or — when "All Images" is the
  // view — the "Unsorted" intake (never Highlights). Surfaced as a "Target"
  // badge; null shows the "→ Unsorted" hint (the intake is created on upload).
  const uploadTargetId = activeSection ?? findIntakeSectionId(sections) ?? null;

  /**
   * Has this gallery actually been organised, or is it still one pile?
   *
   * "Organised" means a section that isn't the intake and isn't the empty
   * Highlights placeholder every event ships with — i.e. somewhere the
   * photographer's photos actually live. Decides whether the sort action calls
   * itself "Rebuild" (something exists to rebuild) or "Sort into sections"
   * (nothing does yet).
   */
  const hasOrganisedSections = sections.some(
    (s) =>
      s.imageCount > 0 &&
      s.name.trim().toLowerCase() !== INTAKE_SECTION_NAME.toLowerCase() &&
      s.name.trim().toLowerCase() !== CURATED_SECTION_NAME.toLowerCase()
  );

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setIsCreating(true);
    try {
      const res = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to create section");
      const data = await res.json();
      const created: SectionItem = {
        id: data.section.id,
        name: data.section.name,
        isAuto: data.section.isAuto,
        imageCount: 0,
        siteSceneKey: data.section.siteSceneKey ?? null,
        jobMeta: data.section.jobMeta ?? null,
      };
      onSectionsChange([...sections, created]);
      // Auto-select the freshly created section so uploads target it immediately.
      onSetActiveSection(created.id);
      setNewName("");
      toast.success(isWorkGallery ? "Job created" : "Section created");
      // The work gallery opens the job form right away — one flow, no hunting.
      onSectionCreated?.(created);
    } catch {
      toast.error(isWorkGallery ? "Failed to create job" : "Failed to create section");
    } finally {
      setIsCreating(false);
    }
  }, [eventId, newName, sections, onSectionsChange, onSetActiveSection, isWorkGallery, onSectionCreated]);

  const handleRename = useCallback(
    async (sectionId: string, name: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error();
        onSectionsChange(sections.map((s) => (s.id === sectionId ? { ...s, name } : s)));
      } catch {
        toast.error("Failed to rename section");
      }
    },
    [sections, onSectionsChange]
  );

  const handleToggleLock = useCallback(
    async (sectionId: string, locked: boolean) => {
      // Optimistic flip; the server is the real guard.
      const prev = sections;
      onSectionsChange(sections.map((s) => (s.id === sectionId ? { ...s, locked } : s)));
      try {
        const res = await fetch(`/api/sections/${sectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked }),
        });
        if (!res.ok) throw new Error();
      } catch {
        onSectionsChange(prev);
        toast.error("Failed to update section lock");
      }
    },
    [sections, onSectionsChange]
  );

  const handleDelete = useCallback(
    async (sectionId: string) => {
      // Guard: can't delete the last section
      if (sections.length <= 1) {
        toast.error("Can't delete the last section");
        return;
      }

      // Optimistic: remove immediately
      const prev = sections;
      onSectionsChange(sections.filter((s) => s.id !== sectionId));
      if (activeSection === sectionId) onSetActiveSection(null);

      try {
        const res = await fetch(`/api/sections/${sectionId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to delete section");
        }
        toast.success("Section deleted");
      } catch (err) {
        // Rollback on failure
        onSectionsChange(prev);
        toast.error(err instanceof Error ? err.message : "Failed to delete section");
      }
    },
    [sections, onSectionsChange, activeSection, onSetActiveSection]
  );

  const handleDragOver = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex) return;
      const reordered = [...sections];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(targetIndex, 0, moved);
      onSectionsChange(reordered);
      setDragIndex(targetIndex);
    },
    [dragIndex, sections, onSectionsChange]
  );

  const handleDragEnd = useCallback(async () => {
    setDragIndex(null);
    try {
      await fetch("/api/sections/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, sectionIds: sections.map((s) => s.id) }),
      });
    } catch {
      toast.error("Failed to reorder");
    }
  }, [eventId, sections]);

  return (
    <div className="flex flex-col h-full">
      {/* "All" tab + section list + new-section input. NOT flex-1: a short
          list keeps its natural height so the tools footer sits directly
          beneath it; a long list shrinks (min-h-0) and scrolls, which lands
          the footer at the bottom of the column. */}
      <div className="min-h-0 overflow-y-auto">
        <button
          onClick={() => onSetActiveSection(null)}
          className={cn(
            "w-full text-left px-4 py-3 text-[13px] font-medium transition-colors border-b border-stone-50",
            !activeSection
              ? "bg-stone-50 text-stone-900"
              : "text-stone-500 hover:bg-stone-50"
          )}
        >
          All Images
          {/* All Images is a view, not a target — tell the user where uploads go */}
          {!activeSection && uploadTargetId && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-normal text-stone-400">
              <Upload size={9} />
              New uploads → {sections.find((s) => s.id === uploadTargetId)?.name}
            </span>
          )}
        </button>

        {/* ─── Section search + filters (shown once the list is long) ─── */}
        {sections.length > 5 && (
          <div className="border-b border-stone-50 px-4 py-2">
            <div className="flex items-center gap-2">
              <Search size={13} className="shrink-0 text-stone-300" />
              <input
                type="text"
                value={sectionQuery}
                onChange={(e) => setSectionQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSectionQuery("");
                }}
                placeholder="Find a section…"
                className="w-full bg-transparent py-0.5 text-[12px] text-stone-900 outline-none placeholder:text-stone-300"
              />
              {sectionQuery && (
                <button
                  onClick={() => setSectionQuery("")}
                  className="shrink-0 text-stone-300 hover:text-stone-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              {(
                [
                  ["locked", "Locked"],
                  ["unlocked", "Unlocked"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() =>
                    setLockFilter((cur) => (cur === value ? "all" : value))
                  }
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors",
                    lockFilter === value
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 text-stone-400 hover:border-stone-300 hover:text-stone-600"
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setEmptyOnly((v) => !v)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors",
                  emptyOnly
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 text-stone-400 hover:border-stone-300 hover:text-stone-600"
                )}
              >
                Empty
              </button>
              {filtersActive && (
                <span className="ml-auto text-[10px] tabular-nums text-stone-300">
                  {visibleSections.length}/{sections.length}
                </span>
              )}
            </div>
          </div>
        )}

        {sections.length === 0 ? (
          /* ─── Empty state ─── */
          <div className="px-5 py-10 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
              <FolderOpen size={18} className="text-stone-400" />
            </div>
            <p className="text-[13px] font-medium text-stone-700 mb-1">
              Organize with sections
            </p>
            <p className="text-[11px] text-stone-400 leading-relaxed mb-5">
              Group images into sections like &quot;Ceremony&quot;, &quot;Portraits&quot;, or &quot;Reception&quot;.
              Create them manually below.
            </p>
            {/* AI_HIDDEN: "Generate from AI tags" button disabled — AI backend not configured */}
          </div>
        ) : visibleSections.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-stone-400">
            No sections match
          </p>
        ) : (
          visibleSections.map(({ section, index }) => (
            <div
              key={section.id}
              onClick={() => onSetActiveSection(section.id)}
              className={cn(
                "cursor-pointer transition-colors",
                activeSection === section.id && "bg-accent/5"
              )}
            >
              <SectionRow
                id={section.id}
                name={section.name}
                isAuto={section.isAuto}
                imageCount={section.imageCount}
                uploadProgress={uploadProgressBySection?.get(section.id)}
                onShowUploadIssues={onShowUploadIssues}
                onRename={handleRename}
                onDelete={handleDelete}
                isDragging={dragIndex === index}
                // Reorder positions refer to the full list — disabled while a
                // search/filter hides rows, or drops would land in the wrong
                // place relative to hidden neighbors.
                onDragStart={filtersActive ? undefined : () => setDragIndex(index)}
                onDragEnd={filtersActive ? undefined : handleDragEnd}
                onDragOver={filtersActive ? undefined : () => handleDragOver(index)}
                onDropImages={onDropImagesToSection}
                isUploadTarget={section.id === uploadTargetId}
                canDelete={sections.length > 1}
                locked={section.locked ?? false}
                onToggleLock={handleToggleLock}
                jobStatus={jobStatusFor(section)}
                sceneHint={
                  // Website scene sections: where on the site this is used.
                  // Jobs have their own status line; client sections none.
                  section.siteSceneKey && !isJobSceneKey(section.siteSceneKey)
                    ? sceneForKey(section.siteSceneKey)?.description
                    : undefined
                }
              />
            </div>
          ))
        )}

        {/* Create new section — directly below the list, type-and-go. */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-stone-50">
          <Plus size={14} className="text-stone-400 shrink-0" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setNewName("");
            }}
            placeholder={isWorkGallery ? "New job..." : "New section..."}
            className="flex-1 text-[12px] text-stone-700 placeholder:text-stone-300 bg-transparent outline-none py-0.5 transition-colors"
          />
          {newName.trim() && (
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isCreating ? "..." : "Add"}
            </button>
          )}
        </div>
      </div>

      {/* ─── Tools footer ───
          Sits under the list normally; sticks to the bottom of the column once
          the list outgrows the screen (mt-auto in the flex column). Additive
          "Smart section" first — the destructive rebuild reads as the heavier
          option it is. */}
      {!isWorkGallery && (onRequestSmartSection || onRequestSort) && (
        <div className="shrink-0 border-t border-stone-100 bg-white">
          {onRequestSmartSection && (
            <button
              onClick={onRequestSmartSection}
              disabled={!!smartSectionWait}
              title={smartSectionWait ?? undefined}
              className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors ${
                smartSectionWait
                  ? "cursor-default opacity-60"
                  : "hover:bg-emerald-50/50"
              }`}
            >
              <Sparkles
                size={14}
                className={`mt-0.5 shrink-0 ${smartSectionWait ? "text-stone-300" : "text-emerald-500"}`}
              />
              <span>
                <span
                  className={`block text-[12px] font-medium ${smartSectionWait ? "text-stone-500" : "text-emerald-700"}`}
                >
                  Smart section…
                </span>
                <span className="block text-[10px] leading-tight text-stone-400">
                  {smartSectionWait ?? "Describe it — we'll find the photos"}
                </span>
              </span>
            </button>
          )}
          {sections.some((s) => s.imageCount > 0) && onRequestSort && (
            <button
              onClick={onRequestSort}
              className="flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-stone-50"
            >
              <FolderTree size={14} className="mt-0.5 shrink-0 text-stone-400" />
              <span>
                {/* "Rebuild" is right only when there is something to rebuild.
                    On a gallery whose photos are still one big Unsorted pile it
                    reads as a repair action, so the one control that organises a
                    fresh dump doesn't look like the thing you want — Justin went
                    hunting for it and landed on Smart section instead
                    (2026-08-11). Same button, honest name for the state. */}
                <span className="block text-[12px] font-medium text-stone-700">
                  {hasOrganisedSections
                    ? "Rebuild all sections…"
                    : "Sort into sections…"}
                </span>
                <span className="block text-[10px] leading-tight text-stone-400">
                  {hasOrganisedSections
                    ? "Re-sorts the whole gallery · keeps your own sections"
                    : "Group these photos by person, name or size"}
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Design Panel ─── */
function DesignPanel({
  eventId,
  settings,
  onSettingsChange,
  images,
  sections,
  onRefreshImages,
  stacksResolved,
  stacksAreAuto,
  stacksDetectedPeople,
}: {
  eventId: string;
  settings: EventSettings;
  onSettingsChange: (s: EventSettings) => void;
  images?: CoverImage[];
  sections?: SectionItem[];
  onRefreshImages?: () => void;
  stacksResolved?: boolean;
  /** True while stacks come from the filenames rather than an explicit choice. */
  stacksAreAuto?: boolean;
  /** People with multiple shots detected in the filenames. */
  stacksDetectedPeople?: number;
}) {
  const [designTab, setDesignTab] = useState<"cover" | "typography" | "color" | "grid">("cover");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh image URLs every time cover tab opens (presigned URLs expire after 4hr)
  useEffect(() => {
    if (designTab === "cover" && onRefreshImages) {
      onRefreshImages();
    }
  }, [designTab, onRefreshImages]);

  const handleChange = useCallback(
    (partial: Partial<EventSettings>) => {
      const updated = { ...settings, ...partial };
      onSettingsChange(updated);

      // Debounced save
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(`/api/events/${eventId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: updated }),
          });
        } catch {
          toast.error("Failed to save settings");
        }
      }, 600);
    },
    [eventId, settings, onSettingsChange]
  );

  return (
    <div>
      {/* Design sub-tabs */}
      <div className="flex border-b border-stone-100 px-2">
        {(["cover", "typography", "color", "grid"] as const).map((tab) => {
          const label = tab === "typography" ? "fonts" : tab;
          return (
            <button
              key={tab}
              onClick={() => setDesignTab(tab)}
              className={cn(
                "flex-1 py-2 text-[10px] uppercase tracking-[0.12em] font-medium transition-colors border-b-2",
                designTab === tab
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-600"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {designTab === "cover" && (() => {
          // Normalize once: the tab always sees a complete cover object, and
          // saves persist the full normalized shape (legacy rows get typed).
          const cover = normalizeCoverSettings(settings.cover);
          const coverImage = images?.find((img) => img.id === cover.imageId);
          return (
            <CoverLayoutTab
              cover={cover}
              onChange={(partial) => handleChange({ cover: { ...cover, ...partial } })}
              coverImageUrl={coverImage?.thumbnailUrl}
              autoFocal={
                coverImage?.focalX != null && coverImage?.focalY != null
                  ? { x: coverImage.focalX / 100, y: coverImage.focalY / 100 }
                  : undefined
              }
              sections={sections}
              eventId={eventId}
              onUploadComplete={onRefreshImages}
            />
          );
        })()}
        {designTab === "typography" && (
          <TypographyTab
            headingFont={settings.typography?.headingFont || "playfair"}
            bodyFont={settings.typography?.bodyFont || "inter"}
            onChangeHeading={(headingFont) =>
              handleChange({ typography: { ...settings.typography, headingFont } })
            }
            onChangeBody={(bodyFont) =>
              handleChange({ typography: { ...settings.typography, bodyFont } })
            }
          />
        )}
        {designTab === "color" && (
          <ColorTab
            colors={settings.color || { primary: "#1C1917", secondary: "#78716C", accent: "#10B981", background: "#FFFFFF" }}
            onChange={(colors) => handleChange({ color: colors })}
          />
        )}
        {designTab === "grid" && (
          <GridTab
            columns={settings.grid?.columns || 5}
            gap={settings.grid?.gap || "normal"}
            style={settings.grid?.style || "masonry"}
            showFilenames={settings.grid?.showFilenames}
            smartStacks={settings.grid?.smartStacks ?? stacksResolved}
            stacksAreAuto={stacksAreAuto}
            stacksDetectedPeople={stacksDetectedPeople}
            onChange={(updates) =>
              handleChange({ grid: { ...settings.grid, ...updates } })
            }
          />
        )}
      </div>
    </div>
  );
}

/* ─── Details Panel ─── */
const EVENT_TYPES = [
  "Wedding",
  "Portrait",
  "Corporate",
  "Birthday",
  "Engagement",
  "Maternity",
  "Newborn",
  "Family",
  "Event",
  "Editorial",
  "Product",
  "Real Estate",
  "Other",
];

function DetailsPanel({
  eventId,
  eventName,
  eventType,
  eventDate,
  eventDescription,
  eventCreatedAt,
  totalImageCount,
  settings,
  onEventUpdate,
  onSettingsChange,
}: {
  eventId: string;
  eventName: string;
  eventType?: string | null;
  eventDate?: string | null;
  eventDescription?: string | null;
  eventCreatedAt?: string;
  totalImageCount?: number;
  settings?: EventSettings;
  onEventUpdate?: (updates: { event_type?: string; event_date?: string }) => void;
  onSettingsChange?: (settings: EventSettings) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(eventName);
  const [type, setType] = useState(eventType || "");
  const [date, setDate] = useState(eventDate || "");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Sharing settings with defaults
  const sharing: SharingSettings = settings?.sharing
    ? { ...DEFAULT_SHARING_SETTINGS, ...settings.sharing }
    : DEFAULT_SHARING_SETTINGS;

  const generatePin = () => String(Math.floor(1000 + Math.random() * 9000));

  /* ─── Gallery password ─── */
  // Held locally and committed on blur/Enter, NOT per keystroke: every save
  // re-hashes into every live share, and a half-typed password briefly
  // becoming the real one is its own kind of lockout.
  const [password, setPassword] = useState(sharing.password);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const savedPasswordRef = useRef(sharing.password);

  // Adopt the server's value when the event (or its settings) loads/changes,
  // but never yank the field out from under someone mid-type.
  useEffect(() => {
    if (sharing.password !== savedPasswordRef.current) {
      savedPasswordRef.current = sharing.password;
      setPassword(sharing.password);
    }
  }, [sharing.password]);

  // `override` lets Generate commit straight away instead of waiting for a
  // blur — the freshly generated value would still be stale in this closure.
  const savePassword = useCallback(async (override?: string) => {
    const next = (override ?? password).trim();
    if (next === savedPasswordRef.current) return;
    setPasswordSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/gallery-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: next }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as {
        isProtected: boolean;
        sharesUpdated: number;
      };

      savedPasswordRef.current = next;
      setPassword(next);
      // Keep the in-memory settings honest — the sidebar's other toggles
      // PATCH the whole blob, and a stale password here would undo this save.
      if (settings && onSettingsChange) {
        onSettingsChange({ ...settings, sharing: { ...sharing, password: next } });
      }

      // Say what actually happened to the links already in clients' inboxes.
      const links =
        data.sharesUpdated === 1 ? "1 live link" : `${data.sharesUpdated} live links`;
      toast.success(
        data.isProtected ? "Gallery password set" : "Gallery password removed",
        {
          description: data.sharesUpdated
            ? `Applied to ${links}`
            : "No live share links yet — new links will use it",
        }
      );
    } catch {
      setPassword(savedPasswordRef.current);
      toast.error("Failed to save the gallery password");
    } finally {
      setPasswordSaving(false);
    }
  }, [eventId, password, settings, sharing, onSettingsChange]);

  /** Two short words + digits — readable over the phone, still not guessable. */
  const generatePassword = () => {
    const words = [
      "amber", "harbor", "willow", "cobalt", "meadow", "canyon", "ivory",
      "cedar", "quartz", "lantern", "marble", "orchard", "saffron", "thistle",
    ];
    const pick = () => words[Math.floor(Math.random() * words.length)];
    const digits = String(Math.floor(10 + Math.random() * 90));
    const next = `${pick()}-${pick()}-${digits}`;
    setPassword(next);
    setShowPassword(true);
    void savePassword(next);
  };

  // The PIN field is local while it is being typed, then committed — same shape
  // as the password above. It matters more here: every save writes through to
  // each active share, so a fetch per keystroke would rewrite every live link
  // four times to set one PIN.
  const [pin, setPin] = useState(sharing.downloadPin);
  const savedPinRef = useRef(sharing.downloadPin);

  useEffect(() => {
    if (sharing.downloadPin !== savedPinRef.current) {
      savedPinRef.current = sharing.downloadPin;
      setPin(sharing.downloadPin);
    }
  }, [sharing.downloadPin]);

  /**
   * The ONE way this sidebar changes a PIN. Goes to the dedicated route so the
   * event and every active share move together — `updateSharing` would PATCH
   * the event alone, which is the split that left a delivered gallery ungated.
   *
   * Adopts the SERVER's resolved values rather than the requested ones: the
   * route re-applies normalizeDownloadPins (bulk off ⇒ individual off; no PIN ⇒
   * no gates), so the client must render what was actually stored.
   */
  const savePin = useCallback(
    async (partial: {
      downloadPin?: string;
      requirePinBulk?: boolean;
      requirePinIndividual?: boolean;
    }) => {
      try {
        const res = await fetch(`/api/events/${eventId}/download-pin`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        if (!res.ok) throw new Error("save failed");
        const data = (await res.json()) as {
          downloadPin: string;
          requirePinBulk: boolean;
          requirePinIndividual: boolean;
          sharesUpdated: number;
        };

        savedPinRef.current = data.downloadPin;
        setPin(data.downloadPin);
        if (settings && onSettingsChange) {
          // Keep the in-memory blob honest — the sidebar's other toggles PATCH
          // the whole thing, and a stale PIN here would undo this save.
          onSettingsChange({
            ...settings,
            sharing: {
              ...sharing,
              downloadPin: data.downloadPin,
              requirePinBulk: data.requirePinBulk,
              requirePinIndividual: data.requirePinIndividual,
            },
          });
        }

        // Say what actually happened to the links already in clients' inboxes.
        const links =
          data.sharesUpdated === 1 ? "1 live link" : `${data.sharesUpdated} live links`;
        toast.success(data.requirePinBulk ? "Download PIN set" : "Download PIN removed", {
          description: data.sharesUpdated
            ? `Applied to ${links}`
            : "No live share links yet — new links will use it",
        });
      } catch {
        setPin(savedPinRef.current);
        toast.error("Failed to save the download PIN");
      }
    },
    [eventId, settings, sharing, onSettingsChange]
  );

  const updateSharing = useCallback(
    (partial: Partial<SharingSettings>) => {
      if (!settings || !onSettingsChange) return;
      const updated = { ...settings, sharing: { ...sharing, ...partial } };
      onSettingsChange(updated);
      // Debounced save
      fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: updated }),
      }).catch(() => toast.error("Failed to save"));
    },
    [eventId, settings, sharing, onSettingsChange]
  );

  // Sync with props
  useEffect(() => {
    setName(eventName);
  }, [eventName]);
  useEffect(() => {
    setType(eventType || "");
  }, [eventType]);
  useEffect(() => {
    setDate(eventDate || "");
  }, [eventDate]);
  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const handleSaveName = useCallback(async () => {
    if (name.trim() === eventName) return;
    setIsSaving(true);
    try {
      await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.success("Event renamed");
    } catch {
      toast.error("Failed to rename event");
    } finally {
      setIsSaving(false);
    }
  }, [eventId, name, eventName]);

  const handleSaveField = useCallback(async (field: "eventType" | "eventDate", value: string) => {
    try {
      await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value || null }),
      });
      const stateKey = field === "eventType" ? "event_type" : "event_date";
      onEventUpdate?.({ [stateKey]: value || undefined });
    } catch {
      toast.error("Failed to update");
    }
  }, [eventId, onEventUpdate]);


  const handleDuplicate = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success("Event duplicated");
      router.push(`/events/${data.event.id}`);
    } catch {
      toast.error("Failed to duplicate event");
    }
  }, [eventId, router]);

  const handleDelete = useCallback(async () => {
    try {
      await fetch(`/api/events/${eventId}`, { method: "DELETE" });
      toast.success("Event deleted");
      router.push("/");
    } catch {
      toast.error("Failed to delete event");
    }
  }, [eventId, router]);

  return (
    <div className="p-4 space-y-6">
      {/* Event name */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-1.5 block">
          Event name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSaveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveName();
          }}
          className="w-full text-[14px] text-stone-900 border border-stone-200 px-3 py-2 focus:border-stone-900 outline-none transition-colors"
        />
      </div>

      {/* Event type & date */}
      <div className="space-y-3">
        <div>
          <label className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-1.5 block">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              handleSaveField("eventType", e.target.value);
            }}
            className="w-full text-[13px] text-stone-700 border border-stone-200 px-3 py-2 focus:border-stone-900 outline-none transition-colors bg-white appearance-none cursor-pointer"
          >
            <option value="">Not set</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-1.5 block">
            Date
          </label>
          <DatePicker
            value={date}
            onChange={(val) => {
              setDate(val);
              handleSaveField("eventDate", val);
            }}
          />
        </div>
      </div>

      <div className="h-px bg-stone-100" />

      {/* Read-only info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <ImageIcon size={14} className="text-stone-300 shrink-0" />
          <div>
            <span className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium block">
              Total images
            </span>
            <span className="text-[13px] text-stone-700">
              {totalImageCount !== undefined ? totalImageCount.toLocaleString() : "--"}
            </span>
          </div>
        </div>
        {eventCreatedAt && (
          <div className="flex items-center gap-2.5">
            <CalendarDays size={14} className="text-stone-300 shrink-0" />
            <div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium block">
                Created
              </span>
              <span className="text-[13px] text-stone-700">
                {formatDate(eventCreatedAt)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-stone-100" />

      {/* ─── Gallery password ─── */}
      {/* Guests hit this before they see a single photo. It's event-level and
          writes through to every live link, so the state shown here is the
          state of the links already sitting in clients' inboxes. */}
      {onSettingsChange && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lock size={13} className="text-stone-400" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
              Gallery Password
            </span>
            {savedPasswordRef.current && (
              <span className="ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                On
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => void savePassword()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") {
                    setPassword(savedPasswordRef.current);
                    e.currentTarget.blur();
                  }
                }}
                placeholder="No password — anyone with the link"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                className="w-full border border-stone-200 bg-transparent px-2.5 py-1.5 text-[12px] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 outline-none transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-40"
              disabled={!password}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(savedPasswordRef.current);
                setPasswordCopied(true);
                setTimeout(() => setPasswordCopied(false), 2000);
              }}
              className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-40"
              disabled={!savedPasswordRef.current}
              title="Copy password"
            >
              {passwordCopied ? (
                <Check size={14} className="text-emerald-600" />
              ) : (
                <Copy size={14} />
              )}
            </button>
            <button
              type="button"
              onClick={generatePassword}
              className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors"
              title="Generate a password"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-stone-400">
            {passwordSaving
              ? "Saving…"
              : savedPasswordRef.current
                ? "Guests enter this before they can see any photos. Applies to every live link for this event."
                : "Leave empty and anyone with the link can view the gallery."}
          </p>
        </div>
      )}

      <div className="h-px bg-stone-100" />

      {/* Downloads & Protection */}
      {onSettingsChange && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Download size={13} className="text-stone-400" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
              Downloads & Protection
            </span>
          </div>

          {/* Allow Downloads */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-stone-600">Allow downloads</span>
            <button
              type="button"
              onClick={() => updateSharing({ allowDownload: !sharing.allowDownload })}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                sharing.allowDownload ? "bg-emerald-500" : "bg-stone-200"
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                sharing.allowDownload ? "translate-x-4" : ""
              }`} />
            </button>
          </div>

          {/* Guest visual search (semantic, share-scoped; default on) */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-stone-600">Guest visual search</span>
            <button
              type="button"
              onClick={() => updateSharing({ guestSearch: sharing.guestSearch === false })}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                sharing.guestSearch !== false ? "bg-emerald-500" : "bg-stone-200"
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                sharing.guestSearch !== false ? "translate-x-4" : ""
              }`} />
            </button>
          </div>

          {/* "All" tab in the guest nav — OPT-IN, off by default (Justin,
              2026-08-10: usually redundant next to real sections). Trails the
              section tabs when on. The editor's All Images view is separate
              and always available. */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-stone-600">
              &ldquo;All&rdquo; tab in gallery
              <span className="block text-[10px] text-stone-400">
                One tab with every photo, after the sections
              </span>
            </span>
            <button
              type="button"
              onClick={() => updateSharing({ showAllPhotos: sharing.showAllPhotos !== true })}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                sharing.showAllPhotos === true ? "bg-emerald-500" : "bg-stone-200"
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                sharing.showAllPhotos === true ? "translate-x-4" : ""
              }`} />
            </button>
          </div>

          {/* Selfie search ("Find my photos") — ON by default. The selfie is
              embedded in memory and never stored, so the toggle writes an
              explicit false to opt OUT; `selfieSearchEnabled` reads it. */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-stone-600">
              Selfie search
              <span className="block text-[10px] text-stone-400">
                Guests find their photos with a selfie
              </span>
            </span>
            <button
              type="button"
              onClick={() =>
                updateSharing({ selfieSearch: !selfieSearchEnabled(sharing) })
              }
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                selfieSearchEnabled(sharing) ? "bg-emerald-500" : "bg-stone-200"
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                selfieSearchEnabled(sharing) ? "translate-x-4" : ""
              }`} />
            </button>
          </div>

          {/* PIN for bulk download. Turning it OFF also clears the per-image
              escalation nested under it — gating single photos while
              "Download All" stays open gates nothing, since the guest just
              takes the ZIP instead. normalizeDownloadPins is the same rule,
              re-applied server-side on every share write. */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-stone-600">PIN for Download All</span>
            <button
              type="button"
              onClick={() => {
                const next = !sharing.requirePinBulk;
                void savePin({
                  requirePinBulk: next,
                  downloadPin: next && !sharing.downloadPin ? generatePin() : sharing.downloadPin,
                  ...(next ? {} : { requirePinIndividual: false }),
                });
              }}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                sharing.requirePinBulk ? "bg-stone-900" : "bg-stone-200"
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                sharing.requirePinBulk ? "translate-x-4" : ""
              }`} />
            </button>
          </div>

          {/* Per-image PIN — an escalation of the above, so it only exists
              while that is on. Indented and rule-led to read as a sub-option. */}
          {sharing.requirePinBulk && (
            <div className="flex items-center justify-between pl-3 border-l border-stone-200">
              <span className="text-[12px] text-stone-600">
                Also for single photos
                <span className="block text-[10px] text-stone-400">
                  Same PIN, asked before each download
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !sharing.requirePinIndividual;
                  void savePin({
                    requirePinIndividual: next,
                    downloadPin: next && !sharing.downloadPin ? generatePin() : sharing.downloadPin,
                  });
                }}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                  sharing.requirePinIndividual ? "bg-stone-900" : "bg-stone-200"
                }`}
              >
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  sharing.requirePinIndividual ? "translate-x-4" : ""
                }`} />
              </button>
            </div>
          )}

          {/* PIN input */}
          {sharing.requirePinBulk && (
            <div className="pt-1">
              <label className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-1.5 block">
                PIN Code
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Lock size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-300" />
                  <input
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setPin(next);
                      // Four digits is the only valid length, so commit as soon
                      // as it is reached rather than waiting for a blur the
                      // photographer may never give it.
                      if (next.length === 4 && next !== savedPinRef.current) {
                        void savePin({ downloadPin: next });
                      }
                    }}
                    onBlur={() => {
                      if (pin !== savedPinRef.current) void savePin({ downloadPin: pin });
                    }}
                    placeholder="4-digit"
                    className="w-full border border-stone-200 bg-transparent pl-8 pr-2 py-1.5 text-[12px] text-stone-900 font-mono tracking-[0.3em] placeholder:text-stone-300 placeholder:tracking-normal placeholder:font-sans focus:border-stone-900 outline-none transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors"
                  title={showPin ? "Hide PIN" : "Show PIN"}
                >
                  {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void savePin({ downloadPin: generatePin() })}
                  className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors"
                  title="Generate new PIN"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="h-px bg-stone-100" />

      {/* Actions */}
      <div className="space-y-2">
        {confirmDuplicate ? (
          <button
            onClick={handleDuplicate}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] text-emerald-600 hover:bg-emerald-50 transition-colors text-left border border-emerald-200"
          >
            <Copy size={14} />
            Click again to confirm duplicate
          </button>
        ) : (
          <button
            onClick={() => setConfirmDuplicate(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors text-left border border-stone-200"
          >
            <Copy size={14} />
            Duplicate event
          </button>
        )}

        {confirmDelete ? (
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] text-red-600 hover:bg-red-50 transition-colors text-left border border-red-200"
          >
            <Trash2 size={14} />
            Click again to confirm delete
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-[13px] text-stone-500 hover:text-red-600 hover:bg-stone-50 transition-colors text-left border border-stone-200"
          >
            <Trash2 size={14} />
            Delete event
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Activity Panel ─── */
function ActivityPanel({ eventId }: { eventId: string }) {
  const [shares, setShares] = useState<Array<{
    id: string;
    slug: string;
    shareType: string;
    viewCount: number;
    lastViewedAt: string | null;
    createdAt: string;
  }>>([]);
  const [clients, setClients] = useState<Array<{
    name: string | null;
    email: string | null;
    favoriteCount: number;
    lastActivity: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sharesRes, favoritesRes] = await Promise.all([
          fetch(`/api/events/${eventId}/shares`),
          fetch(`/api/events/${eventId}/favorites`),
        ]);

        if (!cancelled && sharesRes.ok) {
          const data = await sharesRes.json();
          setShares(data.shares || []);
        }
        if (!cancelled && favoritesRes.ok) {
          const data = await favoritesRes.json();
          setClients(data.clients || []);
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (isLoading) {
    return (
      <div className="py-12 text-center">
        <p className="text-[12px] text-stone-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-stone-50">
      {/* Share links */}
      {shares.length > 0 && (
        <div className="px-4 py-3">
          <h4 className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-2">
            Share Links
          </h4>
          <div className="space-y-2">
            {shares.map((s) => (
              <div key={s.id} className="text-[12px]">
                <span className="font-mono text-stone-500 bg-stone-50 px-1.5 py-0.5">
                  /{s.slug}
                </span>
                <span className="text-stone-400 ml-2">
                  {s.viewCount} views · {lastViewedLabel(s.viewCount, s.lastViewedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Favorites */}
      {clients.length > 0 && (
        <div className="px-4 py-3">
          <h4 className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-2">
            Client Favorites
          </h4>
          <div className="space-y-2">
            {clients.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[12px]">
                <span className="text-stone-700">
                  {c.name || "Anonymous"}
                </span>
                <span className="text-accent font-medium">
                  {c.favoriteCount} ♥
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {shares.length === 0 && clients.length === 0 && (
        <div className="py-12 text-center">
          <Activity size={24} className="text-stone-200 mx-auto mb-2" />
          <p className="text-[12px] text-stone-400">No activity yet</p>
        </div>
      )}
    </div>
  );
}
