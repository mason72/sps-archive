"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FolderOpen, Loader2, Lock, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";

interface GalleryOption {
  id: string;
  name: string;
  /** Null when the count was unavailable — render nothing, never "0 images". */
  imageCount: number | null;
  coverThumbnailUrl: string | null;
  isWebsite: boolean;
}

interface SectionOption {
  id: string;
  name: string;
  locked: boolean;
  imageCount: number;
}

interface GalleryTransferModalProps {
  mode: "copy" | "move";
  imageIds: string[];
  /** The gallery currently open — excluded from the target list. */
  currentEventId: string;
  onClose: () => void;
  /** Fired after a successful transfer so the page can refresh + deselect. */
  onDone: (summary: { mode: "copy" | "move"; galleryName: string; sectionName: string }) => void;
}

/**
 * GalleryTransferModal — copy or move the selection into a section of
 * ANOTHER gallery. Two panes: searchable gallery list → that gallery's
 * sections (+ inline "New section…"), then one explicit action button.
 *
 * Copy = zero-copy link (the existing "copies" model — last copy anywhere is
 * the real one). Move = full relocation (re-homes the image; it leaves this
 * gallery's All Images, shares, and stacks). Website/Work galleries accept
 * copies (that IS site curation) but are not move targets — site imagery is
 * supposed to live in client galleries and be linked, not re-homed.
 */
export function GalleryTransferModal({
  mode,
  imageIds,
  currentEventId,
  onClose,
  onDone,
}: GalleryTransferModalProps) {
  const [galleries, setGalleries] = useState<GalleryOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedGallery, setSelectedGallery] = useState<GalleryOption | null>(null);
  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [sectionQuery, setSectionQuery] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [isWorking, setIsWorking] = useState(false);

  // Load the gallery list once.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/events?limit=100")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        type EventRow = {
          id: string;
          name: string;
          settings?: Record<string, unknown> | null;
          images?: Array<{ count: number }> | null;
          coverThumbnailUrl?: string | null;
        };
        const list = ((data.events ?? []) as EventRow[])
          .filter((e) => e.id !== currentEventId)
          .map((e) => ({
            id: e.id,
            name: e.name,
            imageCount: e.images?.[0]?.count ?? null,
            coverThumbnailUrl: e.coverThumbnailUrl ?? null,
            isWebsite:
              e.settings?.website === true || e.settings?.work === true,
          }))
          // Moves re-home images; site galleries link, never own. Copies may
          // target them — that's exactly how site curation works.
          .filter((e) => (mode === "move" ? !e.isWebsite : true));
        setGalleries(list);
      })
      .catch(() => setGalleries([]));
    return () => {
      cancelled = true;
    };
  }, [currentEventId, mode]);

  // Load sections when a gallery is picked.
  useEffect(() => {
    if (!selectedGallery) return;
    let cancelled = false;
    setSections(null);
    setSectionQuery("");
    setSelectedSectionId(null);
    fetch(`/api/events/${selectedGallery.id}/sections`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSections(data.sections ?? []);
      })
      .catch(() => setSections([]));
    return () => {
      cancelled = true;
    };
  }, [selectedGallery]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!galleries) return null;
    const q = query.trim().toLowerCase();
    return q ? galleries.filter((g) => g.name.toLowerCase().includes(q)) : galleries;
  }, [galleries, query]);

  const filteredSections = useMemo(() => {
    if (!sections) return null;
    const q = sectionQuery.trim().toLowerCase();
    return q
      ? sections.filter((s) => s.name.toLowerCase().includes(q))
      : sections;
  }, [sections, sectionQuery]);

  const handleTransfer = async () => {
    if (!selectedGallery || isWorking) return;
    const wantsNewSection = !selectedSectionId && newSectionName.trim();
    if (!selectedSectionId && !wantsNewSection) return;

    setIsWorking(true);
    try {
      let targetSectionId = selectedSectionId;
      let sectionName =
        sections?.find((s) => s.id === selectedSectionId)?.name ?? "";

      if (wantsNewSection) {
        const createRes = await fetch("/api/sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: selectedGallery.id,
            name: newSectionName.trim(),
          }),
        });
        if (!createRes.ok) throw new Error("Failed to create section");
        const created = await createRes.json();
        targetSectionId = created.section.id;
        sectionName = created.section.name;
      }

      const res = await fetch("/api/images/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds, targetSectionId, mode }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Transfer failed");
      }

      onDone({ mode, galleryName: selectedGallery.name, sectionName });
      onClose();
    } catch (err) {
      console.error("Gallery transfer failed:", err);
      toast.error(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setIsWorking(false);
    }
  };

  if (typeof window === "undefined") return null;

  const verb = mode === "copy" ? "Copy" : "Move";
  const canSubmit =
    !!selectedGallery && (!!selectedSectionId || !!newSectionName.trim());

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
              {verb} to another gallery
            </p>
            <p className="text-[13px] text-stone-600">
              {mode === "copy"
                ? "Links the photos there too — one image, no duplicates. Deleting the last copy anywhere deletes it for real."
                : "Re-homes the photos — they leave this gallery (including its shares and stacks) entirely."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panes */}
        <div className="flex min-h-0 flex-1">
          {/* Gallery list */}
          <div className="flex w-1/2 flex-col border-r border-stone-100">
            <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-stone-300" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a gallery…"
                className="w-full bg-transparent py-1 text-[13px] text-stone-900 outline-none placeholder:text-stone-300"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered === null ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-4 w-4 animate-spin text-stone-300" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-stone-400">
                  No other galleries{query ? " match" : ""}
                </p>
              ) : (
                filtered.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGallery(g)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      selectedGallery?.id === g.id
                        ? "bg-accent/5"
                        : "hover:bg-stone-50"
                    }`}
                  >
                    <div className="h-9 w-9 shrink-0 overflow-hidden bg-stone-100">
                      {g.coverThumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.coverThumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <FolderOpen className="h-4 w-4 text-stone-300" />
                        </div>
                      )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-stone-900">
                        {g.name}
                      </span>
                      {g.imageCount !== null && (
                        <span className="block text-[11px] tabular-nums text-stone-400">
                          {g.imageCount} {g.imageCount === 1 ? "image" : "images"}
                        </span>
                      )}
                    </span>
                    {selectedGallery?.id === g.id && (
                      <Check className="h-4 w-4 shrink-0 text-accent" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Section list for the selected gallery */}
          <div className="flex w-1/2 flex-col">
            {!selectedGallery ? (
              <p className="px-4 py-8 text-center text-[12px] text-stone-400">
                Pick a gallery to see its sections
              </p>
            ) : sections === null ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-4 w-4 animate-spin text-stone-300" />
              </div>
            ) : (
              <>
                {sections.length > 5 && (
                  <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2">
                    <Search className="h-3.5 w-3.5 shrink-0 text-stone-300" />
                    <input
                      type="text"
                      value={sectionQuery}
                      onChange={(e) => setSectionQuery(e.target.value)}
                      placeholder="Find a section…"
                      className="w-full bg-transparent py-1 text-[13px] text-stone-900 outline-none placeholder:text-stone-300"
                    />
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                  {filteredSections?.length === 0 && (
                    <p className="px-4 py-6 text-center text-[12px] text-stone-400">
                      No sections match
                    </p>
                  )}
                  {(filteredSections ?? []).map((s) => (
                    <button
                      key={s.id}
                      disabled={s.locked}
                      onClick={() => {
                        setSelectedSectionId(s.id);
                        setNewSectionName("");
                      }}
                      title={
                        s.locked ? "Locked — unlock to receive images" : undefined
                      }
                      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:text-stone-300 ${
                        selectedSectionId === s.id
                          ? "bg-accent/5 text-stone-900"
                          : "text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-stone-300">
                        {s.imageCount}
                      </span>
                      {s.locked && (
                        <Lock size={12} className="shrink-0 text-stone-300" />
                      )}
                      {selectedSectionId === s.id && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                      )}
                    </button>
                  ))}
                </div>
                {/* Inline new section */}
                <div className="flex items-center gap-2 border-t border-stone-100 px-4 py-2">
                  <Plus size={14} className="shrink-0 text-stone-400" />
                  <input
                    type="text"
                    value={newSectionName}
                    onChange={(e) => {
                      setNewSectionName(e.target.value);
                      if (e.target.value.trim()) setSelectedSectionId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmit) handleTransfer();
                    }}
                    placeholder="New section…"
                    className="w-full bg-transparent py-1 text-[13px] text-stone-900 outline-none placeholder:text-stone-300"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-100 px-5 py-3">
          <p className="text-[11px] text-stone-400">
            {selectedGallery
              ? newSectionName.trim()
                ? `${verb} into a new section of ${selectedGallery.name}`
                : selectedSectionId
                ? `${verb} into ${selectedGallery.name}`
                : "Pick a section"
              : "Pick a gallery"}
          </p>
          <button
            onClick={handleTransfer}
            disabled={!canSubmit || isWorking}
            className="px-4 py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isWorking
              ? `${verb === "Copy" ? "Copying" : "Moving"}…`
              : `${verb} ${imageIds.length} ${imageIds.length === 1 ? "image" : "images"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
