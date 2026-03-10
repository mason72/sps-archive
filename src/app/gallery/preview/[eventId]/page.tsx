"use client";

import { useState, useEffect, useCallback, useRef, use, useMemo } from "react";
import { Download, ChevronLeft, ChevronRight, X, Eye, Search } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { SectionedGallery } from "@/components/gallery/SectionedGallery";
import { CoverSection } from "@/components/gallery/CoverSection";
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

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const filteredImages = useMemo(() => {
    if (!gallery || !searchQuery.trim()) return gallery?.images ?? [];
    const q = searchQuery.toLowerCase();
    return gallery.images.filter(
      (img) =>
        (img.parsedName && img.parsedName.toLowerCase().includes(q)) ||
        img.originalFilename.toLowerCase().includes(q)
    );
  }, [gallery, searchQuery]);

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

  // Cover image
  const hasCover = s?.coverEnabled && !!s?.coverImageUrl;
  const titlePosition = s?.titlePosition || "over";
  const titleAlignment = s?.titleAlignment || "center";
  const coverRendersTitle = hasCover && titlePosition === "over";
  const titleBelowCover = hasCover && titlePosition === "below";
  const titleAboveCover = hasCover && titlePosition === "above";
  const titleAlignClass = titleAlignment === "left" ? "text-left" : titleAlignment === "right" ? "text-right" : "text-center";

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

      {/* ─── Logo + Title above cover ─── */}
      {titleAboveCover && (
        <div className="px-8 md:px-16 pt-12 pb-6">
          <div className={`flex items-center gap-6 ${titleAlignment === "left" ? "" : "flex-row-reverse"}`}>
            <h1
              className={`${headingClass} text-[clamp(28px,4vw,48px)] leading-[0.95] reveal flex-1 ${titleAlignClass}`}
              style={{ color: colors.primary }}
            >
              {gallery.eventName}
            </h1>
            {b && (b.logoUrl || b.businessName) && (
              <div className="flex items-center gap-3 shrink-0">
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Cover image ─── */}
      {hasCover && (
        <CoverSection
          imageUrl={s!.coverImageUrl!}
          eventName={gallery.eventName}
          headingClass={headingClass}
          primaryColor={colors.primary}
          titlePosition={titlePosition}
          titleAlignment={titleAlignment}
          titlePlacement={s?.titlePlacement}
        />
      )}

      {/* ─── Branded header ─── */}
      <header className={`px-8 md:px-16 ${titleBelowCover || titleAboveCover ? "pt-6" : "pt-12"} pb-8`}>
        {/* When title is below cover: logo + title inline */}
        {titleBelowCover ? (
          <div className={`flex items-center gap-6 ${titleAlignment === "left" ? "" : "flex-row-reverse"}`}>
            <h1
              className={`${headingClass} text-[clamp(28px,4vw,48px)] leading-[0.95] reveal flex-1 ${titleAlignClass}`}
              style={{ color: colors.primary }}
            >
              {gallery.eventName}
            </h1>
            {b && (b.logoUrl || b.businessName) && (
              <div className="flex items-center gap-3 shrink-0">
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Logo row — skip when above (already rendered above cover) */}
            {!titleAboveCover && b && (b.logoUrl || b.businessName) && (
              <div
                className={`flex items-center gap-3 mb-8 ${
                  b.logoPlacement === "center" ? "justify-center" : "justify-start"
                }`}
              >
                {b.logoUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={b.logoUrl} alt={b.businessName || "Photographer"} className="h-10 w-auto object-contain" />
                )}
                {b.businessName && !b.logoUrl && (
                  <span className="text-[15px] font-medium tracking-wide uppercase" style={{ color: colors.secondary }}>
                    {b.businessName}
                  </span>
                )}
              </div>
            )}

            {/* Title — skip when cover renders it or when above */}
            {!coverRendersTitle && !titleAboveCover && (
              <h1
                className={`${headingClass} text-[clamp(32px,5vw,56px)] leading-[0.95] reveal`}
                style={{ color: colors.primary }}
              >
                {gallery.eventName}
              </h1>
            )}
          </>
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

      {/* ─── Search + Gallery grid ─── */}
      <main className="px-8 md:px-16 pt-8 pb-24">
        {/* Toolbar: search */}
        {gallery.images.length > 8 && (
          <div className="flex items-end justify-between gap-6 mb-8">
            <div className="relative max-w-sm flex-1">
              <Search
                className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4"
                style={{ color: colors.secondary }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search photos…"
                className="w-full pl-7 pr-8 py-2 text-[13px] bg-transparent border-b focus:outline-none transition-colors duration-300"
                style={{
                  color: colors.primary,
                  borderColor: searchQuery
                    ? colors.primary
                    : `${colors.secondary}40`,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-1 transition-colors"
                  style={{ color: colors.secondary }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* When searching, show flat results; otherwise show sections */}
        {searchQuery.trim() ? (
          filteredImages.length > 0 ? (
            <GalleryGrid
              images={filteredImages}
              allowDownload={gallery.allowDownload}
              allowFavorites={false}
              favoriteIds={new Set()}
              onImageClick={(id) => setSelectedImageId(id)}
              onDownloadClick={handleIndividualDownload}
              gridStyle={s?.gridStyle}
              gridColumns={s?.gridColumns}
              gridGap={s?.gridGap}
            />
          ) : (
            <p
              className="text-center py-16 text-[14px] italic"
              style={{ color: colors.secondary }}
            >
              No photos match &ldquo;{searchQuery}&rdquo;
            </p>
          )
        ) : gallery.sections && gallery.sections.length > 0 ? (
          <SectionedGallery
            images={gallery.images}
            sections={gallery.sections}
            allowDownload={gallery.allowDownload}
            allowFavorites={false}
            favoriteIds={new Set()}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={handleIndividualDownload}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
            colors={colors}
            showAllTab
          />
        ) : (
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
        )}
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
