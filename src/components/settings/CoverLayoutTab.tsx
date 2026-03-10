"use client";

import { useState } from "react";
import { Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { TitlePosition, TitleAlignment, TitlePlacement } from "@/types/event-settings";

interface CoverLayoutTabProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  titlePosition: TitlePosition;
  onTitlePositionChange: (pos: TitlePosition) => void;
  titleAlignment: TitleAlignment;
  onTitleAlignmentChange: (align: TitleAlignment) => void;
  titlePlacement?: TitlePlacement;
  onTitlePlacementChange?: (placement: TitlePlacement) => void;
  coverImageUrl?: string;
  onCoverImageChange?: (imageId: string) => void;
  eventId?: string;
  onUploadComplete?: () => void;
}

export function CoverLayoutTab({
  enabled,
  onEnabledChange,
  titlePosition,
  onTitlePositionChange,
  titleAlignment,
  onTitleAlignmentChange,
  titlePlacement,
  onTitlePlacementChange,
  coverImageUrl,
  onCoverImageChange,
  eventId,
  onUploadComplete,
}: CoverLayoutTabProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);

  const resolvedCoverUrl = coverImageUrl || uploadedPreviewUrl || undefined;

  const handleCoverUpload = async (file: File) => {
    if (!eventId || !onCoverImageChange) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setIsUploading(true);
    try {
      const metaRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          files: [{ name: file.name, type: file.type, size: file.size }],
        }),
      });
      if (!metaRes.ok) throw new Error("Failed to create upload");
      const { uploads } = await metaRes.json();
      const { imageId, uploadUrl } = uploads[0];

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file");

      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });

      const previewUrl = URL.createObjectURL(file);
      setUploadedPreviewUrl(previewUrl);
      onCoverImageChange(imageId);
      toast.success("Cover image uploaded");

      setTimeout(() => {
        onUploadComplete?.();
      }, 3000);
    } catch {
      toast.error("Failed to upload cover image");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Cover</h3>
      <p className="text-[12px] text-stone-400 mb-5">
        Add a hero image to the top of your gallery.
      </p>

      {/* ─── Enable toggle ─── */}
      <label className="flex items-center justify-between mb-6 cursor-pointer group">
        <span className="text-[13px] font-medium text-stone-700 group-hover:text-stone-900 transition-colors">
          Use cover image
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => onEnabledChange(!enabled)}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 cursor-pointer",
            enabled ? "bg-stone-900" : "bg-stone-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200",
              enabled ? "translate-x-[18px]" : "translate-x-[3px]"
            )}
          />
        </button>
      </label>

      {enabled && (
        <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* ─── Cover image upload ─── */}
          {onCoverImageChange && eventId && (
            <div>
              <p className="text-[12px] font-medium text-stone-600 mb-2">Cover image</p>
              {resolvedCoverUrl ? (
                <div className="relative group/cover">
                  <img
                    src={resolvedCoverUrl}
                    alt="Cover"
                    className="w-full aspect-[16/9] object-cover bg-stone-100 border border-stone-200"
                  />
                  <label className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/cover:bg-black/40 transition-colors cursor-pointer">
                    <span className="text-[12px] font-medium text-white opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center gap-1.5">
                      <Upload size={14} />
                      Replace
                    </span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={isUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCoverUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-stone-200 hover:border-stone-400 cursor-pointer transition-colors">
                  <ImageIcon size={24} className="text-stone-300" />
                  <span className="text-[12px] text-stone-400">
                    {isUploading ? "Uploading…" : "Click to upload a cover image"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={isUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCoverUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* ─── Title position ─── */}
          <div>
            <p className="text-[12px] font-medium text-stone-600 mb-2">Title position</p>
            <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 rounded">
              {(["above", "over", "below"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => onTitlePositionChange(pos)}
                  className={cn(
                    "py-1.5 text-[11px] font-medium rounded transition-all duration-150 cursor-pointer",
                    titlePosition === pos
                      ? "bg-white text-stone-900 shadow-sm"
                      : "text-stone-500 hover:text-stone-700"
                  )}
                >
                  {pos === "above" ? "Above" : pos === "over" ? "On Image" : "Below"}
                </button>
              ))}
            </div>
          </div>

          {/* ─── Title alignment (for above/below) ─── */}
          {(titlePosition === "above" || titlePosition === "below") && (
            <div>
              <p className="text-[12px] font-medium text-stone-600 mb-2">Title alignment</p>
              <div className="grid grid-cols-3 gap-1 p-1 bg-stone-100 rounded">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    onClick={() => onTitleAlignmentChange(align)}
                    className={cn(
                      "py-1.5 text-[11px] font-medium rounded transition-all duration-150 cursor-pointer",
                      titleAlignment === align
                        ? "bg-white text-stone-900 shadow-sm"
                        : "text-stone-500 hover:text-stone-700"
                    )}
                  >
                    {align.charAt(0).toUpperCase() + align.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ─── Title placement grid (for "on image") ─── */}
          {titlePosition === "over" && onTitlePlacementChange && (
            <div>
              <p className="text-[12px] font-medium text-stone-600 mb-2">Title placement</p>
              <div className="grid grid-cols-3 gap-1 p-2 bg-stone-100 rounded aspect-[16/9]">
                {(["top", "center", "bottom"] as const).map((v) =>
                  (["left", "center", "right"] as const).map((h) => {
                    const isSelected =
                      (titlePlacement?.vertical || "center") === v &&
                      (titlePlacement?.horizontal || "center") === h;
                    return (
                      <button
                        key={`${v}-${h}`}
                        onClick={() => onTitlePlacementChange({ vertical: v, horizontal: h })}
                        className={cn(
                          "flex items-center justify-center rounded transition-all duration-150 cursor-pointer",
                          isSelected
                            ? "bg-stone-900"
                            : "bg-stone-200/60 hover:bg-stone-300/80"
                        )}
                      >
                        <div
                          className={cn(
                            "w-2 h-2 rounded-full transition-colors",
                            isSelected ? "bg-white" : "bg-stone-400"
                          )}
                        />
                      </button>
                    );
                  })
                )}
              </div>
              <p className="text-[10px] text-stone-400 mt-1.5 text-center">
                Choose where the title appears on the cover image
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
