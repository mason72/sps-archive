"use client";

import { useEffect, useState } from "react";

/**
 * "May this account be offered Event Intel?" for CLIENT components.
 *
 * The event page is a client component and cannot read the session
 * synchronously, so its Intel tab and crew-confirm strip have to ask. They ask
 * the same endpoint the nav does (`/api/ops/whoami`) — one question about what
 * a page may offer, not two mechanisms that will disagree in six months.
 *
 * The answer is cached at MODULE level, because three surfaces on one page
 * asking the same question is three identical requests. It is also the reason
 * this is a hook and not a fetch inlined at each site.
 *
 * `null` means "not known yet" and callers must render nothing rather than
 * guessing. Guessing false flashes the feature away from the person who has it;
 * guessing true flashes it TOWARD someone who does not, which is worse.
 *
 * ⚠️ Never a security boundary. /intel `notFound()`s and every intel route
 * 403s through `getIntelUser()`; this only decides what is drawn.
 */
let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

function ask(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = fetch("/api/ops/whoami")
      .then((r) => (r.ok ? r.json() : { hasIntel: false }))
      .then((j) => {
        cached = !!j.hasIntel;
        return cached;
      })
      .catch(() => {
        // Do NOT cache a failure — a blip would hide the feature for the rest
        // of the session with no way to recover but a reload.
        inFlight = null;
        return false;
      });
  }
  return inFlight;
}

export function useIntelAccess(): boolean | null {
  const [has, setHas] = useState<boolean | null>(cached);
  useEffect(() => {
    if (cached !== null) {
      setHas(cached);
      return;
    }
    let live = true;
    ask().then((v) => {
      if (live) setHas(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return has;
}
