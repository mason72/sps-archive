"use client";

import { useState } from "react";
import { ImageIcon, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COVER_LAYOUTS, type CoverLayout } from "@/types/event-settings";

interface CoverImage {
  id: string;
  thumbnailUrl: string;
  originalFilename: string;
}

interface CoverLayoutTabProps {
  value: CoverLayout;
  onChange: (layout: CoverLayout) => void;
  /** Currently selected cover image URL (thumbnail) */
  coverImageUrl?: string;
  /** Selected cover image ID */
  coverImageId?: string;
  /** Available images for cover selection */
  images?: CoverImage[];
  /** Called when cover image is selected */
  onCoverImageChange?: (imageId: string) => void;
  /** Event ID for uploading a new cover image */
  eventId?: string;
}

/**
 * CoverLayoutTab — Grid of 12 cover layout options + cover image picker.
 * Each option shows a small rectangular thumbnail representing the layout.
 * When a cover image is selected, layout previews show the actual photo.
 */
export function CoverLayoutTab({
  value,
  onChange,
  coverImageUrl,
  coverImageId,
  images,
  onCoverImageChange,
  eventId,
}: CoverLayoutTabProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleCoverUpload = async (file: File) => {
    if (!eventId || !onCoverImageChange) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setIsUploading(true);
    try {
      // Step 1: Create image record
      const metaRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!metaRes.ok) throw new Error("Failed to create upload");
      const { imageId } = await metaRes.json();

      // Step 2: Upload binary
      const uploadRes = await fetch(`/api/upload/${imageId}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file");

      // Step 3: Set as cover
      onCoverImageChange(imageId);
      toast.success("Cover image uploaded");
    } catch {
      toast.error("Failed to upload cover image");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <h3 className="text-[15px] font-medium text-stone-900 mb-1">Cover</h3>
      <p className="text-[12px] text-stone-400 mb-4">
        Choose how the cover image is displayed on the gallery page.
      </p>

      {/* ─── Cover image selector ─── */}
      {onCoverImageChange && (
        <div className="mb-6">
          {/* Upload cover image */}
          {eventId && (
            <label className="flex items-center gap-2 mb-2 px-3 py-2.5 border border-dashed border-stone-300 hover:border-stone-400 cursor-pointer transition-colors text-[12px] text-stone-500 hover:text-stone-700">
              <Upload size={14} />
              {isUploading ? "Uploading…" : "Upload cover image"}
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

          {images && images.length > 0 && (
            <>
              <button
                onClick={() => setShowPicker((v) => !v)}
                className="flex items-center gap-3 w-full p-3 border border-stone-200 hover:border-stone-400 transition-colors"
              >
                {coverImageUrl ? (
                  <img
                    src={coverImageUrl}
                    alt="Cover"
                    className="w-12 h-12 object-cover bg-stone-100 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 bg-stone-100 flex items-center justify-center shrink-0">
                    <ImageIcon size={16} className="text-stone-300" />
                  </div>
                )}
                <div className="text-left flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-stone-700">
                    {coverImageUrl ? "Change cover image" : "Choose from gallery"}
                  </p>
                  <p className="text-[11px] text-stone-400 truncate">
                    {coverImageUrl ? "Click to select a different photo" : "Select a photo for the gallery cover"}
                  </p>
                </div>
              </button>

              {/* Image picker grid */}
              {showPicker && (
                <div className="mt-2 max-h-48 overflow-y-auto border border-stone-200 p-2">
                  <div className="grid grid-cols-4 gap-1">
                    {images.map((img) => (
                      <button
                        key={img.id}
                        onClick={() => {
                          onCoverImageChange(img.id);
                          setShowPicker(false);
                        }}
                        className={cn(
                          "relative aspect-square overflow-hidden bg-stone-100",
                          coverImageId === img.id && "ring-2 ring-accent"
                        )}
                      >
                        <img
                          src={img.thumbnailUrl}
                          alt={img.originalFilename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {coverImageId === img.id && (
                          <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
                            <Check size={16} className="text-white drop-shadow" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Layout options grid ─── */}
      <div className="grid grid-cols-2 gap-4">
        {COVER_LAYOUTS.map((layout) => (
          <button
            key={layout.value}
            onClick={() => onChange(layout.value)}
            className={cn(
              "group flex flex-col items-center gap-2 p-3 border transition-all duration-200",
              value === layout.value
                ? "border-stone-900 bg-stone-50"
                : "border-stone-200 hover:border-stone-400"
            )}
          >
            {/* Layout thumbnail preview */}
            <div className="w-full aspect-[4/3] bg-stone-100 relative overflow-hidden">
              {coverImageUrl ? (
                <CoverImagePreview
                  layout={layout.value}
                  imageUrl={coverImageUrl}
                  isActive={value === layout.value}
                />
              ) : (
                <LayoutPreview layout={layout.value} isActive={value === layout.value} />
              )}
            </div>
            <span
              className={cn(
                "text-[11px] font-medium tracking-wide",
                value === layout.value ? "text-stone-900" : "text-stone-500"
              )}
            >
              {layout.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Preview layout with the actual cover image */
function CoverImagePreview({
  layout,
  imageUrl,
  isActive,
}: {
  layout: CoverLayout;
  imageUrl: string;
  isActive: boolean;
}) {
  const text = isActive ? "bg-stone-600" : "bg-stone-400";

  switch (layout) {
    case "center":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-1">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          <div className={`h-0.5 w-8 ${text} shrink-0`} />
        </div>
      );
    case "love":
      return (
        <div className="absolute inset-0 flex gap-0.5 p-1">
          <img src={imageUrl} alt="" className="flex-1 object-cover" />
          <img src={imageUrl} alt="" className="flex-1 object-cover" style={{ objectPosition: "right" }} />
        </div>
      );
    case "left":
      return (
        <div className="absolute inset-0 flex gap-1 p-1">
          <img src={imageUrl} alt="" className="flex-[2] object-cover" />
          <div className="flex-1 flex flex-col justify-end gap-0.5">
            <div className={`h-0.5 w-full ${text}`} />
            <div className={`h-0.5 w-3/4 ${text}`} />
          </div>
        </div>
      );
    default:
      return (
        <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      );
  }
}

/** Simple abstract representation of each cover layout */
function LayoutPreview({ layout, isActive }: { layout: CoverLayout; isActive: boolean }) {
  const bg = isActive ? "bg-stone-400" : "bg-stone-300";
  const text = isActive ? "bg-stone-600" : "bg-stone-400";

  switch (layout) {
    case "center":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
          <div className={`w-full h-full ${bg}`} />
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "love":
      return (
        <div className="absolute inset-0 flex gap-1 p-2">
          <div className={`flex-1 ${bg}`} />
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "left":
      return (
        <div className="absolute inset-0 flex gap-1 p-2">
          <div className={`flex-[2] ${bg}`} />
          <div className="flex-1 flex flex-col justify-end gap-1">
            <div className={`h-1 w-full ${text}`} />
            <div className={`h-1 w-3/4 ${text}`} />
          </div>
        </div>
      );
    case "novel":
      return (
        <div className="absolute inset-0 flex p-2">
          <div className="flex-1 flex flex-col items-center justify-center gap-1">
            <div className={`h-1 w-12 ${text}`} />
          </div>
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "vintage":
      return (
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <div className={`w-3/4 h-3/4 ${bg} border-2 border-stone-200`} />
        </div>
      );
    case "frame":
      return (
        <div className={`absolute inset-0 ${bg} flex items-center justify-center`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    case "stripe":
      return (
        <div className="absolute inset-0 flex flex-col p-2 gap-1">
          <div className={`h-0.5 w-full ${text}`} />
          <div className={`flex-1 ${bg}`} />
          <div className={`h-0.5 w-full ${text}`} />
        </div>
      );
    case "divider":
      return (
        <div className="absolute inset-0 flex gap-0.5 p-2">
          <div className={`flex-1 ${bg}`} />
          <div className={`w-0.5 ${text}`} />
          <div className={`flex-1 ${bg}`} />
        </div>
      );
    case "journal":
      return (
        <div className="absolute inset-0 flex flex-col p-2 gap-1">
          <div className={`flex-[2] ${bg}`} />
          <div className="flex items-center gap-1">
            <div className={`h-1 w-8 ${text}`} />
          </div>
        </div>
      );
    case "stamp":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 gap-1">
          <div className={`w-10 h-10 ${bg}`} />
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "outline":
      return (
        <div className="absolute inset-2 border-2 border-stone-300 flex items-center justify-center">
          <div className={`h-1 w-8 ${text}`} />
        </div>
      );
    case "classic":
      return (
        <div className={`absolute inset-0 ${bg} flex items-end p-2`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    default:
      return <div className={`absolute inset-0 ${bg}`} />;
  }
}
