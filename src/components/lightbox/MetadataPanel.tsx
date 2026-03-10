"use client";

import { useState, useRef, useCallback } from "react";
import {
  Eye,
  EyeOff,
  Camera,
  User,
  Mountain,
  Sparkles,
  Users,
  Aperture,
  Info,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import type { ImageData, ImageDetail } from "@/types/image";

interface MetadataPanelProps {
  image: ImageData;
  detail: ImageDetail | null;
  isLoading: boolean;
  isOpen: boolean;
  onNameUpdate?: (imageId: string, newName: string) => void;
}

/** Q1: CSS-only tooltip for AI feature explanations */
function AiTooltip({ text }: { text: string }) {
  return (
    <div className="group/tip relative inline-flex ml-1.5">
      <Info className="h-3 w-3 text-stone-300 hover:text-stone-500 transition-colors cursor-help" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity duration-200 z-20">
        <div className="bg-stone-900 text-white text-[10px] leading-relaxed px-3 py-2 rounded-sm shadow-lg">
          {text}
        </div>
      </div>
    </div>
  );
}

/** Q2: Inline editable name field */
function InlineEditName({
  imageId,
  value,
  onSave,
}: {
  imageId: string;
  value: string;
  onSave?: (imageId: string, newName: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === value) {
      setEditValue(value);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/images/${imageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedName: trimmed }),
      });
      if (res.ok) {
        onSave?.(imageId, trimmed);
      } else {
        setEditValue(value); // revert
      }
    } catch {
      setEditValue(value); // revert
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  }, [editValue, value, imageId, onSave]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setEditValue(value);
            setIsEditing(false);
          }
        }}
        autoFocus
        disabled={isSaving}
        className="font-serif text-[18px] font-bold tracking-[-0.03em] text-stone-900 leading-tight bg-transparent border-b border-stone-300 focus:border-stone-900 outline-none w-full transition-colors duration-200"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setIsEditing(true);
        setEditValue(value);
      }}
      className="group/edit flex items-center gap-1.5 text-left w-full"
      title="Click to rename"
    >
      <span className="font-serif text-[18px] font-bold tracking-[-0.03em] text-stone-900 leading-tight">
        {value}
      </span>
      <Pencil className="h-3 w-3 text-stone-300 opacity-0 group-hover/edit:opacity-100 transition-opacity duration-200 shrink-0" />
    </button>
  );
}

/** Skeleton line for loading state */
function Skeleton({ width = "w-32" }: { width?: string }) {
  return <div className={`h-3 ${width} animate-pulse bg-stone-200`} />;
}

/** Thin horizontal score bar — G2: glows amber when value > 0.85 */
function ScoreBar({ value, label, glow }: { value: number; label: string; glow?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className={`flex items-center gap-3 px-2 py-1.5 -mx-2 rounded-sm transition-all duration-300 ${glow ? "ring-1 ring-amber-200/50 bg-amber-50/30" : ""}`}>
      <span className="w-16 shrink-0 text-[11px] text-stone-500">{label}</span>
      <div className="flex-1 h-1.5 bg-stone-200 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${glow ? "bg-amber-500" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-[12px] tabular-nums text-stone-500">
        {pct}
      </span>
    </div>
  );
}

/** V1: Icon mapping for scene tag chips */
const SCENE_TAG_ICONS: Record<string, LucideIcon> = {
  portrait: User,
  portraits: User,
  people: Users,
  group: Users,
  crowd: Users,
  landscape: Mountain,
  nature: Mountain,
  outdoor: Mountain,
  outdoors: Mountain,
  ceremony: Sparkles,
  celebration: Sparkles,
  party: Sparkles,
  wedding: Sparkles,
  detail: Camera,
  details: Camera,
  close_up: Camera,
  macro: Camera,
  food: Aperture,
  architecture: Mountain,
};

function SceneTagChip({ tag }: { tag: string }) {
  const Icon = SCENE_TAG_ICONS[tag.toLowerCase().replace(/[\s-]/g, "_")] ?? Aperture;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.15em] text-stone-500 border border-stone-200 hover:bg-stone-50 transition-colors duration-200 cursor-default">
      <Icon className="h-3 w-3 text-stone-400" />
      {tag}
    </span>
  );
}

/**
 * MetadataPanel — Right sidebar showing full image metadata.
 * Slides in from the right. Light theme. Sections only render when data exists.
 */
export function MetadataPanel({
  image,
  detail,
  isLoading,
  isOpen,
  onNameUpdate,
}: MetadataPanelProps) {
  if (!isOpen) return null;

  const hasExif = detail && (detail.cameraMake || detail.cameraModel || detail.lens);
  const hasCapture = detail?.takenAt;
  // AI_HIDDEN: Quality and scene tag checks disabled — AI backend not configured
  // const hasQuality = image.aestheticScore != null || image.sharpnessScore != null;
  // const hasTags = detail?.sceneTags && detail.sceneTags.length > 0;

  return (
    <div className="w-[360px] shrink-0 overflow-y-auto border-l border-stone-200 bg-white lightbox-panel-enter">
      <div className="p-6 space-y-6">
        {/* ── Details ── */}
        <section>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
            Details
          </h3>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton width="w-40" />
              <Skeleton width="w-56" />
              <Skeleton width="w-24" />
            </div>
          ) : (
            <div className="space-y-1.5">
              {image.parsedName && (
                <InlineEditName
                  imageId={image.id}
                  value={image.parsedName}
                  onSave={onNameUpdate}
                />
              )}
              <p className="text-[13px] italic text-stone-500">
                {image.originalFilename}
              </p>
              {image.width && image.height && (
                <p className="text-[12px] text-stone-400">
                  {image.width} &times; {image.height}
                </p>
              )}
            </div>
          )}
        </section>

        <div className="h-px bg-stone-200" />

        {/* ── Camera ── */}
        {isLoading ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
              Camera
            </h3>
            <div className="space-y-2">
              <Skeleton width="w-36" />
              <Skeleton width="w-44" />
              <Skeleton width="w-32" />
            </div>
          </section>
        ) : hasExif ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
              Camera
            </h3>
            {/* V2: Compact camera info card */}
            <div className="bg-stone-50 p-3 border border-stone-100 space-y-2">
              <div className="flex items-center gap-2">
                <Camera className="h-3.5 w-3.5 text-stone-400" />
                <p className="text-[13px] font-medium text-stone-700">
                  {[detail.cameraMake, detail.cameraModel]
                    .filter(Boolean)
                    .join(" ") || "Unknown Camera"}
                  {detail.lens && (
                    <span className="text-stone-400 font-normal"> · {detail.lens}</span>
                  )}
                </p>
              </div>
              {(detail.focalLength || detail.aperture || detail.shutterSpeed || detail.iso) && (
                <p className="text-[12px] text-stone-400 pl-[22px]">
                  {[
                    detail.focalLength ? `${detail.focalLength}mm` : null,
                    detail.aperture ? `f/${detail.aperture}` : null,
                    detail.shutterSpeed,
                    detail.iso ? `ISO ${detail.iso}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          </section>
        ) : null}

        {hasExif && <div className="h-px bg-stone-200" />}

        {/* ── Captured ── */}
        {isLoading ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
              Captured
            </h3>
            <Skeleton width="w-48" />
          </section>
        ) : hasCapture ? (
          <section>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 mb-3">
              Captured
            </h3>
            <p className="text-[13px] text-stone-700">
              {new Date(detail.takenAt!).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              {" · "}
              {new Date(detail.takenAt!).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </section>
        ) : null}

        {hasCapture && <div className="h-px bg-stone-200" />}

        {/* AI_HIDDEN: Quality section and Scene Tags section disabled — AI backend not configured */}
      </div>
    </div>
  );
}
