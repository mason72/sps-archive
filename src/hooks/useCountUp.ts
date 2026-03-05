"use client";

import { useState, useEffect, useRef } from "react";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * useCountUp — animates a number from 0 → target over `duration` ms.
 * Triggers when `enabled` flips to true (tie to viewport entry via useInView).
 */
export function useCountUp(target: number, enabled: boolean, duration = 800) {
  const [displayValue, setDisplayValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDisplayValue(0);
      return;
    }

    if (target === 0) {
      setDisplayValue(0);
      return;
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);

      setDisplayValue(Math.round(eased * target));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target, enabled, duration]);

  return { displayValue };
}
