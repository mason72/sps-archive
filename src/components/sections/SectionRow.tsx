"use client";

import { useState, useRef, useEffect } from "react";
import { GripVertical, Pencil, Trash2, Check, X, Upload, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";

interface SectionRowProps {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  isDragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: () => void;
  /** Called when images are dropped onto this section row */
  onDropImages?: (sectionId: string, imageIds: string[]) => void;
  /** True when new uploads will land in this section — shows a target badge */
  isUploadTarget?: boolean;
  /** When false, the delete control is hidden (e.g. the last remaining section) */
  canDelete?: boolean;
  /** Soft guard: locked sections reject membership/order edits until unlocked. */
  locked?: boolean;
  onToggleLock?: (id: string, locked: boolean) => void;
  /**
   * Job sections (TDP Work gallery): live = on the site; draft = held back
   * (missing metadata or photos — the title says which). Undefined = not a job.
   */
  jobStatus?: { live: boolean; title: string };
}

export function SectionRow({
  id,
  name,
  isAuto,
  imageCount,
  onRename,
  onDelete,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDropImages,
  isUploadTarget = false,
  canDelete = true,
  locked = false,
  onToggleLock,
  jobStatus,
}: SectionRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(id, trimmed);
    } else {
      setEditValue(name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setEditValue(name);
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 border-b border-stone-100 transition-colors duration-200 ${
        isDragging ? "bg-stone-50 opacity-60" : isDropTarget ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300" : "hover:bg-stone-50/50"
      }`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        // Check if this is an image drop (not a section reorder)
        if (e.dataTransfer.types.includes("application/x-image-ids")) {
          if (locked) return; // no drop affordance on locked sections
          e.dataTransfer.dropEffect = "move";
          setIsDropTarget(true);
        } else {
          onDragOver?.();
        }
      }}
      onDragLeave={(e) => {
        // Only clear if we're leaving this element entirely (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDropTarget(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDropTarget(false);
        const raw = e.dataTransfer.getData("application/x-image-ids");
        if (raw && locked) {
          toast.error(`"${name}" is locked — unlock it to add images.`);
          return;
        }
        if (raw && onDropImages) {
          try {
            const imageIds = JSON.parse(raw) as string[];
            if (imageIds.length > 0) {
              onDropImages(id, imageIds);
            }
          } catch {
            // Invalid data — ignore
          }
        }
      }}
    >
      {/* Drag handle */}
      <button
        className="cursor-grab active:cursor-grabbing text-stone-300 hover:text-stone-500 transition-colors shrink-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GripVertical size={16} />
      </button>

      {/* Name / edit */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSave}
              className="flex-1 text-[13px] text-stone-900 bg-white border-b border-stone-300 focus:border-stone-900 outline-none py-0.5 transition-colors"
            />
            <button
              onClick={handleSave}
              className="text-accent hover:text-accent-hover transition-colors"
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => {
                setEditValue(name);
                setIsEditing(false);
              }}
              className="text-stone-400 hover:text-stone-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {jobStatus && (
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  jobStatus.live ? "bg-emerald-500" : "bg-amber-400"
                }`}
                title={jobStatus.title}
              />
            )}
            <span className="text-[13px] text-stone-900 font-medium truncate">
              {name}
            </span>
            {isUploadTarget && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-accent shrink-0"
                title="New uploads land here"
              >
                <Upload size={9} />
                Target
              </span>
            )}
            {/* AI_HIDDEN: Auto badge disabled — AI backend not configured */}
          </div>
        )}
      </div>

      {/* Image count badge */}
      <span
        className={`text-[11px] tabular-nums shrink-0 ${
          locked ? "text-stone-300" : "text-stone-400"
        }`}
      >
        {imageCount} {imageCount === 1 ? "image" : "images"}
      </span>

      {/* Lock toggle — always visible; dim when open, amber when locked */}
      {onToggleLock && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(id, !locked);
          }}
          className={`shrink-0 p-1 transition-colors ${
            locked
              ? "text-amber-500 hover:text-amber-600"
              : "text-stone-200 hover:text-stone-400"
          }`}
          title={
            locked
              ? "Locked — click to unlock and allow edits"
              : "Unlocked — click to lock against accidental edits"
          }
          aria-pressed={locked}
        >
          {locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1 text-stone-400 hover:text-stone-700 transition-colors"
          title="Rename"
        >
          <Pencil size={13} />
        </button>
        {canDelete && !locked && (
          <button
            onClick={handleDelete}
            className={`p-1 transition-colors ${
              confirmDelete
                ? "text-red-500 hover:text-red-700"
                : "text-stone-400 hover:text-red-500"
            }`}
            title={confirmDelete ? "Click again to confirm" : "Delete section"}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
