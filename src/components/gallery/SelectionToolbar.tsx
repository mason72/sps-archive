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
  /** Sidebar width in px — used to center toolbar over the content area */
  sidebarOffset?: number;
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
  sidebarOffset = 0,
}: SelectionToolbarProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [showMovePicker, setShowMovePicker] = useState(false);
  const [showRenamePopover, setShowRenamePopover] = useState(false);
  const [addedToSection, setAddedToSection] = useState<string | null>(null);
  const [movedToSection, setMovedToSection] = useState<string | null>(null);
  const [renameBaseName, setRenameBaseName] = useState("");
  const [renameZeroPad, setRenameZeroPad] = useState(true);
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
    if (onRename && renameBaseName.trim()) {
      const pattern = renameZeroPad
        ? `${renameBaseName.trim()} {N}`
        : `${renameBaseName.trim()} {n}`;
      onRename(pattern);
      setShowRenamePopover(false);
    }
  };

  // Generate preview filenames
  const renamePreview = renameBaseName.trim()
    ? Array.from({ length: Math.min(count, 3) }, (_, i) => {
        const num = renameZeroPad
          ? String(i + 1).padStart(3, "0")
          : String(i + 1);
        return `${renameBaseName.trim()} ${num}`;
      })
    : [];

  return createPortal(
    <div
      className="fixed bottom-6 -translate-x-1/2 z-50 toolbar-enter"
      style={{ left: `calc(50% + ${sidebarOffset / 2}px)` }}
    >
      <div className="inline-flex items-center gap-1 bg-white/90 backdrop-blur-2xl text-stone-900 px-5 h-11 rounded-full border border-stone-200/80 shadow-[0_8px_40px_rgba(0,0,0,0.12),0_2px_12px_rgba(0,0,0,0.08)]">
        {/* Count + deselect */}
        <span className="text-[12px] font-medium tabular-nums whitespace-nowrap">
          {count}
        </span>
        <button
          onClick={onDeselectAll}
          title="Deselect all"
          className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="w-px h-4 bg-stone-200" />

        {/* Action icons */}
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
                <div className="absolute bottom-full mb-2 right-0 bg-white text-stone-900 shadow-xl border border-stone-200 w-[280px] p-4 scale-in">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium mb-3">
                    Batch rename
                  </p>
                  <label className="text-[11px] text-stone-500 mb-1 block">Base name</label>
                  <input
                    type="text"
                    value={renameBaseName}
                    onChange={(e) => setRenameBaseName(e.target.value)}
                    className="w-full border border-stone-200 px-3 py-2 text-[13px] text-stone-900 focus:border-accent focus:outline-none mb-3"
                    placeholder="e.g. Johnson Wedding"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameApply();
                      if (e.key === "Escape") setShowRenamePopover(false);
                    }}
                  />
                  <label className="text-[11px] text-stone-500 mb-1.5 block">Numbering</label>
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setRenameZeroPad(true)}
                      className={`flex-1 py-1.5 text-[12px] border transition-colors ${
                        renameZeroPad
                          ? "border-stone-900 bg-stone-900 text-white"
                          : "border-stone-200 text-stone-600 hover:bg-stone-50"
                      }`}
                    >
                      001, 002, 003
                    </button>
                    <button
                      onClick={() => setRenameZeroPad(false)}
                      className={`flex-1 py-1.5 text-[12px] border transition-colors ${
                        !renameZeroPad
                          ? "border-stone-900 bg-stone-900 text-white"
                          : "border-stone-200 text-stone-600 hover:bg-stone-50"
                      }`}
                    >
                      1, 2, 3
                    </button>
                  </div>
                  {renamePreview.length > 0 && (
                    <div className="text-[11px] text-stone-400 mb-3 space-y-0.5 bg-stone-50 px-3 py-2 border border-stone-100">
                      <p className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">Preview</p>
                      {renamePreview.map((name, i) => (
                        <p key={i} className="text-stone-600">{name}.jpg</p>
                      ))}
                      {count > 3 && <p className="text-stone-400">…and {count - 3} more</p>}
                    </div>
                  )}
                  <button
                    onClick={handleRenameApply}
                    disabled={!renameBaseName.trim()}
                    className="w-full py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Rename {count} files
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

          <div className="w-px h-4 bg-stone-200" />

          {/* Move to section (always visible as primary action) */}
          {onMoveToSection && sections.length > 0 && (
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

          {/* Copy to section (secondary action) */}
          {activeSection && onAddToSection && sections.length > 0 && (
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

          {/* Remove from section (only when a section is active) */}
          {activeSection && onRemoveFromSection && (
            <ToolbarButton
              icon={<FolderMinus className="h-4 w-4" />}
              label="Remove from section"
              onClick={onRemoveFromSection}
            />
          )}

          <div className="w-px h-4 bg-stone-200" />

          {showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-[11px] text-red-500 hover:text-red-600 font-medium transition-colors px-2 py-1 whitespace-nowrap"
              >
                {isDeleting ? "..." : "Confirm"}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
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
      className={`p-2 transition-colors ${
        danger
          ? "text-stone-400 hover:text-red-500"
          : active
            ? "text-stone-900"
            : "text-stone-400 hover:text-stone-900"
      }`}
    >
      {icon}
    </button>
  );
}
