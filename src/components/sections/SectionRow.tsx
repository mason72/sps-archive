"use client";

import { useState, useRef, useEffect } from "react";
import { GripVertical, Pencil, Trash2, Check, X, Sparkles } from "lucide-react";

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
            <span className="text-[13px] text-stone-900 font-medium truncate">
              {name}
            </span>
            {isAuto && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-500/70 shrink-0" title="AI-generated section">
                <Sparkles size={10} />
                Auto
              </span>
            )}
          </div>
        )}
      </div>

      {/* Image count badge */}
      <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
        {imageCount} {imageCount === 1 ? "image" : "images"}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1 text-stone-400 hover:text-stone-700 transition-colors"
          title="Rename"
        >
          <Pencil size={13} />
        </button>
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
      </div>
    </div>
  );
}
