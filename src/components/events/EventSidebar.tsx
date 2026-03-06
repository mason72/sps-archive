"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  FolderOpen,
  Palette,
  Settings,
  Activity,
  Plus,
  Copy,
  Trash2,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { SectionRow } from "@/components/sections/SectionRow";
import { CoverLayoutTab } from "@/components/settings/CoverLayoutTab";
import { TypographyTab } from "@/components/settings/TypographyTab";
import { ColorTab } from "@/components/settings/ColorTab";
import { GridTab } from "@/components/settings/GridTab";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";
import type { EventSettings } from "@/types/event-settings";

/* ─── Types ─── */

interface SectionItem {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
}

interface CoverImage {
  id: string;
  thumbnailUrl: string;
  originalFilename: string;
}

interface EventSidebarProps {
  eventId: string;
  eventName: string;
  eventType?: string | null;
  eventDate?: string | null;
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
}

type Panel = "sections" | "design" | "details" | "activity";

const STORAGE_KEY = "pixeltrunk-sidebar-open";

/**
 * EventSidebar — Collapsible left sidebar for event management.
 * Accordion panels: Sections, Design, Event Details, Activity.
 * Toggle with `[` keyboard shortcut or hamburger button.
 */
export function EventSidebar({
  eventId,
  eventName,
  eventType,
  eventDate,
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
    setActivePanel((prev) => (prev === panel ? null : panel));
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
            onSectionsChange={onSectionsChange}
            activeSection={activeSection}
            onSetActiveSection={onSetActiveSection}
          />
        )}
        {activePanel === "design" && (
          <DesignPanel
            eventId={eventId}
            settings={settings}
            onSettingsChange={onSettingsChange}
            images={images}
            onRefreshImages={onRefreshImages}
          />
        )}
        {activePanel === "details" && (
          <DetailsPanel
            eventId={eventId}
            eventName={eventName}
            eventType={eventType}
            eventDate={eventDate}
            onEventUpdate={onEventUpdate}
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
  onSectionsChange,
  activeSection,
  onSetActiveSection,
}: {
  eventId: string;
  sections: SectionItem[];
  onSectionsChange: (s: SectionItem[]) => void;
  activeSection: string | null;
  onSetActiveSection: (id: string | null) => void;
}) {
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

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
      onSectionsChange([
        ...sections,
        { id: data.section.id, name: data.section.name, isAuto: data.section.isAuto, imageCount: 0 },
      ]);
      setNewName("");
      toast.success("Section created");
    } catch {
      toast.error("Failed to create section");
    } finally {
      setIsCreating(false);
    }
  }, [eventId, newName, sections, onSectionsChange]);

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

  const handleDelete = useCallback(
    async (sectionId: string) => {
      try {
        const res = await fetch(`/api/sections/${sectionId}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
        onSectionsChange(sections.filter((s) => s.id !== sectionId));
        if (activeSection === sectionId) onSetActiveSection(null);
        toast.success("Section deleted");
      } catch {
        toast.error("Failed to delete section");
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
      {/* "All" tab + section list */}
      <div className="flex-1 overflow-y-auto">
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
        </button>

        {sections.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <FolderOpen size={24} className="text-stone-200 mx-auto mb-2" />
            <p className="text-[12px] text-stone-400">No sections yet</p>
          </div>
        ) : (
          sections.map((section, index) => (
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
                onRename={handleRename}
                onDelete={handleDelete}
                isDragging={dragIndex === index}
                onDragStart={() => setDragIndex(index)}
                onDragEnd={handleDragEnd}
                onDragOver={() => handleDragOver(index)}
              />
            </div>
          ))
        )}
      </div>

      {/* Create new section */}
      <div className="border-t border-stone-100 bg-stone-50/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Plus size={14} className="text-stone-500 shrink-0" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="New section…"
            className="flex-1 text-[12px] text-stone-900 placeholder:text-stone-300 bg-transparent border-b border-stone-200 focus:border-stone-900 outline-none py-1 transition-colors"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={handleCreate}
            disabled={!newName.trim() || isCreating}
          >
            {isCreating ? "…" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─── Design Panel ─── */
function DesignPanel({
  eventId,
  settings,
  onSettingsChange,
  images,
  onRefreshImages,
}: {
  eventId: string;
  settings: EventSettings;
  onSettingsChange: (s: EventSettings) => void;
  images?: CoverImage[];
  onRefreshImages?: () => void;
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
          const coverSettings = settings.cover as Record<string, unknown> | undefined;
          const coverImageId = coverSettings?.imageId as string | undefined;
          const coverImage = images?.find((img) => img.id === coverImageId);
          return (
            <CoverLayoutTab
              value={settings.cover?.layout || "center"}
              onChange={(layout) =>
                handleChange({ cover: { ...settings.cover, layout } })
              }
              coverImageUrl={coverImage?.thumbnailUrl}
              coverImageId={coverImageId}
              images={images}
              onCoverImageChange={(imageId) =>
                handleChange({ cover: { ...settings.cover, imageId } })
              }
              eventId={eventId}
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
  onEventUpdate,
}: {
  eventId: string;
  eventName: string;
  eventType?: string | null;
  eventDate?: string | null;
  onEventUpdate?: (updates: { event_type?: string; event_date?: string }) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(eventName);
  const [type, setType] = useState(eventType || "");
  const [date, setDate] = useState(eventDate || "");
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

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
      // Map camelCase API fields to snake_case state fields
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

  const relTime = (d: string | null) => {
    if (!d) return "Never";
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

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
                  {s.viewCount} views · {relTime(s.lastViewedAt)}
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
