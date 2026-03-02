"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { GalleryGrid } from "@/components/gallery/GalleryGrid";
import { PasswordGate } from "@/components/gallery/PasswordGate";
import { toast } from "sonner";
import type { GalleryData, GalleryImage, GalleryBranding, GallerySettings } from "@/types/gallery";

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
}: {
  imageUrl: string;
  layout: string;
  eventName: string;
  headingClass: string;
  primaryColor?: string;
}) {
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
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      </div>
    );
  }

  if (layout === "frame") {
    return (
      <div className="px-8 md:px-16 pt-12">
        <div className="relative aspect-[16/7] overflow-hidden bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 border-[8px] md:border-[16px] border-white pointer-events-none" />
        </div>
      </div>
    );
  }

  if (layout === "classic") {
    return (
      <div className="relative h-[50vh] md:h-[60vh] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" className="w-full h-full object-cover" />
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
      <img src={imageUrl} alt="" className="w-full h-full object-cover" />
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
  const [pinAction, setPinAction] = useState<{ type: "bulk" } | { type: "individual"; image: GalleryImage } | null>(null);
  const [pinVerified, setPinVerified] = useState(false);

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
      const link = document.createElement("a");
      link.href = image.downloadUrl;
      link.download = image.originalFilename;
      link.click();
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

  // Cover image present?
  const hasCover = !!(s?.coverImageUrl && s?.coverLayout);
  // Some layouts render the title inside the cover — skip it in the header
  const coverRendersTitle = hasCover && (s?.coverLayout === "center" || s?.coverLayout === "classic" || s?.coverLayout === "left");

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
          imageUrl={s!.coverImageUrl!}
          layout={s!.coverLayout!}
          eventName={gallery.eventName}
          headingClass={headingClass}
          primaryColor={b?.primaryColor}
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
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
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

      {/* ─── Gallery grid ─── */}
      <main className="px-8 md:px-16 pt-8 pb-24">
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
              const currentIndex = gallery.images.findIndex((img: any) => img.id === selectedImageId);
              if (currentIndex > 0) {
                setSelectedImageId(gallery.images[currentIndex - 1].id);
              }
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              const currentIndex = gallery.images.findIndex((img: any) => img.id === selectedImageId);
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
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
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
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          )}

          {/* Close */}
          <button
            aria-label="Close image viewer"
            className="absolute top-4 right-4 p-3 text-white/60 hover:text-white transition-colors z-10"
            onClick={() => setSelectedImageId(null)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
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
                <svg className="h-5 w-5" fill={favoriteIds.has(selectedImage.id) ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                </svg>
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
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
            )}
          </div>

          {/* Counter */}
          <p className="absolute top-4 left-4 text-[12px] text-white/40 tabular-nums">
            {selectedIndex + 1} / {gallery.images.length}
          </p>
        </div>
      )}

      {/* ─── Footer ─── */}
      <footer
        className="px-8 md:px-16 py-8 border-t"
        style={{ borderColor: b?.secondaryColor ? `${b.secondaryColor}20` : undefined }}
      >
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
              <span className="text-[12px]" style={{ color: b.secondaryColor }}>
                {b.website ? (
                  <a
                    href={b.website.startsWith("http") ? b.website : `https://${b.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {b.businessName}
                  </a>
                ) : (
                  b.businessName
                )}
              </span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: b?.secondaryColor || "#a8a29e" }}>
            Powered by{" "}
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
