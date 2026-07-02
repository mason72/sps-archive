"use client";

import { useState, useRef, useEffect } from "react";
import { Heart, Layers } from "lucide-react";
import type { GalleryStack } from "@/lib/gallery/stacks";

/**
 * GalleryStackCard — one tile representing a person's whole set of photos.
 *
 * The card slowly rotates through its members (gentle crossfade, jittered
 * timing so neighboring stacks don't cycle in lockstep), wears a subtle
 * stacked-paper treatment, and its heart favorites the entire stack at once.
 * Clicking opens the lightbox on whichever photo is showing.
 *
 * Rotation is paused on hover, while selected/favorited-all, off-screen
 * (IntersectionObserver), and under prefers-reduced-motion.
 */
export function GalleryStackCard({
  stack,
  allowFavorites,
  favoriteIds,
  onFavoriteMany,
  onImageClick,
  showName,
  uniform,
  sizes,
}: {
  stack: GalleryStack;
  allowFavorites: boolean;
  favoriteIds: Set<string>;
  onFavoriteMany?: (imageIds: string[], favorite: boolean) => void;
  onImageClick: (imageId: string) => void;
  showName?: boolean;
  uniform?: boolean;
  sizes?: string;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [heartPop, setHeartPop] = useState(false);
  const isPaused = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const count = stack.images.length;
  const allFavorited = stack.images.every((img) => favoriteIds.has(img.id));

  // Only rotate while on screen — a long gallery shouldn't burn timers.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (count < 2 || !isLoaded || !isVisible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setTimeout>;
    const scheduleNext = () => {
      // 4–8s with jitter so a grid of stacks breathes instead of ticking.
      const delay = 4000 + Math.random() * 4000;
      timer = setTimeout(() => {
        if (!isPaused.current) {
          setActiveIdx((prev) => {
            setPrevIdx(prev);
            return (prev + 1) % count;
          });
        }
        scheduleNext();
      }, delay);
    };
    // Random initial offset so stacks don't all flip at once on load.
    timer = setTimeout(scheduleNext, Math.random() * 4000);
    return () => clearTimeout(timer);
  }, [count, isLoaded, isVisible]);

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!allFavorited) setHeartPop(true);
    onFavoriteMany?.(
      stack.images.map((img) => img.id),
      !allFavorited
    );
  };

  const active = stack.images[activeIdx];
  const first = stack.images[0];
  // The tile keeps the FIRST image's aspect so the masonry column never
  // reflows as the rotation crossfades between differently-shaped photos.
  const aspectStyle = !uniform
    ? {
        aspectRatio:
          first.width && first.height ? `${first.width} / ${first.height}` : "4 / 3",
      }
    : { aspectRatio: "1 / 1" };

  return (
    <div ref={rootRef} className="relative">
      {/* Stacked-paper layers peeking out behind the photo */}
      <div
        aria-hidden
        className="absolute inset-0 border border-stone-200 bg-white shadow-sm transition-transform duration-300"
        style={{ transform: "translate(6px, -6px) rotate(1.2deg)" }}
      />
      {count >= 3 && (
        <div
          aria-hidden
          className="absolute inset-0 border border-stone-200 bg-white shadow-sm transition-transform duration-300"
          style={{ transform: "translate(3px, -3px) rotate(0.6deg)" }}
        />
      )}

      <div
        className="relative group cursor-pointer overflow-hidden bg-stone-100"
        style={aspectStyle}
        onClick={() => onImageClick(active.id)}
        onMouseEnter={() => (isPaused.current = true)}
        onMouseLeave={() => (isPaused.current = false)}
      >
        {stack.images.map((image, i) => {
          // Keep the DOM light: only the active, previous (fading out), and
          // next (prefetching) members are mounted.
          const isActive = i === activeIdx;
          const isPrev = i === prevIdx;
          const isNext = i === (activeIdx + 1) % count;
          if (!isActive && !isPrev && !isNext) return null;
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={image.id}
              src={image.thumbnailUrl}
              srcSet={
                image.thumbnailLgUrl
                  ? `${image.thumbnailUrl} 400w, ${image.thumbnailLgUrl} 800w`
                  : undefined
              }
              sizes={image.thumbnailLgUrl ? sizes : undefined}
              alt={stack.personName}
              className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
              style={{ opacity: isActive && isLoaded ? 1 : 0 }}
              loading={i === 0 ? "lazy" : "eager"}
              decoding="async"
              onLoad={() => i === 0 && setIsLoaded(true)}
            />
          );
        })}
        {!isLoaded && <div className="absolute inset-0 bg-stone-100" />}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Count badge */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-white backdrop-blur-sm pointer-events-none">
          <Layers className="h-3 w-3" />
          <span className="text-[11px] font-medium tabular-nums">{count}</span>
        </div>

        {/* Person name (when Names is toggled on) */}
        {showName && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 pointer-events-none">
            <p className="truncate text-[11px] text-white">{stack.personName}</p>
          </div>
        )}

        {/* Favorite the whole stack */}
        {allowFavorites && (
          <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <button
              onClick={handleFavorite}
              className={`p-2 rounded-full backdrop-blur-sm transition-colors ${
                allFavorited
                  ? "bg-white/90 text-red-500"
                  : "bg-black/30 text-white hover:bg-black/50"
              }`}
              title={
                allFavorited
                  ? `Remove all ${count} from favorites`
                  : `Add all ${count} to favorites`
              }
            >
              <Heart
                className={`h-4 w-4 ${heartPop ? "heart-pop" : ""}`}
                fill={allFavorited ? "currentColor" : "none"}
                onAnimationEnd={() => setHeartPop(false)}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
