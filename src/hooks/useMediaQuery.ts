"use client";

import { useSyncExternalStore } from "react";

/**
 * Live answer to a CSS media query, for the few phone decisions CSS cannot make
 * on its own: whether a drag may start, whether a tap opens or selects, whether
 * the sidebar starts closed.
 *
 * Answers `false` on the server and the first client paint, so markup matches;
 * the real value lands on hydration. Callers must treat `false` as "desktop".
 *
 * One MediaQueryList and one stable `subscribe` per query, module-wide: grid
 * tiles call this once each, and an inline `subscribe` would make React drop
 * and re-add every tile's listener on every render.
 */
const stores = new Map<string, { subscribe: (cb: () => void) => () => void; get: () => boolean }>();

function storeFor(query: string) {
  let s = stores.get(query);
  if (!s) {
    const mql = window.matchMedia(query);
    s = {
      subscribe: (cb) => {
        mql.addEventListener("change", cb);
        return () => mql.removeEventListener("change", cb);
      },
      get: () => mql.matches,
    };
    stores.set(query, s);
  }
  return s;
}

const serverFalse = () => false;
const noopSubscribe = () => () => {};

export function useMediaQuery(query: string): boolean {
  const s = typeof window === "undefined" ? null : storeFor(query);
  return useSyncExternalStore(s?.subscribe ?? noopSubscribe, s?.get ?? serverFalse, serverFalse);
}

/** Below Tailwind's `md` (768px): the layouts that collapse to one column. */
export const PHONE_QUERY = "(max-width: 767px)";
/** A finger, not a mouse. Tablets match this too; width does not decide it. */
export const TOUCH_QUERY = "(pointer: coarse)";
