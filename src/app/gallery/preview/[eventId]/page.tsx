"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { Download, ChevronLeft, ChevronRight, X, Eye } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { toast } from "sonner";
import type { GalleryData, GalleryImage, GalleryBranding } from "@/types/gallery";

/* ─── Font class mappings ─── */
const HEADING_FONT_CLASS: Record<string, string> = {
  playfair: "font-editorial",
  inter: "font-sans",
  cormorant: "font-cormorant",
  "dm-serif": "font-dm-serif",
  "space-grotesk": "font-space-grotesk",
};

const BODY_FONT_CLASS: Record<string, string> = {
  inter: "font-sans",
  "source-serif": "font-source-serif",
  lora: "font-lora",
  "dm-sans": "font-dm-sans",
};

/** Cover section — displays a hero cover image above the gallery header */
function CoverSection({
  imageUrl,
  layout,
  eventName,
  headingClass,
  primaryColor,
  mosaicImageUrls,
}: {
  imageUrl?: string;
  layout: string;
  eventName: string;
  headingClass: string;
  primaryColor?: string;
  mosaicImageUrls?: string[];
}) {
  // ─── Mosaic layout (scalable 5-30 images) ───
  if (layout === "mosaic" && mosaicImageUrls && mosaicImageUrls.length > 0) {
    const urls = mosaicImageUrls;
    const tiles = urls.slice(1);
    const gridCols =
      tiles.length <= 4
        ? "grid-cols-2"
        : tiles.length <= 9
          ? "grid-cols-3"
          : "grid-cols-4";

    return (
      <div className="flex flex-col md:flex-row h-[50vh] md:h-[65vh] gap-0.5 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={urls[0]}
          alt=""
          className="w-full md:w-[40%] h-[40%] md:h-full object-cover mosaic-tile-in shrink-0"
          style={{ animationDelay: "0ms" }}
        />
        <div className={`flex-1 grid ${gridCols} gap-0.5 overflow-hidden`}>
          {tiles.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={url}
              alt=""
              className="w-full h-full object-cover mosaic-tile-in"
              style={{ animationDelay: `${(i + 1) * 60}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!imageUrl) return null;

  if (layout === "left") {
    return (
      <div className="flex flex-col md:flex-row min-h-[60vh]">
        <div className="md:w-1/2 flex items-center justify-center p-12 md:p-16">
          <h1
            className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95]`}
            style={{ color: primaryColor }}
          >
            {eventName}
          </h1>
        </div>
        <div className="md:w-1/2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="w-full h-full object-cover ken-burns-settle" />
        </div>
      </div>
    );
  }

  if (layout === "frame") {
    return (
      <div className="px-8 md:px-16 pt-12">
        <div className="relative aspect-[16/7] overflow-hidden bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="w-full h-full object-cover ken-burns-settle" />
          <div className="absolute inset-0 border-[8px] md:border-[16px] border-white pointer-events-none" />
        </div>
      </div>
    );
  }

  if (layout === "classic") {
    return (
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="w-full h-full object-cover ken-burns-settle" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-16">
          <h1 className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95] text-white`}>
            {eventName}
          </h1>
        </div>
      </div>
    );
  }

  // Default: "center" layout
  return (
    <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" className="w-full h-full object-cover ken-burns-settle" />
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 flex items-center justify-center text-center p-8">
        <h1 className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95] text-white`}>
          {eventName}
        </h1>
      </div>
    </div>
  );
}

export default function PreviewGalleryPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  const fetchGallery = useCallback(async () => {
    try {
      const res = await fetch(`/api/gallery/preview/${eventId}`, {
        cache: "no-store",
      });

      if (res.status === 401 || res.status === 403) {
        setError("You don't have permission to preview this gallery.");
        return;
      }
      if (res.status === 404) {
        setError("Event not found.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load preview.");
        return;
      }

      const data = await res.json();
      setGallery(data);
    } catch {
      setError("Failed to load preview.");
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  useEffect(() => {
    if (selectedImageId && lightboxRef.current) {
      lightboxRef.current.focus();
    }
  }, [selectedImageId]);

  const handleIndividualDownload = (image: GalleryImage) => {
    if (image.downloadUrl) {
      const link = document.createElement("a");
      link.href = image.downloadUrl;
      link.download = image.originalFilename;
      link.click();
      toast.success("Downloaded", { description: image.originalFilename });
    }
  };

  const selectedImage = gallery?.images.find((img) => img.id === selectedImageId);
  const selectedIndex = gallery?.images.findIndex((img) => img.id === selectedImageId) ?? -1;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-900 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[13px] text-stone-400">Loading preview...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-8">
        <div className="text-center max-w-sm">
          <h1 className="font-editorial text-[28px] text-stone-900 mb-2">
            Preview <span className="italic font-normal">unavailable</span>
          </h1>
          <p className="text-[14px] text-stone-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!gallery) return null;

  const b = gallery.branding;
  const s = gallery.settings;

  const headingClass = HEADING_FONT_CLASS[s?.headingFont || "playfair"] || "font-editorial";
  const bodyClass = BODY_FONT_CLASS[s?.bodyFont || "inter"] || "font-sans";

  // Event-level color settings override branding defaults
  const colors = {
    primary: s?.colorPrimary || b?.primaryColor || "#1C1917",
    secondary: s?.colorSecondary || b?.secondaryColor || "#78716C",
    accent: s?.colorAccent || b?.accentColor || "#10B981",
    background: s?.colorBackground || b?.backgroundColor || "#FFFFFF",
  };

  const hasMosaic = s?.coverLayout === "mosaic" && (s?.mosaicImageUrls?.length ?? 0) > 0;
  const hasCover = hasMosaic || !!(s?.coverImageUrl && s?.coverLayout && s?.coverLayout !== "none");
  const coverRendersTitle = hasCover && !hasMosaic && (s?.coverLayout === "center" || s?.coverLayout === "classic" || s?.coverLayout === "left");

  const brandStyles = {
    "--brand-primary": colors.primary,
    "--brand-secondary": colors.secondary,
    "--brand-accent": colors.accent,
    "--brand-bg": colors.background,
  } as React.CSSProperties;

  return (
    <div className={`min-h-screen ${bodyClass}`} style={{ ...brandStyles, backgroundColor: colors.background }}>
      {/* ─── Preview mode banner ─── */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-amber-400 text-amber-900 text-center py-1.5 px-4 flex items-center justify-center gap-2">
        <Eye size={14} strokeWidth={2} />
        <span className="text-[12px] font-medium tracking-wide">PREVIEW MODE — Only you can see this</span>
      </div>
      {/* Spacer for fixed banner */}
      <div className="h-8" />

      {/* ─── Cover image ─── */}
      {hasCover && (
        <CoverSection
          imageUrl={s?.coverImageUrl}
          layout={s!.coverLayout!}
          eventName={gallery.eventName}
          headingClass={headingClass}
          primaryColor={colors.primary}
          mosaicImageUrls={s?.mosaicImageUrls}
        />
      )}

      {/* ─── Branded header ─── */}
      <header className="px-8 md:px-16 pt-12 pb-8">
        {b && (b.logoUrl || b.businessName) && (
          <div
            className={`flex items-center gap-3 mb-8 ${
              b.logoPlacement === "center" ? "justify-center" : "justify-start"
            }`}
          >
            {b.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={b.logoUrl}
                alt={b.businessName || "Photographer"}
                className="h-10 w-auto object-contain"
              />
            )}
            {b.businessName && !b.logoUrl && (
              <span
                className="text-[15px] font-medium tracking-wide uppercase"
                style={{ color: b.secondaryColor }}
              >
                {b.businessName}
              </span>
            )}
          </div>
        )}

        {!coverRendersTitle && (
          <h1
            className={`${headingClass} text-[clamp(32px,5vw,56px)] leading-[0.95] reveal`}
            style={{ color: colors.primary }}
          >
            {gallery.eventName}
          </h1>
        )}
        {gallery.eventDate && (
          <p className="caption-italic mt-2" style={{ color: colors.secondary }}>
            {new Date(gallery.eventDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
        {gallery.customMessage && (
          <p
            className="text-[14px] mt-4 max-w-2xl"
            style={{ color: colors.secondary }}
          >
            {gallery.customMessage}
          </p>
        )}

        {gallery.allowDownload && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={() => toast.info("Download is available when the gallery is published.")}
              className="text-[13px] text-stone-400 border border-stone-200 px-4 py-2 transition-colors flex items-center gap-2 cursor-default"
            >
              <Download className="h-4 w-4" strokeWidth={1.5} />
              Download All
            </button>
          </div>
        )}
      </header>

      <div
        className={`mx-8 md:mx-16 reveal-line ${!b ? "rule" : ""}`}
        style={{ height: "1px", backgroundColor: `${colors.secondary}30` }}
      />

      {/* ─── Gallery grid ─── */}
      <main className="px-8 md:px-16 pt-8 pb-24">
        <GalleryGrid
          images={gallery.images}
          allowDownload={gallery.allowDownload}
          allowFavorites={false}
          favoriteIds={new Set()}
          onImageClick={(id) => setSelectedImageId(id)}
          onDownloadClick={handleIndividualDownload}
          gridStyle={s?.gridStyle}
          gridColumns={s?.gridColumns}
          gridGap={s?.gridGap}
        />
      </main>

      {/* ─── Lightbox ─── */}
      {selectedImage && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center lightbox-open"
          onClick={() => setSelectedImageId(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSelectedImageId(null);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              if (selectedIndex > 0) {
                setSelectedImageId(gallery.images[selectedIndex - 1].id);
              }
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              if (selectedIndex < gallery.images.length - 1) {
                setSelectedImageId(gallery.images[selectedIndex + 1].id);
              }
            }
          }}
        >
          {selectedIndex > 0 && (
            <button
              aria-label="Previous image"
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 text-white/60 hover:text-white transition-colors z-10"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageId(gallery.images[selectedIndex - 1].id);
              }}
            >
              <ChevronLeft className="h-8 w-8" strokeWidth={1.5} />
            </button>
          )}
          {selectedIndex < gallery.images.length - 1 && (
            <button
              aria-label="Next image"
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 text-white/60 hover:text-white transition-colors z-10"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedImageId(gallery.images[selectedIndex + 1].id);
              }}
            >
              <ChevronRight className="h-8 w-8" strokeWidth={1.5} />
            </button>
          )}

          <button
            aria-label="Close image viewer"
            className="absolute top-4 right-4 p-3 text-white/60 hover:text-white transition-colors z-10"
            onClick={() => setSelectedImageId(null)}
          >
            <X className="h-6 w-6" strokeWidth={1.5} />
          </button>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage.originalUrl || selectedImage.thumbnailUrl}
            alt={selectedImage.parsedName || selectedImage.originalFilename}
            className="max-h-[90vh] max-w-[90vw] object-contain lightbox-image-enter"
            onClick={(e) => e.stopPropagation()}
          />

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10">
            {gallery.allowDownload && selectedImage.downloadUrl && (
              <button
                className="p-2.5 rounded-full bg-white/10 text-white/70 hover:text-white backdrop-blur-sm transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleIndividualDownload(selectedImage);
                }}
              >
                <Download className="h-5 w-5" strokeWidth={1.5} />
              </button>
            )}
            <span className="text-[12px] text-white/40">
              {selectedIndex + 1} / {gallery.images.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
