"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Check } from "lucide-react";
import type { ImageData, StackData } from "@/types/image";

interface FilmStripProps {
  images: ImageData[];
  stacks: StackData[];
  standalone: ImageData[];
  onImageClick: (id: string) => void;
  isSelecting: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

/**
 * FilmStrip -- Horizontal scrolling gallery view.
 * Full viewport height, images flow left to right with scroll snap.
 * Keyboard: Left/Right arrows navigate between images.
 */
export function FilmStrip({
  stacks,
  standalone,
  onImageClick,
  isSelecting,
  selectedIds,
  onToggleSelect,
}: FilmStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Build a flat list: stack cover images first, then standalone
  const flatImages = useMemo(() => {
    const list: ImageData[] = [];
    for (const stack of stacks) {
      if (stack.images.length > 0) {
        list.push(stack.images[0]); // cover image
      }
    }
    for (const img of standalone) {
      list.push(img);
    }
    return list;
  }, [stacks, standalone]);

  // Update scroll indicator state
  const updateScrollIndicators = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 10);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollIndicators();
    el.addEventListener("scroll", updateScrollIndicators, { passive: true });
    return () => el.removeEventListener("scroll", updateScrollIndicators);
  }, [updateScrollIndicators, flatImages]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollToIndex(currentIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollToIndex(currentIndex - 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, flatImages.length]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(index, flatImages.length - 1));
      const children = el.children;
      if (children[clamped]) {
        (children[clamped] as HTMLElement).scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
        setCurrentIndex(clamped);
      }
    },
    [flatImages.length]
  );

  // Track current index on scroll via IntersectionObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
            const idx = Array.from(el.children).indexOf(
              entry.target as HTMLElement
            );
            if (idx >= 0) setCurrentIndex(idx);
          }
        }
      },
      { root: el, threshold: 0.5 }
    );

    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [flatImages]);

  if (flatImages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-editorial text-xl text-stone-400 italic">
          No images yet
        </p>
        <p className="mt-2 text-[13px] text-stone-300">
          Upload some photos to get started
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* ─── Scroll container ─── */}
      <div
        ref={scrollRef}
        className="film-strip-scroll flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-4"
        style={{ height: "calc(100vh - 200px)" }}
      >
        {flatImages.map((image) => (
          <FilmStripFrame
            key={image.id}
            image={image}
            isSelecting={isSelecting}
            isSelected={selectedIds.has(image.id)}
            onClick={() => {
              if (isSelecting) {
                onToggleSelect(image.id);
              } else {
                onImageClick(image.id);
              }
            }}
            onToggleSelect={() => onToggleSelect(image.id)}
          />
        ))}
      </div>

      {/* ─── Left arrow ─── */}
      {canScrollLeft && (
        <button
          onClick={() => scrollToIndex(currentIndex - 1)}
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/30 backdrop-blur-sm text-white/80 hover:bg-black/50 hover:text-white transition-all duration-200"
          aria-label="Previous image"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* ─── Right arrow ─── */}
      {canScrollRight && (
        <button
          onClick={() => scrollToIndex(currentIndex + 1)}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 bg-black/30 backdrop-blur-sm text-white/80 hover:bg-black/50 hover:text-white transition-all duration-200"
          aria-label="Next image"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* ─── Image counter ─── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-black/40 backdrop-blur-sm px-3 py-1 text-[11px] tracking-wider text-white/70">
        {currentIndex + 1} / {flatImages.length}
      </div>
    </div>
  );
}

/** Individual film strip frame */
function FilmStripFrame({
  image,
  isSelecting,
  isSelected,
  onClick,
}: {
  image: ImageData;
  isSelecting: boolean;
  isSelected: boolean;
  onClick: () => void;
  onToggleSelect: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <div className="snap-center flex-shrink-0 flex flex-col items-center">
      <button
        onClick={onClick}
        className={`relative h-full overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          isSelecting ? "cursor-pointer" : "photo-lift"
        } ${isSelected ? "ring-2 ring-accent ring-inset" : ""}`}
        style={{ height: "calc(100vh - 240px)" }}
      >
        {/* Selection checkbox */}
        {isSelecting && (
          <div className="absolute top-3 left-3 z-10">
            <div
              className={`w-6 h-6 border-2 flex items-center justify-center transition-all duration-150 ${
                isSelected
                  ? "bg-accent border-accent"
                  : "border-white/80 bg-black/20 backdrop-blur-sm"
              }`}
            >
              {isSelected && (
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              )}
            </div>
          </div>
        )}

        {/* Selection overlay tint */}
        {isSelecting && isSelected && (
          <div className="absolute inset-0 bg-accent/10 z-[1] pointer-events-none" />
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={image.thumbnailUrl}
          alt={image.originalFilename || ""}
          className={`h-full w-auto object-contain transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (
              imgRef.current &&
              image.originalUrl &&
              imgRef.current.src !== image.originalUrl
            ) {
              imgRef.current.src = image.originalUrl;
            }
          }}
        />

        {/* Placeholder while loading */}
        {!loaded && (
          <div className="h-full aspect-[2/3] bg-stone-100" />
        )}
      </button>

      {/* Filename */}
      <p className="mt-2 text-[12px] text-stone-400 max-w-[200px] truncate text-center">
        {image.originalFilename || "Untitled"}
      </p>
    </div>
  );
}
