"use client";

import { useState, useEffect, useRef } from "react";
import { ImageIcon, Check, Upload, Search, X } from "lucide-react";
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
  /** Called after a cover image upload completes so parent can refresh its image list */
  onUploadComplete?: () => void;
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
  onUploadComplete,
}: CoverLayoutTabProps) {
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Temporary local URL for a just-uploaded cover image (before thumbnails are generated)
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
  const [uploadedPreviewId, setUploadedPreviewId] = useState<string | null>(null);

  // Clear local preview once the uploaded image appears in the images array
  useEffect(() => {
    if (
      uploadedPreviewId &&
      images?.some((img) => img.id === uploadedPreviewId)
    ) {
      setUploadedPreviewUrl(null);
      setUploadedPreviewId(null);
    }
  }, [images, uploadedPreviewId]);

  // Resolve cover image URL: prefer images array, fall back to local preview
  const resolvedCoverUrl =
    coverImageUrl ||
    (coverImageId === uploadedPreviewId ? uploadedPreviewUrl : null) ||
    undefined;

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
      setUploadedPreviewId(imageId);

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
      {/* ─── Full-screen gallery modal ─── */}
      {showGalleryModal && images && onCoverImageChange && (
        <CoverImageGalleryModal
          images={images}
          currentImageId={coverImageId}
          onSelect={(imageId) => {
            onCoverImageChange(imageId);
            setShowGalleryModal(false);
          }}
          onClose={() => setShowGalleryModal(false)}
        />
      )}

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

      {/* ─── Mosaic auto-select notice ─── */}
      {value === "mosaic" && (
        <div className="mb-6 p-4 bg-stone-50 border border-stone-200">
          <p className="text-[13px] font-medium text-stone-700 mb-1">AI-powered cover</p>
          <p className="text-[12px] text-stone-400 leading-relaxed">
            Smart Mosaic automatically selects your highest-rated photos and arranges them in a magazine-style grid. No image selection needed.
          </p>
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

          {typeof onCoverImageChange === "function" && (
            <button
              onClick={() => setShowGalleryModal(true)}
              className="flex items-center gap-3 w-full p-3 border border-stone-200 hover:border-stone-400 transition-colors"
            >
              {resolvedCoverUrl ? (
                <img
                  src={resolvedCoverUrl}
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
                  {resolvedCoverUrl ? "Change cover image" : "Choose from gallery"}
                </p>
                <p className="text-[11px] text-stone-400 truncate">
                  {resolvedCoverUrl ? "Click to select a different photo" : "Search and select a photo"}
                </p>
              </div>
            </button>
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

/** Full-screen modal for choosing a cover image from the gallery */
function CoverImageGalleryModal({
  images,
  currentImageId,
  onSelect,
  onClose,
}: {
  images: CoverImage[];
  currentImageId?: string;
  onSelect: (imageId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = search.trim()
    ? images.filter((img) =>
        img.originalFilename.toLowerCase().includes(search.toLowerCase())
      )
    : images;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={onClose}>
      <div
        className="flex-1 flex flex-col max-w-6xl w-full mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by filename…"
              className="w-full pl-10 pr-4 py-2.5 bg-white/10 backdrop-blur text-white text-[14px] placeholder:text-stone-500 border border-white/10 focus:border-white/30 outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <span className="text-[12px] text-stone-500 tabular-nums shrink-0">
            {filtered.length.toLocaleString()} {filtered.length === 1 ? "image" : "images"}
          </span>
          <button
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-[14px] text-stone-500">
                {search ? "No images match your search" : "No images available"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
              {filtered.map((img) => (
                <button
                  key={img.id}
                  onClick={() => onSelect(img.id)}
                  className={cn(
                    "relative aspect-square overflow-hidden group transition-all",
                    currentImageId === img.id
                      ? "ring-2 ring-white ring-offset-2 ring-offset-black"
                      : "hover:ring-1 hover:ring-white/50"
                  )}
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.originalFilename}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                  {currentImageId === img.id && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <Check size={20} className="text-white" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-1.5">
                    <p className="text-[10px] text-white truncate">
                      {img.originalFilename}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
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
