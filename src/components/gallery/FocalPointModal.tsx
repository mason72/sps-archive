"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { ImageData } from "@/types/image";

interface FocalPointModalProps {
  /** The images to sweep, in display order. */
  images: ImageData[];
  /** Where the sweep starts (an id from `images`). */
  initialImageId: string;
  onClose: () => void;
  /** Called after each successful save (null = cleared). */
  onSaved: (imageId: string, focal: { x: number; y: number } | null) => void;
  /**
   * Bulk "suggest for all unset" (website sections). Writes face-detection
   * suggestions server-side and returns how many were set; the parent updates
   * its image state so the sweep reflects the new values.
   */
  onBulkSuggest?: () => Promise<number>;
}

interface ImageDetailLite {
  originalUrl: string | null;
  suggestedX: number | null;
  suggestedY: number | null;
}

/**
 * FocalPointModal — a SWEEP over the section's images, built so a whole
 * section costs one click (or one keypress) per image:
 *
 *   - click the subject  → saves and auto-advances (← is the undo path)
 *   - Enter              → accepts the marker as shown (the face-detection
 *                          suggestion when nothing is set) and advances
 *   - ← / →              → navigate without saving
 *   - Backspace / X      → clear the saved focal point (stays put)
 *   - Esc                → done
 *
 * The next image's full-res URL + suggestion are prefetched while you work,
 * so advancing is instant. Used for website sections: the site maps the
 * stored x/y percentages to CSS `object-position` so art-directed crops keep
 * the subject in frame at any aspect ratio (and the editor grid does the
 * same for cropped tiles).
 */
export function FocalPointModal({
  images,
  initialImageId,
  onClose,
  onSaved,
  onBulkSuggest,
}: FocalPointModalProps) {
  const startIndex = Math.max(
    0,
    images.findIndex((i) => i.id === initialImageId)
  );
  const [index, setIndex] = useState(startIndex);
  const image = images[index];

  const [focal, setFocal] = useState<{ x: number; y: number } | null>(null);
  // True while the marker shows the face-detection suggestion (not a pick).
  const [isSuggestion, setIsSuggestion] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuggestingAll, setIsSuggestingAll] = useState(false);
  // Signed full-res URLs + suggestions, cached per image for the session so
  // ←/→ never refetches. Prefetched one ahead.
  const detailCache = useRef<Map<string, ImageDetailLite>>(new Map());
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  // Don't clobber a click the user already made while the detail loaded.
  const userPickedRef = useRef(false);
  const savedCountRef = useRef(0);

  const unsetCount = images.filter((i) => i.focalX == null).length;

  const fetchDetail = useCallback(
    async (imageId: string): Promise<ImageDetailLite | null> => {
      const cached = detailCache.current.get(imageId);
      if (cached) return cached;
      try {
        const res = await fetch(`/api/images/${imageId}`);
        if (!res.ok) return null;
        const d = await res.json();
        const detail: ImageDetailLite = {
          originalUrl: d.originalUrl ?? null,
          suggestedX: d.suggestedFocalX ?? null,
          suggestedY: d.suggestedFocalY ?? null,
        };
        detailCache.current.set(imageId, detail);
        return detail;
      } catch {
        return null;
      }
    },
    []
  );

  // Load the current image (thumb immediately, sharp rendition + suggestion
  // when signed) and prefetch the next one so advancing is instant.
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    userPickedRef.current = false;

    // Initialize the marker from the saved value while details load.
    if (image.focalX != null && image.focalY != null) {
      setFocal({ x: image.focalX, y: image.focalY });
      setIsSuggestion(false);
    } else {
      setFocal(null);
      setIsSuggestion(false);
    }
    setDisplayUrl(image.thumbnailLgUrl || image.thumbnailUrl);

    fetchDetail(image.id).then((detail) => {
      if (cancelled || !detail) return;
      // Videos keep their poster: originalUrl is an mp4 an <img> can't show,
      // and the site applies the focal point to the poster crop anyway.
      if (detail.originalUrl && image.mediaType !== "video") {
        setDisplayUrl(detail.originalUrl);
      }
      if (
        image.focalX == null &&
        !userPickedRef.current &&
        detail.suggestedX != null &&
        detail.suggestedY != null
      ) {
        setIsSuggestion(true);
        setFocal({ x: detail.suggestedX, y: detail.suggestedY });
      }
    });

    // Prefetch the neighbor we're most likely to visit next.
    const next = images[index + 1];
    if (next) fetchDetail(next.id);

    return () => {
      cancelled = true;
    };
    // Re-init when the underlying saved value changes too (e.g. bulk suggest
    // wrote a focal point for the image currently on screen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id, image?.focalX, image?.focalY]);

  const advance = useCallback(() => {
    if (index + 1 < images.length) {
      setIndex(index + 1);
    } else {
      // End of the sweep.
      if (savedCountRef.current > 0) {
        toast.success(
          `Focal sweep done — ${savedCountRef.current} ${
            savedCountRef.current === 1 ? "image" : "images"
          } updated`
        );
      }
      onClose();
    }
  }, [index, images.length, onClose]);

  const save = useCallback(
    async (value: { x: number; y: number } | null, andAdvance: boolean) => {
      if (!image || isSaving) return;
      setIsSaving(true);
      try {
        const res = await fetch(`/api/images/${image.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            focalX: value?.x ?? null,
            focalY: value?.y ?? null,
          }),
        });
        if (!res.ok) throw new Error("Focal point save failed");
        savedCountRef.current++;
        onSaved(image.id, value);
        if (andAdvance) advance();
        else if (value === null) {
          setFocal(null);
          setIsSuggestion(false);
        }
      } catch (err) {
        console.error("Focal point save failed:", err);
        toast.error("Failed to save focal point");
      } finally {
        setIsSaving(false);
      }
    },
    [image, isSaving, onSaved, advance]
  );

  // Click the subject → save + advance. One click per image.
  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    userPickedRef.current = true;
    const picked = {
      x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10,
    };
    setIsSuggestion(false);
    setFocal(picked);
    save(picked, true);
  };

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          e.preventDefault();
          advance();
          break;
        case "ArrowLeft":
          e.preventDefault();
          setIndex((i) => Math.max(0, i - 1));
          break;
        case "Enter":
          e.preventDefault();
          // Accept the marker as shown — saving a suggestion turns it real.
          if (focal) save(focal, true);
          else advance();
          break;
        case "Backspace":
        case "Delete":
        case "x":
          e.preventDefault();
          if (image?.focalX != null) save(null, false);
          break;
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, advance, focal, save, image?.focalX]);

  const handleSuggestAll = async () => {
    if (!onBulkSuggest || isSuggestingAll) return;
    setIsSuggestingAll(true);
    try {
      const count = await onBulkSuggest();
      toast.success(
        count > 0
          ? `Suggested focal points for ${count} ${count === 1 ? "image" : "images"}`
          : "No new suggestions — needs exactly one confident face"
      );
    } catch {
      toast.error("Bulk suggest failed");
    } finally {
      setIsSuggestingAll(false);
    }
  };

  if (typeof window === "undefined" || !image) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        className="mx-4 max-w-3xl bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-stone-100">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
              Focal point · {index + 1} / {images.length}
              {unsetCount > 0 && (
                <span className="ml-2 normal-case tracking-normal text-stone-300">
                  {unsetCount} unset
                </span>
              )}
            </p>
            <p className="truncate text-[13px] text-stone-600">
              Click the subject — saves and moves to the next image
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onBulkSuggest && unsetCount > 0 && (
              <button
                onClick={handleSuggestAll}
                disabled={isSuggestingAll}
                className="mr-2 flex items-center gap-1.5 border border-stone-200 px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900 disabled:opacity-40"
                title="Write face-detection suggestions to every image without a focal point"
              >
                <Sparkles className="h-3 w-3" />
                {isSuggestingAll ? "Suggesting…" : "Suggest all"}
              </button>
            )}
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
              className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors disabled:opacity-30"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={advance}
              className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Next image"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-900 transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="bg-stone-950 flex items-center justify-center">
          {/* Marker is positioned in % of the IMAGE, so the wrapper must hug it. */}
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={image.id}
              src={displayUrl ?? image.thumbnailUrl}
              alt="Pick focal point"
              onClick={handleImageClick}
              className="max-h-[70vh] max-w-full cursor-crosshair select-none"
              draggable={false}
            />
            {focal && (
              <span
                className={`pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-[0_0_0_2px_rgba(0,0,0,0.4)] ${
                  isSuggestion ? "border-white/70 border-dashed" : "border-accent"
                }`}
                style={{ left: `${focal.x}%`, top: `${focal.y}%` }}
              >
                <span
                  className={`absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                    isSuggestion ? "bg-white/70" : "bg-accent"
                  }`}
                />
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-stone-100">
          <p className="text-[11px] text-stone-400 tabular-nums">
            {isSaving
              ? "Saving…"
              : focal
              ? isSuggestion
                ? `${focal.x}%, ${focal.y}% — suggested · Enter to accept`
                : `${focal.x}%, ${focal.y}%`
              : "Not set — crops center on the image"}
          </p>
          <p className="shrink-0 text-[11px] text-stone-300">
            <kbd className="font-sans">←</kbd> <kbd className="font-sans">→</kbd>{" "}
            navigate · <kbd className="font-sans">Enter</kbd> accept ·{" "}
            <kbd className="font-sans">⌫</kbd> clear ·{" "}
            <kbd className="font-sans">Esc</kbd> done
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
