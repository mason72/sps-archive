"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Image, Type, Palette, Grid3X3, Share2, BookmarkPlus, ExternalLink } from "lucide-react";
import { CoverLayoutTab } from "./CoverLayoutTab";
import { TypographyTab } from "./TypographyTab";
import { ColorTab } from "./ColorTab";
import { GridTab } from "./GridTab";
import { SharingTab } from "./SharingTab";
import type { EventSettings } from "@/types/event-settings";
import { DEFAULT_EVENT_SETTINGS, DEFAULT_SHARING_SETTINGS } from "@/types/event-settings";
import { cn } from "@/lib/utils";

type SettingsTab = "cover" | "typography" | "color" | "grid" | "sharing";

const TABS: { id: SettingsTab; icon: typeof Image; label: string }[] = [
  { id: "cover", icon: Image, label: "Cover" },
  { id: "typography", icon: Type, label: "Typography" },
  { id: "color", icon: Palette, label: "Color" },
  { id: "grid", icon: Grid3X3, label: "Grid" },
  { id: "sharing", icon: Share2, label: "Sharing" },
];

interface EventSettingsPanelProps {
  eventId: string;
  settings: EventSettings;
  onSettingsChange: (settings: EventSettings) => void;
  onClose: () => void;
}

/**
 * EventSettingsPanel — Right slide-in panel for event design settings.
 * Four tabs: Cover layout, Typography, Color, Grid.
 * Auto-saves changes with debounce.
 */
export function EventSettingsPanel({
  eventId,
  settings,
  onSettingsChange,
  onClose,
}: EventSettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("cover");
  const [localSettings, setLocalSettings] = useState<EventSettings>(settings);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync if parent settings change
  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  // Debounced save to API
  const saveSettings = useCallback(
    (updated: EventSettings) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await fetch(`/api/events/${eventId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ settings: updated }),
          });
          toast.success("Settings saved");
        } catch (err) {
          console.error("Failed to save settings:", err);
          toast.error("Failed to save settings");
        }
      }, 500);
    },
    [eventId]
  );

  const updateSettings = useCallback(
    (partial: Partial<EventSettings>) => {
      const updated = { ...localSettings, ...partial };
      setLocalSettings(updated);
      onSettingsChange(updated);
      saveSettings(updated);
    },
    [localSettings, onSettingsChange, saveSettings]
  );

  const handleReset = useCallback(() => {
    setLocalSettings(DEFAULT_EVENT_SETTINGS);
    onSettingsChange(DEFAULT_EVENT_SETTINGS);
    saveSettings(DEFAULT_EVENT_SETTINGS);
  }, [onSettingsChange, saveSettings]);

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const handleSaveAsTemplate = useCallback(async () => {
    const templateName = window.prompt("Template name:");
    if (!templateName?.trim()) return;

    setIsSavingTemplate(true);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          fromEventId: eventId,
        }),
      });
      if (!res.ok) throw new Error("Failed to save template");
      toast.success("Template saved");
    } catch (err) {
      console.error("Save template error:", err);
      toast.error("Failed to save template");
    } finally {
      setIsSavingTemplate(false);
    }
  }, [eventId]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  if (typeof window === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 z-40 lightbox-open"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 w-[420px] max-w-[90vw] bg-white border-l border-stone-200 z-50 panel-slide-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-stone-100">
          <h2 className="label-caps text-stone-900">Design</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview Gallery button */}
        <div className="px-6 py-3 border-b border-stone-100">
          <a
            href={`/gallery/preview/${eventId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 text-[12px] uppercase tracking-[0.15em] font-medium border border-stone-200 text-stone-600 hover:border-stone-400 hover:text-stone-900 transition-all duration-200"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Preview Gallery
          </a>
        </div>

        {/* Tab icons */}
        <div className="flex border-b border-stone-100">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-1.5 py-4 text-[10px] uppercase tracking-[0.15em] font-medium transition-all duration-200",
                activeTab === tab.id
                  ? "text-stone-900 border-b-2 border-accent"
                  : "text-stone-400 hover:text-stone-600"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {activeTab === "cover" && (
            <CoverLayoutTab
              value={localSettings.cover.layout}
              onChange={(layout) =>
                updateSettings({ cover: { layout } })
              }
            />
          )}
          {activeTab === "typography" && (
            <TypographyTab
              headingFont={localSettings.typography.headingFont}
              bodyFont={localSettings.typography.bodyFont}
              onChangeHeading={(headingFont) =>
                updateSettings({
                  typography: { ...localSettings.typography, headingFont },
                })
              }
              onChangeBody={(bodyFont) =>
                updateSettings({
                  typography: { ...localSettings.typography, bodyFont },
                })
              }
            />
          )}
          {activeTab === "color" && (
            <ColorTab
              colors={localSettings.color}
              onChange={(color) => updateSettings({ color })}
            />
          )}
          {activeTab === "grid" && (
            <GridTab
              columns={localSettings.grid.columns}
              gap={localSettings.grid.gap}
              style={localSettings.grid.style}
              onChange={(grid) =>
                updateSettings({ grid: { ...localSettings.grid, ...grid } })
              }
            />
          )}
          {activeTab === "sharing" && (
            <SharingTab
              value={localSettings.sharing ?? DEFAULT_SHARING_SETTINGS}
              onChange={(sharing) => updateSettings({ sharing })}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="text-[12px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Reset to defaults
          </button>
          <button
            onClick={handleSaveAsTemplate}
            disabled={isSavingTemplate}
            className="flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-50"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            {isSavingTemplate ? "Saving..." : "Save as Template"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
