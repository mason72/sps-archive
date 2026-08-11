"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * Photos for whatever the elephant is currently walking through.
 *
 * `ElephantWalk` can take a `passing` prop, but most loaders are nowhere near
 * the data: a search spinner lives inside a filter panel, a selfie-match wait
 * lives inside a modal, and threading image URLs down to them is exactly the
 * plumbing that gets skipped. So the surface declares its context ONCE, near the
 * data, and every loader inside it picks the photos up (Mason, 2026-08-11: "Can
 * this be generalized for event/space context so that we can use it for whatever
 * context it's in").
 *
 *   <PassingPhotos photos={images.map((i) => i.thumbnailUrl)}>
 *     … anything in here that renders an ElephantWalk shows these photos …
 *   </PassingPhotos>
 *
 * **Only ever pass URLs the surface has ALREADY rendered.** These come out of the
 * browser cache, so the scenery costs nothing. Handing it URLs the page hasn't
 * loaded turns a loading state into extra downloads — a loader that makes the
 * wait longer is worse than no loader.
 *
 * An empty list is the correct answer when a surface has no photos in hand yet (a
 * route-level `loading.tsx` runs before any data): the elephant simply walks the
 * savanna, exactly as it did before this existed.
 */
const PassingPhotosContext = createContext<string[]>([]);

/** How many the bands can actually show — see PhotoBand: one per copy, two copies. */
const VISIBLE_AT_ONCE = 4;

export function PassingPhotos({
  photos,
  children,
}: {
  /** Thumbnail URLs the surface is already displaying. Order is respected. */
  photos: (string | null | undefined)[];
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    const clean = photos.filter((p): p is string => Boolean(p));
    if (clean.length <= VISIBLE_AT_ONCE) return clean;
    // Spread across the set rather than taking the front, so a 5,000-photo event
    // doesn't parade the same four frames from the top of the grid. Deterministic
    // (no shuffle) so a re-render doesn't jump the scenery.
    const stride = Math.floor(clean.length / VISIBLE_AT_ONCE);
    return Array.from({ length: VISIBLE_AT_ONCE }, (_, i) => clean[i * stride]);
  }, [photos]);

  return (
    <PassingPhotosContext.Provider value={value}>
      {children}
    </PassingPhotosContext.Provider>
  );
}

/** The ambient photos, or an empty array outside any provider. */
export function usePassingPhotos(): string[] {
  return useContext(PassingPhotosContext);
}
