"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Star,
  Link2,
  Download,
  Trash2,
  FolderPlus,
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
  sections?: SectionOption[];
}

/**
 * SelectionToolbar — Fixed bottom bar that appears when images are selected.
 * Shows count + action icons. Portaled to body for z-index safety.
 */
export function SelectionToolbar({
  count,
  onDeselectAll,
  onDelete,
  onFavorite,
  onCreateShareLink,
  onDownload,
  onAddToSection,
  sections = [],
}: SelectionToolbarProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  const [addedToSection, setAddedToSection] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close section picker on outside click
  useEffect(() => {
    if (!showSectionPicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSectionPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSectionPicker]);

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
          {onAddToSection && sections.length > 0 && (
            <div className="relative" ref={pickerRef}>
              <ToolbarButton
                icon={<FolderPlus className="h-4 w-4" />}
                label="Add to section"
                onClick={() => setShowSectionPicker((v) => !v)}
                active={showSectionPicker}
              />
              {showSectionPicker && (
                <div className="absolute bottom-full mb-2 right-0 bg-white text-stone-900 shadow-xl border border-stone-200 min-w-[180px] py-1 scale-in">
                  <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
                    Add to section
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
