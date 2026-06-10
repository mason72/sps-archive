"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { toast } from "sonner";

interface FocalPointModalProps {
  imageId: string;
  /** Grid thumbnail — shown immediately while the sharper display URL loads. */
  thumbnailUrl: string;
  /** Current focal point (0–100 percentages), if any. */
  initialFocal: { x: number; y: number } | null;
  onClose: () => void;
  /** Called after a successful save with the new value (null = cleared). */
  onSaved: (focal: { x: number; y: number } | null) => void;
}

/**
 * FocalPointModal — click the subject to set an image's focal point.
 *
 * Used for website SLOT sections (explicit single-image positions): the site
 * maps the stored x/y percentages to CSS `object-position` so art-directed
 * crops keep the subject in frame at any aspect ratio.
 */
export function FocalPointModal({
  imageId,
  thumbnailUrl,
  initialFocal,
  onClose,
  onSaved,
}: FocalPointModalProps) {
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(initialFocal);
  const [displayUrl, setDisplayUrl] = useState<string>(thumbnailUrl);
  const [isSaving, setIsSaving] = useState(false);

  // Swap in the sharper display rendition once it's signed — picking a focal
  // point on a 400px thumb is guesswork on detailed shots.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/images/${imageId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((detail) => {
        if (!cancelled && detail?.originalUrl) setDisplayUrl(detail.originalUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setFocal({
      x: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
      y: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10,
    });
  };

  const handleSave = async (value: { x: number; y: number } | null) => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/images/${imageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focalX: value?.x ?? null,
          focalY: value?.y ?? null,
        }),
      });
      if (!res.ok) throw new Error("Focal point save failed");
      toast.success(value ? "Focal point saved" : "Focal point cleared");
      onSaved(value);
      onClose();
    } catch (err) {
      console.error("Focal point save failed:", err);
      toast.error("Failed to save focal point");
    } finally {
      setIsSaving(false);
    }
  };

  if (typeof window === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm fade-in"
      onClick={onClose}
    >
      <div
        className="mx-4 max-w-3xl bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-medium">
              Focal point
            </p>
            <p className="text-[13px] text-stone-600">
              Click the subject — the website keeps it in frame when cropping
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

        <div className="bg-stone-950 flex items-center justify-center">
          {/* Marker is positioned in % of the IMAGE, so the wrapper must hug it. */}
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt="Pick focal point"
              onClick={handleImageClick}
              className="max-h-[70vh] max-w-full cursor-crosshair select-none"
              draggable={false}
            />
            {focal && (
              <span
                className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent shadow-[0_0_0_2px_rgba(0,0,0,0.4)]"
                style={{ left: `${focal.x}%`, top: `${focal.y}%` }}
              >
                <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-stone-100">
          <p className="text-[11px] text-stone-400 tabular-nums">
            {focal ? `${focal.x}%, ${focal.y}%` : "Not set — crops center on the image"}
          </p>
          <div className="flex items-center gap-2">
            {initialFocal && (
              <button
                onClick={() => handleSave(null)}
                disabled={isSaving}
                className="px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-900 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] text-stone-500 hover:text-stone-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => focal && handleSave(focal)}
              disabled={!focal || isSaving}
              className="px-4 py-1.5 bg-stone-900 text-white text-[12px] uppercase tracking-[0.15em] font-medium hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
