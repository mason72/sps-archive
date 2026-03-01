"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Link2,
  Download,
  Trash2,
  FolderPlus,
  ArrowRight,
  FolderMinus,
  Pencil,
  X,
  Check,
} from "lucide-react";

interface SectionOption {
  id: string;
  name: string;
}

interface SelectionToolbarProps {
  count: number;
  onDeselectAll: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onCreateShareLink: () => void;
  onDownload: () => void;
  onAddToSection?: (sectionId: string) => void;
  onMoveToSection?: (sectionId: string) => void;
  onRemoveFromSection?: () => void;
  onRename?: (pattern: string) => void;
  sections?: SectionOption[];
  activeSection?: string | null;
}

/**
 * SelectionToolbar — Fixed bottom bar that appears when images are selected.
 * Shows count + action icons. Portaled to body for z-index safety.
 * Enhanced with rename, move, and remove-from-section actions.
 */
export function SelectionToolbar({
  count,
  onDeselectAll,
  onDelete,
  onFavorite,
  onCreateShareLink,
  onDownload,
  onAddToSection,
  onMoveToSection,
  onRemoveFromSection,
  onRename,
  sections = [],
  activeSection,
}: SelectionToolbarProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showRenamePopover, setShowRenamePopover] = useState(false);
  const [addedToSection, setAddedToSection] = useState<string | null>(null);
  const [movedToSection, setMovedToSection] = useState<string | null>(null);
  const [renamePattern, setRenamePattern] = useState("{N}");
  const pickerRef = useRef<HTMLDivElement>(null);
  const movePickerRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);

  // Close popovers on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (showSectionPicker && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSectionPicker(false);
      }
      if (showMovePicker && movePickerRef.current && !movePickerRef.current.contains(e.target as Node)) {
        setShowMovePicker(false);
      }
      if (showRenamePopover && renameRef.current && !renameRef.current.contains(e.target as Node)) {
        setShowRenamePopover(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSectionPicker, showMovePicker, showRenamePopover]);

  if (typeof window === "undefined") return null;

  const handleDelete = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }
    setIsDeleting(true);
    await onDelete();
    setIsDeleting(false);
    setShowDeleteConfirm(false);
  };

  const handleRenameApply = () => {
    if (onRename && renamePattern.trim()) {
      onRename(renamePattern.trim());
      setShowRenamePopover(false);
    }
  };

  // Generate preview filenames based on the pattern
  const renamePreview = Array.from({ length: Math.min(count, 3) }, (_, i) => {
    return renamePattern
      .replace("{N}", String(i + 1).padStart(3, "0"))
      .replace("{n}", String(i + 1));
  });

  return createPortal(
    <div className="fixed bottom-0 left-0 right-0 z-50 toolbar-enter">
      <div className="mx-4 mb-4 bg-stone-900 text-white flex items-center justify-between px-6 h-14 shadow-xl">
        {/* Left: Count + deselect */}
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium tracking-wide">
            {count} selected
          </span>
          <button
            onClick={onDeselectAll}
            className="flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Deselect
          </button>
        </div>

        {/* Right: Action icons */}
        <div className="flex items-center gap-1">
          {/* Rename */}
          {onRename && (
            <div className="relative" ref={renameRef}>
              <ToolbarButton
                icon={<Pencil className="h-4 w-4" />}
                label="Rename"
                onClick={() => setShowRenamePopover((v) => !v)}
                active={showRenamePopover}
              />
              {showRenamePopover && (
                <div className="absolute bottom-full mb-2 right-0 bg-white text-stone-900 shadow-xl border border-stone-200 w-[260px] p-4 scale-in">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-2">
                    Batch rename
                  </p>
                  <input
                    type="text"
                    value={renamePattern}
                    onChange={(e) => setRenamePattern(e.target.value)}
                    className="w-full border border-stone-200 px-3 py-2 text-[13px] text-stone-900 focus:border-accent focus:outline-none mb-2"
                    placeholder="{N} for zero-padded, {n} for plain"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameApply();
                      if (e.key === "Escape") setShowRenamePopover(false);
                    }}
                  />
                  <div className="text-[11px] text-stone-400 mb-3 space-y-0.5">
                    {renamePreview.map((name, i) => (
                      <p key={i}>{name}</p>
                    ))}
                    {count > 3 && <p>…and {count - 3} more</p>}
                  </div>
                  <button
                    onClick={handleRenameApply}
                    className="w-full py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}

          <ToolbarButton
            icon={<Star className="h-4 w-4" />}
            label="Favorite"
            onClick={onFavorite}
          />
          <ToolbarButton
            icon={<Link2 className="h-4 w-4" />}
            label="Share link"
            onClick={onCreateShareLink}
          />
          <ToolbarButton
            icon={<Download className="h-4 w-4" />}
            label="Download"
            onClick={onDownload}
          />

          <div className="w-px h-5 bg-stone-700 mx-1" />

          {/* Copy to section */}
          {onAddToSection && sections.length > 0 && (
            <div className="relative" ref={pickerRef}>
              <ToolbarButton
                icon={<FolderPlus className="h-4 w-4" />}
                label="Copy to…"
                onClick={() => setShowSectionPicker((v) => !v)}
                active={showSectionPicker}
              />
              {showSectionPicker && (
                <div className="absolute bottom-full mb-2 right-0 bg-white text-stone-900 shadow-xl border border-stone-200 min-w-[180px] py-1 scale-in">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
                    Copy to section
                  </p>
                  {sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onAddToSection(s.id);
                        setAddedToSection(s.id);
                        setTimeout(() => {
                          setAddedToSection(null);
                          setShowSectionPicker(false);
                        }, 800);
                      }}
                      className="w-full text-left px-3 py-2 text-[13px] hover:bg-stone-50 transition-colors flex items-center gap-2"
                    >
                      <span className="flex-1 truncate">{s.name}</span>
                      {addedToSection === s.id && (
                        <Check size={14} className="text-accent shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Move to section (only when a section is active) */}
          {activeSection && onMoveToSection && sections.length > 0 && (
            <div className="relative" ref={movePickerRef}>
              <ToolbarButton
                icon={<ArrowRight className="h-4 w-4" />}
                label="Move to…"
                onClick={() => setShowMovePicker((v) => !v)}
                active={showMovePicker}
              />
              {showMovePicker && (
                <div className="absolute bottom-full mb-2 right-0 bg-white text-stone-900 shadow-xl border border-stone-200 min-w-[180px] py-1 scale-in">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
                    Move to section
                  </p>
                  {sections
                    .filter((s) => s.id !== activeSection)
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          onMoveToSection(s.id);
                          setMovedToSection(s.id);
                          setTimeout(() => {
                            setMovedToSection(null);
                            setShowMovePicker(false);
                          }, 800);
                        }}
                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-stone-50 transition-colors flex items-center gap-2"
                      >
                        <span className="flex-1 truncate">{s.name}</span>
                        {movedToSection === s.id && (
                          <Check size={14} className="text-accent shrink-0" />
                        )}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Remove from section (only when a section is active) */}
          {activeSection && onRemoveFromSection && (
            <ToolbarButton
              icon={<FolderMinus className="h-4 w-4" />}
              label="Remove from section"
              onClick={onRemoveFromSection}
            />
          )}

          <div className="w-px h-5 bg-stone-700 mx-1" />

          {showDeleteConfirm ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-[12px] text-red-400 hover:text-red-300 font-medium transition-colors px-2 py-1"
              >
                {isDeleting ? "Deleting..." : "Confirm delete"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="text-[12px] text-stone-500 hover:text-stone-300 transition-colors px-2 py-1"
              >
                Cancel
              </button>
            </div>
          ) : (
            <ToolbarButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              onClick={handleDelete}
              danger
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  danger,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-2.5 transition-colors ${
        danger
          ? "text-stone-400 hover:text-red-400"
          : active
            ? "text-white"
            : "text-stone-400 hover:text-white"
      }`}
    >
      {icon}
    </button>
  );
}
