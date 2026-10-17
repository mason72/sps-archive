"use client";

import { useSyncExternalStore } from "react";

/**
 * Live answer to a CSS media query, for the few phone decisions CSS cannot make
 * on its own: whether a drag may start, whether a tap opens or selects, whether
 * the sidebar starts closed.
 *
 * Answers `false` on the server and the first client paint, so markup matches;
 * the real value lands on hydration. Callers must treat `false` as "desktop".
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Below Tailwind's `md` (768px): the layouts that collapse to one column. */
export const PHONE_QUERY = "(max-width: 767px)";
/** A finger, not a mouse. Tablets match this too; width does not decide it. */
export const TOUCH_QUERY = "(pointer: coarse)";
