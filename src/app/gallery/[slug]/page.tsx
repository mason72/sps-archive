"use client";

import { useState, useEffect, useCallback, useRef, use, useMemo } from "react";
import { Download, ChevronLeft, ChevronRight, X, Heart, Search } from "lucide-react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { PasswordGate } from "@/components/gallery/PasswordGate";
import { toast } from "sonner";
import type { GalleryData, GalleryImage, GalleryBranding, GallerySection } from "@/types/gallery";

/* ─── Font class mappings ─── */
const HEADING_FONT_CLASS: Record<string, string> = {
  playfair: "font-editorial",     // Playfair Display — already loaded globally
  inter: "font-sans",             // Inter — already loaded globally
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

/** PIN prompt modal for download protection */
function PinPromptModal({ onSubmit, onClose }: { onSubmit: (pin: string) => void; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white p-8 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-editorial text-[20px] text-stone-900 mb-2">Download PIN</h3>
        <p className="text-[13px] text-stone-400 mb-6">Enter the 4-digit PIN to download</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={e => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
            setError("");
          }}
          autoFocus
          className="w-full text-center text-[24px] tracking-[0.5em] font-mono border-b border-stone-200 bg-transparent py-3 focus:border-stone-900 focus:outline-none transition-colors"
          placeholder="&#x2022; &#x2022; &#x2022; &#x2022;"
          onKeyDown={e => {
            if (e.key === "Enter" && pin.length === 4) onSubmit(pin);
          }}
        />
        {error && <p className="text-[12px] text-red-500 mt-2 text-center">{error}</p>}
        <button
          onClick={() => pin.length === 4 && onSubmit(pin)}
          disabled={pin.length !== 4}
          className="mt-6 w-full py-2.5 text-[13px] text-white bg-stone-900 hover:bg-stone-800 transition-colors disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>
  );
}

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
  // ─── Mosaic layout ───
  if (layout === "mosaic" && mosaicImageUrls && mosaicImageUrls.length > 0) {
    const urls = mosaicImageUrls;

    // 5 images: hero (col-span-2 row-span-2) + 4 tiles
    if (urls.length >= 5) {
      return (
        <div className="h-[50vh] md:h-[65vh] grid grid-cols-4 grid-rows-2 gap-1 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[0]} alt="" className="col-span-2 row-span-2 w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "0ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[1]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "80ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[2]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "160ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[3]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "240ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[4]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "320ms" }} />
        </div>
      );
    }

    // 4 images: hero (col-span-2 row-span-2) + 2 side tiles
    if (urls.length === 4) {
      return (
        <div className="h-[50vh] md:h-[65vh] grid grid-cols-3 grid-rows-2 gap-1 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[0]} alt="" className="col-span-2 row-span-2 w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "0ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[1]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "80ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[2]} alt="" className="w-full h-full object-cover mosaic-tile-in" style={{ animationDelay: "160ms" }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[3]} alt="" className="w-full h-full object-cover mosaic-tile-in hidden md:block" style={{ animationDelay: "240ms" }} />
        </div>
      );
    }

    // 3 images: hero 60% left + 2 stacked right 40%
    if (urls.length === 3) {
      return (
        <div className="h-[50vh] md:h-[65vh] flex gap-1 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={urls[0]} alt="" className="w-[60%] h-full object-cover mosaic-tile-in" style={{ animationDelay: "0ms" }} />
          <div className="w-[40%] flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[1]} alt="" className="flex-1 w-full object-cover mosaic-tile-in" style={{ animationDelay: "80ms" }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[2]} alt="" className="flex-1 w-full object-cover mosaic-tile-in" style={{ animationDelay: "160ms" }} />
          </div>
        </div>
      );
    }

    // <3 images: fall back to single center cover with first image
    return (
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urls[0]} alt="" className="w-full h-full object-cover ken-burns-settle" />
        <div className="absolute inset-0 bg-black/30" />
        <div className="absolute inset-0 flex items-center justify-center text-center p-8">
          <h1
            className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95] text-white`}
          >
            {eventName}
          </h1>
        </div>
      </div>
    );
  }

  // Non-mosaic layouts require a cover image URL
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
          <h1
            className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95] text-white`}
          >
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
        <h1
          className={`${headingClass} text-[clamp(36px,6vw,72px)] leading-[0.95] text-white`}
        >
          {eventName}
        </h1>
      </div>
    </div>
  );
}

export default function GalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authMeta, setAuthMeta] = useState<{
    eventName: string;
    customMessage: string | null;
    branding: GalleryBranding | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // PIN prompt state
  const [showPinModal, setShowPinModal] = useState(false);
  // G5: Favorite milestone thresholds
  const favoriteThresholdsRef = useRef(new Set<number>());
  const [pinAction, setPinAction] = useState<{ type: "bulk" } | { type: "individual"; image: GalleryImage } | null>(null);
  const [pinVerified, setPinVerified] = useState(false);

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
      const res = await fetch(`/api/gallery/${slug}`);

      if (res.status === 404) {
        setError("This gallery doesn't exist or has been removed.");
        return;
      }
      if (res.status === 410) {
        setError("This gallery link has expired.");
        return;
      }

      const data = await res.json();

      if (data.requiresAuth) {
        setRequiresAuth(true);
        setAuthMeta({
          eventName: data.eventName,
          customMessage: data.customMessage,
          branding: data.branding || null,
        });
        return;
      }

      setGallery(data);
      setRequiresAuth(false);

      // Load favorites from localStorage
      loadFavorites(data.shareId);
    } catch {
      setError("Failed to load gallery.");
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchGallery();
  }, [fetchGallery]);

  // Auto-focus lightbox when it opens for keyboard navigation
  useEffect(() => {
    if (selectedImageId && lightboxRef.current) {
      lightboxRef.current.focus();
    }
  }, [selectedImageId]);

  const loadFavorites = (shareId: string) => {
    try {
      const stored = localStorage.getItem(`favorites_${shareId}`);
      if (stored) {
        setFavoriteIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // localStorage not available
    }
  };

  const handleFavorite = async (imageId: string) => {
    if (!gallery) return;

    const newFavorites = new Set(favoriteIds);
    const isFavorited = newFavorites.has(imageId);

    if (isFavorited) {
      newFavorites.delete(imageId);
      // Remove from server
      fetch(`/api/gallery/${slug}/favorites`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId, shareId: gallery.shareId }),
      }).catch(console.error);
    } else {
      newFavorites.add(imageId);
      // Add to server
      fetch(`/api/gallery/${slug}/favorites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId, shareId: gallery.shareId }),
      }).catch(console.error);
    }

    setFavoriteIds(newFavorites);

    // G5: Favorite milestone toasts
    const count = newFavorites.size;
    for (const threshold of [5, 10, 20]) {
      if (count >= threshold && !favoriteThresholdsRef.current.has(threshold)) {
        favoriteThresholdsRef.current.add(threshold);
        toast(`You've loved ${count} moments ❤️`, { duration: 3000 });
        break; // Only one toast per action
      }
    }

    // Persist to localStorage
    try {
      localStorage.setItem(
        `favorites_${gallery.shareId}`,
        JSON.stringify([...newFavorites])
      );
    } catch {
      // localStorage not available
    }
  };

  const handlePasswordSuccess = () => {
    setIsLoading(true);
    fetchGallery();
  };

  /** Attempt download all -- shows PIN prompt if required */
  const handleDownloadAll = () => {
    if (!gallery) return;
    if (gallery.requirePinBulk && !pinVerified) {
      setPinAction({ type: "bulk" });
      setShowPinModal(true);
      return;
    }
    toast.success("Preparing download...");
    window.location.href = `/api/gallery/${slug}/download`;
  };

  /** Attempt individual download -- shows PIN prompt if required */
  const handleIndividualDownload = (image: GalleryImage) => {
    if (!gallery) return;
    if (gallery.requirePinIndividual && !pinVerified) {
      setPinAction({ type: "individual", image });
      setShowPinModal(true);
      return;
    }
    if (image.downloadUrl) {
      // Track download (fire-and-forget via sendBeacon)
      try {
        navigator.sendBeacon(
          `/api/gallery/${slug}/track`,
          new Blob(
            [JSON.stringify({ action: "image_download", imageId: image.id, shareId: gallery.shareId })],
            { type: "application/json" }
          )
        );
      } catch {
        /* sendBeacon not supported — non-critical */
      }
      const link = document.createElement("a");
      link.href = image.downloadUrl;
      link.download = image.originalFilename;
      link.click();
      toast.success("Downloaded", { description: image.originalFilename });
    }
  };

  /** Verify PIN against the server, then execute the pending action */
  const handlePinSubmit = async (pin: string) => {
    try {
      const res = await fetch(`/api/gallery/${slug}/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        toast.error("Incorrect PIN");
        return;
      }

      // PIN verified -- remember for this session
      setPinVerified(true);
      setShowPinModal(false);

      // Execute the pending action
      if (pinAction?.type === "bulk") {
        toast.success("Preparing download...");
        window.location.href = `/api/gallery/${slug}/download?pin=${pin}`;
      } else if (pinAction?.type === "individual" && pinAction.image.downloadUrl) {
        const link = document.createElement("a");
        link.href = pinAction.image.downloadUrl;
        link.download = pinAction.image.originalFilename;
        link.click();
      }
      setPinAction(null);
    } catch {
      toast.error("Failed to verify PIN");
    }
  };

  // Simple lightbox for gallery (no metadata panel)
  const selectedImage = gallery?.images.find((img) => img.id === selectedImageId);
  const selectedIndex = gallery?.images.findIndex((img) => img.id === selectedImageId) ?? -1;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-900 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[13px] text-stone-400">Loading gallery...</p>
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
            Gallery <span className="italic font-normal">unavailable</span>
          </h1>
          <p className="text-[14px] text-stone-400">{error}</p>
        </div>
      </div>
    );
  }

  // Password gate
  if (requiresAuth && authMeta) {
    return (
      <PasswordGate
        slug={slug}
        eventName={authMeta.eventName}
        customMessage={authMeta.customMessage}
        branding={authMeta.branding}
        onSuccess={handlePasswordSuccess}
      />
    );
  }

  if (!gallery) return null;

  const b = gallery.branding;
  const s = gallery.settings;

  // Resolve font classes
  const headingClass = HEADING_FONT_CLASS[s?.headingFont || "playfair"] || "font-editorial";
  const bodyClass = BODY_FONT_CLASS[s?.bodyFont || "inter"] || "font-sans";

  // Cover image present? Mosaic uses mosaicImageUrls instead of a single coverImageUrl
  const hasMosaic = s?.coverLayout === "mosaic" && (s?.mosaicImageUrls?.length ?? 0) > 0;
  const hasCover = hasMosaic || !!(s?.coverImageUrl && s?.coverLayout && s?.coverLayout !== "none");
  // Some layouts render the title inside the cover — skip it in the header
  // Mosaic does NOT render title inside — excluded from this list
  const coverRendersTitle = hasCover && !hasMosaic && (s?.coverLayout === "center" || s?.coverLayout === "classic" || s?.coverLayout === "left");

  // Build CSS custom properties from branding colors
  const brandStyles = b
    ? ({
        "--brand-primary": b.primaryColor,
        "--brand-secondary": b.secondaryColor,
        "--brand-accent": b.accentColor,
        "--brand-bg": b.backgroundColor,
      } as React.CSSProperties)
    : {};

  return (
    <div className={`min-h-screen ${bodyClass}`} style={{ ...brandStyles, backgroundColor: b?.backgroundColor }}>
      {/* ─── Cover image ─── */}
      {hasCover && (
        <CoverSection
          imageUrl={s?.coverImageUrl}
          layout={s!.coverLayout!}
          eventName={gallery.eventName}
          headingClass={headingClass}
          primaryColor={b?.primaryColor}
          mosaicImageUrls={s?.mosaicImageUrls}
        />
      )}

      {/* ─── Branded header ─── */}
      <header className="px-8 md:px-16 pt-12 pb-8">
        {/* Photographer branding row */}
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
            style={{ color: b?.primaryColor }}
          >
            {gallery.eventName}
          </h1>
        )}
        {gallery.eventDate && (
          <p className="caption-italic mt-2" style={{ color: b?.secondaryColor }}>
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
            style={{ color: b?.secondaryColor || undefined }}
          >
            {gallery.customMessage}
          </p>
        )}

        {/* Download All button */}
        {gallery.allowDownload && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleDownloadAll}
              className="text-[13px] text-stone-900 border border-stone-200 px-4 py-2 hover:bg-stone-50 transition-colors flex items-center gap-2"
            >
              <Download className="h-4 w-4" strokeWidth={1.5} />
              Download All
            </button>
          </div>
        )}
      </header>

      <div
        className={`mx-8 md:mx-16 reveal-line ${!b ? "rule" : ""}`}
        style={
          b?.secondaryColor
            ? { height: "1px", backgroundColor: `${b.secondaryColor}30` }
            : undefined
        }
      />

      {/* ─── Search + Gallery grid ─── */}
      <main className="px-8 md:px-16 pt-8 pb-24">
        {/* Search bar — only show when there are enough images to warrant it */}
        {gallery.images.length > 8 && (
          <div className="relative mb-8 max-w-sm">
            <Search
              className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-4"
              style={{ color: b?.secondaryColor || "#a8a29e" }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search photos…"
              className="w-full pl-7 pr-8 py-2 text-[13px] bg-transparent border-b focus:outline-none transition-colors duration-300"
              style={{
                color: b?.primaryColor || "#1c1917",
                borderColor: searchQuery
                  ? (b?.primaryColor || "#1c1917")
                  : (b?.secondaryColor ? `${b.secondaryColor}40` : "#e7e5e4"),
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-1 transition-colors"
                style={{ color: b?.secondaryColor || "#a8a29e" }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* When searching, show flat filtered results; otherwise show sections */}
        {searchQuery.trim() ? (
          filteredImages.length > 0 ? (
            <GalleryGrid
              images={filteredImages}
              allowDownload={gallery.allowDownload}
              allowFavorites={gallery.allowFavorites}
              favoriteIds={favoriteIds}
              onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
              onImageClick={(id) => setSelectedImageId(id)}
              onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
              gridStyle={s?.gridStyle}
              gridColumns={s?.gridColumns}
              gridGap={s?.gridGap}
            />
          ) : (
            <p
              className="text-center py-16 text-[14px] italic"
              style={{ color: b?.secondaryColor || "#a8a29e" }}
            >
              No photos match &ldquo;{searchQuery}&rdquo;
            </p>
          )
        ) : gallery.sections && gallery.sections.length > 0 ? (
          <SectionedGallery
            images={gallery.images}
            sections={gallery.sections}
            allowDownload={gallery.allowDownload}
            allowFavorites={gallery.allowFavorites}
            favoriteIds={favoriteIds}
            onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
            branding={b}
          />
        ) : (
          <GalleryGrid
            images={gallery.images}
            allowDownload={gallery.allowDownload}
            allowFavorites={gallery.allowFavorites}
            favoriteIds={favoriteIds}
            onFavorite={gallery.allowFavorites ? handleFavorite : undefined}
            onImageClick={(id) => setSelectedImageId(id)}
            onDownloadClick={gallery.requirePinIndividual ? handleIndividualDownload : undefined}
            gridStyle={s?.gridStyle}
            gridColumns={s?.gridColumns}
            gridGap={s?.gridGap}
          />
        )}
      </main>

      {/* ─── Simple gallery lightbox ─── */}
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
              const currentIndex = gallery.images.findIndex((img: { id: string }) => img.id === selectedImageId);
              if (currentIndex > 0) {
                setSelectedImageId(gallery.images[currentIndex - 1].id);
              }
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              const currentIndex = gallery.images.findIndex((img: { id: string }) => img.id === selectedImageId);
              if (currentIndex < gallery.images.length - 1) {
                setSelectedImageId(gallery.images[currentIndex + 1].id);
              }
            }
          }}
        >
          {/* Navigation */}
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

          {/* Close */}
          <button
            aria-label="Close image viewer"
            className="absolute top-4 right-4 p-3 text-white/60 hover:text-white transition-colors z-10"
            onClick={() => setSelectedImageId(null)}
          >
            <X className="h-6 w-6" strokeWidth={1.5} />
          </button>

          {/* Image — show full-res original in lightbox */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selectedImage.originalUrl || selectedImage.thumbnailUrl}
            alt={selectedImage.parsedName || selectedImage.originalFilename}
            className="max-h-[90vh] max-w-[90vw] object-contain lightbox-image-enter"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Bottom bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 z-10">
            {gallery.allowFavorites && (
              <button
                className={`p-2.5 rounded-full backdrop-blur-sm transition-colors ${
                  favoriteIds.has(selectedImage.id)
                    ? "bg-white/20 text-red-400"
                    : "bg-white/10 text-white/70 hover:text-white"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleFavorite(selectedImage.id);
                }}
              >
                <Heart className="h-5 w-5" fill={favoriteIds.has(selectedImage.id) ? "currentColor" : "none"} strokeWidth={1.5} />
              </button>
            )}
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
          </div>

          {/* Counter */}
          <p className="absolute top-4 left-4 text-[12px] text-white/40 tabular-nums">
            {selectedIndex + 1} / {gallery.images.length}
          </p>
        </div>
      )}

      {/* ─── End-of-gallery moment ─── */}
      {b && (
        <div className="py-16 text-center stagger-in">
          {b.logoUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={b.logoUrl}
              alt={b.businessName || ""}
              className="h-12 w-auto object-contain mx-auto mb-4 opacity-60"
            />
          )}
          <p className="text-[13px] text-stone-400 tracking-wide uppercase">
            Photographed by
          </p>
          <p className="font-editorial italic text-[22px] text-stone-700 mt-1">
            {b.businessName || "Your Photographer"}
          </p>
          {b.website && (
            <a
              href={b.website.startsWith("http") ? b.website : `https://${b.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-[12px] text-stone-400 hover:text-stone-600 transition-colors duration-300 border-b border-stone-200 hover:border-stone-400 pb-0.5"
            >
              View Portfolio →
            </a>
          )}
        </div>
      )}

      {/* ─── V4: Photographer signature footer ─── */}
      <footer className="px-8 md:px-16 pt-4 pb-8">
        <hr
          className="mb-8 border-0 h-px"
          style={{ backgroundColor: b?.secondaryColor ? `${b.secondaryColor}20` : "rgba(168,162,158,0.2)" }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {b?.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={b.logoUrl}
                alt={b.businessName || ""}
                className="h-6 w-auto object-contain opacity-50"
              />
            )}
            {b?.businessName && (
              <span className="font-editorial italic text-[15px]" style={{ color: b.secondaryColor }}>
                {b.website ? (
                  <a
                    href={b.website.startsWith("http") ? b.website : `https://${b.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="editorial-link"
                  >
                    {b.businessName}
                  </a>
                ) : (
                  b.businessName
                )}
              </span>
            )}
          </div>
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: b?.secondaryColor || "#a8a29e" }}>
            Powered by{" "}
            {/* Pixel-mosaic favicon */}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="opacity-40">
              <rect x="0" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
              <rect x="4" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
              <rect x="8" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="12" y="0" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.2" />
              <rect x="0" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="4" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.9" />
              <rect x="8" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.7" />
              <rect x="12" y="4" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.3" />
              <rect x="0" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="4" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.7" />
              <rect x="8" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.8" />
              <rect x="12" y="8" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="0" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.2" />
              <rect x="4" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.4" />
              <rect x="8" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5" />
              <rect x="12" y="12" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.9" />
            </svg>
            <span className="font-brand text-[13px]" style={{ color: b?.primaryColor || "#1c1917" }}>
              pixeltrunk
            </span>
          </p>
        </div>
      </footer>

      {/* ─── PIN prompt modal ─── */}
      {showPinModal && (
        <PinPromptModal
          onSubmit={handlePinSubmit}
          onClose={() => {
            setShowPinModal(false);
            setPinAction(null);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
 * SectionedGallery — renders images grouped by section
 * ───────────────────────────────────────────── */
function SectionedGallery({
  images,
  sections,
  allowDownload,
  allowFavorites,
  favoriteIds,
  onFavorite,
  onImageClick,
  onDownloadClick,
  gridStyle,
  gridColumns,
  gridGap,
  branding,
}: {
  images: GalleryImage[];
  sections: GallerySection[];
  allowDownload: boolean;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavorite?: (imageId: string) => void;
  onImageClick: (id: string) => void;
  onDownloadClick?: (image: GalleryImage) => void;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
  branding: GalleryBranding | null;
}) {
  const imageMap = new Map(images.map((img) => [img.id, img]));
  const assignedIds = new Set(sections.flatMap((s) => s.imageIds));
  const unsectioned = images.filter((img) => !assignedIds.has(img.id));

  const gridProps = {
    allowDownload,
    allowFavorites,
    favoriteIds,
    onFavorite,
    onImageClick,
    onDownloadClick,
    gridStyle,
    gridColumns,
    gridGap,
  };

  return (
    <div className="space-y-16">
      {/* Unsectioned images first */}
      {unsectioned.length > 0 && (
        <GalleryGrid images={unsectioned} {...gridProps} />
      )}

      {/* Each section with a heading */}
      {sections.map((section) => {
        const sectionImages = section.imageIds
          .map((id) => imageMap.get(id))
          .filter((img): img is GalleryImage => !!img);
        if (sectionImages.length === 0) return null;

        return (
          <div key={section.id}>
            <div className="mb-6">
              <h2
                className="font-editorial text-[22px] text-stone-900"
                style={{ color: branding?.primaryColor || undefined }}
              >
                {section.name}
              </h2>
              {section.description && (
                <p
                  className="text-[13px] mt-1"
                  style={{ color: branding?.secondaryColor || "#a8a29e" }}
                >
                  {section.description}
                </p>
              )}
            </div>
            <GalleryGrid images={sectionImages} {...gridProps} />
          </div>
        );
      })}
    </div>
  );
}
