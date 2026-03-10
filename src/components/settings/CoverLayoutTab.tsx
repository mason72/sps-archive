"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COVER_LAYOUTS, type CoverLayout } from "@/types/event-settings";

interface CoverLayoutTabProps {
  value: CoverLayout;
  onChange: (layout: CoverLayout) => void;
  /** Currently selected cover image URL (thumbnail) */
  coverImageUrl?: string;
  /** Selected cover image ID */
  coverImageId?: string;
  /** Called when cover image is selected */
  onCoverImageChange?: (imageId: string) => void;
  /** Event ID for uploading a new cover image */
  eventId?: string;
  /** Called after a cover image upload completes so parent can refresh its image list */
  onUploadComplete?: () => void;
  /** Number of images in mosaic (5-30) */
  mosaicImageCount?: number;
  /** Called when mosaic image count changes */
  onMosaicImageCountChange?: (count: number) => void;
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
  onCoverImageChange,
  eventId,
  onUploadComplete,
  mosaicImageCount = 5,
  onMosaicImageCountChange,
}: CoverLayoutTabProps) {
  const [isUploading, setIsUploading] = useState(false);
  // Temporary local URL for a just-uploaded cover image (before thumbnails are generated)
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);

  // Resolve cover image URL: prefer prop, fall back to local preview
  const resolvedCoverUrl = coverImageUrl || uploadedPreviewUrl || undefined;

  const handleCoverUpload = async (file: File) => {
    if (!eventId || !onCoverImageChange) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setIsUploading(true);
    try {
      // Step 1: Create image record (must match /api/upload expected format)
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

      // Step 2: Upload binary directly to R2 via presigned URL
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Failed to upload file");

      // Step 3: Mark upload complete (API expects singular imageId)
      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });

      // Step 4: Create a local blob URL for immediate preview
      const previewUrl = URL.createObjectURL(file);
      setUploadedPreviewUrl(previewUrl);

      // Step 5: Set as cover
      onCoverImageChange(imageId);
      toast.success("Cover image uploaded");

      // Step 6: Refresh parent's image list after a delay
      // (thumbnails are generated async, give them a moment)
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
      <p className="text-[12px] text-stone-400 mb-4">
        Choose how the cover image is displayed on the gallery page.
      </p>

      {/* ─── None notice ─── */}
      {value === "none" && (
        <div className="mb-6 p-4 bg-stone-50 border border-stone-200">
          <p className="text-[13px] font-medium text-stone-700 mb-1">No cover image</p>
          <p className="text-[12px] text-stone-400 leading-relaxed">
            The gallery will open directly with the title and photo grid — no hero section.
          </p>
        </div>
      )}

      {/* ─── Mosaic auto-select notice + image count slider ─── */}
      {value === "mosaic" && (
        <div className="mb-6 p-4 bg-stone-50 border border-stone-200">
          <p className="text-[13px] font-medium text-stone-700 mb-1">AI-powered cover</p>
          <p className="text-[12px] text-stone-400 leading-relaxed mb-4">
            Smart Mosaic automatically selects your highest-rated photos and arranges them in a magazine-style grid. No image selection needed.
          </p>
          {onMosaicImageCountChange && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12px] font-medium text-stone-600">
                  Number of images
                </label>
                <span className="text-[12px] font-medium text-stone-900 tabular-nums">
                  {mosaicImageCount}
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={30}
                value={mosaicImageCount}
                onChange={(e) => onMosaicImageCountChange(Number(e.target.value))}
                className="w-full h-1 bg-stone-200 rounded-full appearance-none cursor-pointer accent-stone-900 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-stone-900 [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-stone-400">5</span>
                <span className="text-[10px] text-stone-400">30</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Cover image selector ─── */}
      {onCoverImageChange && value !== "mosaic" && value !== "none" && (
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

          {/* Cover image preview */}
          {resolvedCoverUrl && (
            <div className="flex items-center gap-3 p-3 border border-stone-200">
              <img
                src={resolvedCoverUrl}
                alt="Cover"
                className="w-12 h-12 object-cover bg-stone-100 shrink-0"
              />
              <p className="text-[12px] text-stone-500">Current cover image</p>
            </div>
          )}
        </div>
      )}

      {/* ─── Layout options grid ─── */}
      <div className="grid grid-cols-2 gap-3">
        {COVER_LAYOUTS.map((layout) => (
          <button
            key={layout.value}
            onClick={() => onChange(layout.value)}
            className={cn(
              "group flex flex-col items-center gap-2 p-2 border transition-all duration-200",
              value === layout.value
                ? "border-stone-900 bg-stone-50 shadow-sm"
                : "border-stone-200 hover:border-stone-400"
            )}
          >
            {/* Layout thumbnail preview */}
            <div className="w-full aspect-[3/4] bg-stone-100 relative overflow-hidden">
              {resolvedCoverUrl ? (
                <CoverImagePreview
                  layout={layout.value}
                  imageUrl={resolvedCoverUrl}
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
    case "none":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
          <div className={`h-1 w-10 ${text}`} />
          <div className={`h-0.5 w-6 bg-stone-200`} />
        </div>
      );
    case "center":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-1">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          <div className={`h-0.5 w-8 ${text} shrink-0`} />
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
    case "mosaic":
      return (
        <div className="absolute inset-0 grid grid-cols-4 grid-rows-2 gap-0.5 p-0.5">
          <img src={imageUrl} alt="" className="col-span-2 row-span-2 w-full h-full object-cover" />
          <img src={imageUrl} alt="" className="w-full h-full object-cover" style={{ objectPosition: "left" }} />
          <img src={imageUrl} alt="" className="w-full h-full object-cover" style={{ objectPosition: "right" }} />
          <img src={imageUrl} alt="" className="w-full h-full object-cover" style={{ objectPosition: "top" }} />
          <img src={imageUrl} alt="" className="w-full h-full object-cover" style={{ objectPosition: "bottom" }} />
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
    case "none":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
          <div className={`h-1 w-10 ${text}`} />
          <div className={`h-0.5 w-6 ${isActive ? "bg-stone-300" : "bg-stone-200"}`} />
          <div className="flex gap-0.5 mt-1">
            <div className={`w-3 h-3 ${isActive ? "bg-stone-200" : "bg-stone-150"} bg-stone-200`} />
            <div className={`w-3 h-3 ${isActive ? "bg-stone-200" : "bg-stone-150"} bg-stone-200`} />
            <div className={`w-3 h-3 ${isActive ? "bg-stone-200" : "bg-stone-150"} bg-stone-200`} />
          </div>
        </div>
      );
    case "center":
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3">
          <div className={`w-full h-full ${bg}`} />
          <div className={`h-1 w-8 ${text}`} />
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
    case "frame":
      return (
        <div className={`absolute inset-0 ${bg} flex items-center justify-center`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    case "classic":
      return (
        <div className={`absolute inset-0 ${bg} flex items-end p-2`}>
          <div className={`h-1 w-10 bg-white`} />
        </div>
      );
    case "mosaic":
      return (
        <div className="absolute inset-0 grid grid-cols-4 grid-rows-2 gap-0.5 p-1.5">
          <div className={`col-span-2 row-span-2 ${isActive ? "bg-stone-500" : "bg-stone-350"} ${bg}`} />
          <div className={bg} />
          <div className={bg} />
          <div className={bg} />
          <div className={bg} />
        </div>
      );
    default:
      return <div className={`absolute inset-0 ${bg}`} />;
  }
}
