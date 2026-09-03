"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { mediaExtension, stripMediaExtension } from "@/lib/upload/media";
import {
  Lock,
  Star,
  Link2,
  Download,
  Trash2,
  FolderPlus,
  Plus,
  FolderOpen,
  ArrowRight,
  Pencil,
  X,
  Check,
  Image as ImageIcon,
  Crosshair,
  ScanFace,
  Captions,
  Search,
} from "lucide-react";

interface SectionOption {
  id: string;
  name: string;
  /** Locked sections can't receive (or give up) images — shown disabled. */
  locked?: boolean;
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
  /**
   * Create a section by name and return it (null on failure — the callback
   * owns the toast). Powers "+ New section" at the foot of both flyouts, so
   * organising a fresh dump never means closing the selection, going to the
   * sidebar, and re-selecting (Mason, 2026-08-21).
   */
  onCreateSection?: (name: string) => Promise<SectionOption | null>;
  /** Open the cross-gallery picker in copy mode ("Another gallery…"). */
  onCopyToGallery?: () => void;
  /** Open the cross-gallery picker in move mode ("Another gallery…"). */
  onMoveToGallery?: () => void;
  onRename?: (pattern: string) => void;
  /** Current filename of the single selected image — pre-fills the rename
   *  field (minus extension) and drives an accurate preview. */
  singleImageName?: string | null;
  /** Set the single selected image as the gallery cover (only when 1 selected). */
  onSetCover?: () => void;
  /**
   * Shown above the delete confirm. Used in website context, where the photos
   * are the ORIGINALS from client events — delete removes them everywhere,
   * which is rarely what "take it off the site" means.
   */
  deleteHint?: string;
  /** Pick the focal point of the single selected slot-section image. */
  onSetFocalPoint?: () => void;
  /** "Who is this?" — resolve this frame to its face clusters. Single selection only. */
  onIdentifyPerson?: () => void;
  /** Edit website curation details (event, city, service, featured). */
  onEditWebsiteDetails?: () => void;
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
  onCopyToGallery,
  onMoveToGallery,
  onCreateSection,
  onRename,
  singleImageName,
  onSetCover,
  deleteHint,
  onSetFocalPoint,
  onIdentifyPerson,
  onEditWebsiteDetails,
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

  // Pre-fill the field with the current name (minus extension) when the rename
  // popover opens for a single image — so you edit, not retype. (Must stay
  // above the early return below to satisfy rules-of-hooks.)
  useEffect(() => {
    if (showRenamePopover && count === 1 && singleImageName) {
      setRenameBaseName(stripMediaExtension(singleImageName));
    }
  }, [showRenamePopover, count, singleImageName]);

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

  // A single image renames to exactly what you type — no counter is appended,
  // and the numbering toggle is hidden. The counter only makes sense when a
  // batch needs unique names.
  const singleRename = count === 1;
  // The original extension is always preserved by the server (you name files
  // without one); show it in the single-rename preview so the result is honest.
  const singleExt = singleImageName ? mediaExtension(singleImageName) : null;

  const handleRenameApply = () => {
    if (onRename && renameBaseName.trim()) {
      const base = renameBaseName.trim();
      const pattern = singleRename
        ? base
        : renameZeroPad
        ? `${base} {N}`
        : `${base} {n}`;
      onRename(pattern);
      setShowRenamePopover(false);
    }
  };

  // Generate preview filenames. Single rename shows the real extension that
  // will be kept; batch shows base+number (each keeps its own extension —
  // noted in the UI rather than faked with a single ".jpg").
  const renamePreview = renameBaseName.trim()
    ? singleRename
      ? [`${renameBaseName.trim()}${singleExt ? `.${singleExt}` : ""}`]
      : Array.from({ length: Math.min(count, 3) }, (_, i) => {
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
                    {singleRename ? "Rename" : "Batch rename"}
                  </p>
                  <label className="text-[11px] text-stone-500 mb-1 block">
                    {singleRename ? "New name" : "Base name"}
                  </label>
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
                  {!singleRename && (
                    <>
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
                    </>
                  )}
                  {renamePreview.length > 0 && (
                    <div className="text-[11px] text-stone-400 mb-3 space-y-0.5 bg-stone-50 px-3 py-2 border border-stone-100">
                      <p className="text-[10px] text-stone-400 uppercase tracking-wider mb-1">Preview</p>
                      {renamePreview.map((name, i) => (
                        <p key={i} className="text-stone-600">{name}</p>
                      ))}
                      {count > 3 && <p className="text-stone-400">…and {count - 3} more</p>}
                      {!singleRename && (
                        <p className="pt-0.5 text-stone-400">
                          Each keeps its original extension.
                        </p>
                      )}
                    </div>
                  )}
                  <button
                    onClick={handleRenameApply}
                    disabled={!renameBaseName.trim()}
                    className="w-full py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {singleRename ? "Rename" : `Rename ${count} files`}
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
          {onSetCover && (
            <ToolbarButton
              icon={<ImageIcon className="h-4 w-4" />}
              label="Make cover"
              onClick={onSetCover}
            />
          )}
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
                <SectionFlyout
                  title="Move to section"
                  sections={sections.filter((s) => s.id !== activeSection)}
                  pickedId={movedToSection}
                  lockHint="Locked — unlock to move images here"
                  onPick={(id) => {
                    onMoveToSection(id);
                    setMovedToSection(id);
                    setTimeout(() => {
                      setMovedToSection(null);
                      setShowMovePicker(false);
                    }, 800);
                  }}
                  onCreate={onCreateSection}
                  onGallery={
                    onMoveToGallery
                      ? () => {
                          setShowMovePicker(false);
                          onMoveToGallery();
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {/* Copy to section (secondary action). Offered from All Images too:
              copying is a LINK into the target and needs no source section.
              It used to hide the within-gallery rows there, which read as
              "this gallery has no sections" (Mason, 2026-08-21). */}
          {((onAddToSection && sections.length > 0) || onCopyToGallery) && (
            <div className="relative" ref={pickerRef}>
              <ToolbarButton
                icon={<FolderPlus className="h-4 w-4" />}
                label="Copy to…"
                onClick={() => setShowSectionPicker((v) => !v)}
                active={showSectionPicker}
              />
              {showSectionPicker && (
                <SectionFlyout
                  title="Copy to section"
                  sections={
                    onAddToSection ? sections.filter((s) => s.id !== activeSection) : []
                  }
                  pickedId={addedToSection}
                  lockHint="Locked — unlock to copy images here"
                  onPick={(id) => {
                    onAddToSection?.(id);
                    setAddedToSection(id);
                    setTimeout(() => {
                      setAddedToSection(null);
                      setShowSectionPicker(false);
                    }, 800);
                  }}
                  onCreate={onAddToSection ? onCreateSection : undefined}
                  onGallery={
                    onCopyToGallery
                      ? () => {
                          setShowSectionPicker(false);
                          onCopyToGallery();
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {/* Who is this? — the bridge from a frame to the person panel where
              naming, crew-linking and splitting already live. Everything it
              leads to existed; nothing on the grid pointed at it. */}
          {onIdentifyPerson && (
            <ToolbarButton
              icon={<ScanFace className="h-4 w-4" />}
              label="Who is this?"
              onClick={onIdentifyPerson}
            />
          )}

          {/* Focal point (single slot-section image) */}
          {onSetFocalPoint && (
            <ToolbarButton
              icon={<Crosshair className="h-4 w-4" />}
              label="Set focal point"
              onClick={onSetFocalPoint}
            />
          )}

          {/* Website curation details (event, city, service, featured) */}
          {onEditWebsiteDetails && (
            <ToolbarButton
              icon={<Captions className="h-4 w-4" />}
              label="Edit website details"
              onClick={onEditWebsiteDetails}
            />
          )}

          <div className="w-px h-4 bg-stone-200" />

          {showDeleteConfirm ? (
            <div className="relative flex items-center gap-1">
              {deleteHint && (
                <div className="absolute bottom-full mb-3 right-0 w-[260px] bg-white text-stone-600 shadow-xl border border-stone-200 px-3 py-2 text-[12px] leading-relaxed scale-in">
                  {deleteHint}
                </div>
              )}
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

/**
 * The Copy/Move section dropdown: a section label, a find-as-you-type search
 * (once the list is long enough to bother), a height-capped scroll region so
 * a long list never runs off the top of the screen, and an optional
 * "Another gallery…" footer pinned below the scroll. Each open mounts fresh,
 * so the query resets every time.
 */
function SectionFlyout({
  title,
  sections,
  pickedId,
  lockHint,
  onPick,
  onCreate,
  onGallery,
}: {
  title: string;
  sections: SectionOption[];
  pickedId: string | null;
  lockHint: string;
  onPick: (sectionId: string) => void;
  /** "+ New section": create by name, then pick it as the target. */
  onCreate?: (name: string) => Promise<SectionOption | null>;
  onGallery?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || !onCreate || busy) return;
    setBusy(true);
    try {
      const created = await onCreate(name);
      if (created) {
        setCreating(false);
        setNewName("");
        onPick(created.id);
      }
    } finally {
      setBusy(false);
    }
  };
  const showSearch = sections.length > 5;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sections.filter((s) => s.name.toLowerCase().includes(q))
    : sections;

  return (
    <div className="absolute bottom-full mb-2 right-0 w-60 bg-white text-stone-900 shadow-xl border border-stone-200 py-1 scale-in">
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
        {title}
      </p>

      {sections.length > 0 && (
        <>
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-stone-100 px-3 pb-2 pt-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-stone-300" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a section…"
                className="w-full bg-transparent py-0.5 text-[12px] outline-none placeholder:text-stone-300"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-[12px] text-stone-400">
                No sections match
              </p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  disabled={s.locked}
                  onClick={() => onPick(s.id)}
                  title={s.locked ? lockHint : undefined}
                  className="w-full text-left px-3 py-2 text-[13px] hover:bg-stone-50 transition-colors flex items-center gap-2 disabled:cursor-not-allowed disabled:text-stone-300 disabled:hover:bg-transparent"
                >
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.locked && (
                    <Lock size={12} className="shrink-0 text-stone-300" />
                  )}
                  {pickedId === s.id && (
                    <Check size={14} className="text-accent shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}

      {onCreate && (
        <>
          {sections.length > 0 && <div className="my-1 border-t border-stone-100" />}
          {creating ? (
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Plus size={13} className="shrink-0 text-stone-400" />
              <input
                autoFocus
                type="text"
                value={newName}
                disabled={busy}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="New section name…"
                className="w-full bg-transparent py-1 text-[13px] outline-none placeholder:text-stone-300"
              />
              {newName.trim() && (
                <button
                  onClick={() => void submitCreate()}
                  disabled={busy}
                  className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  {busy ? "…" : "Add"}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-[13px] hover:bg-stone-50 transition-colors flex items-center gap-2"
            >
              <Plus size={13} className="shrink-0 text-stone-400" />
              <span className="flex-1 truncate">New section…</span>
            </button>
          )}
        </>
      )}

      {onGallery && (
        <>
          {(sections.length > 0 || onCreate) && (
            <div className="my-1 border-t border-stone-100" />
          )}
          <button
            onClick={onGallery}
            className="w-full text-left px-3 py-2 text-[13px] hover:bg-stone-50 transition-colors flex items-center gap-2"
          >
            <FolderOpen size={13} className="shrink-0 text-stone-400" />
            <span className="flex-1 truncate">Another gallery…</span>
          </button>
        </>
      )}
    </div>
  );
}
