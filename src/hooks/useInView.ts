"use client";

import { useRef, useState, useEffect, type RefObject } from "react";

interface UseInViewOptions {
  /** Disconnect observer after first trigger (default: true) */
  once?: boolean;
  /** IntersectionObserver threshold (default: 0.1) */
  threshold?: number;
  /** IntersectionObserver rootMargin (default: "0px") */
  rootMargin?: string;
}

/**
 * useInView — wraps IntersectionObserver.
 * Returns a ref to attach + boolean for visibility.
 * `once: true` (default) disconnects after first trigger.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = {}
): { ref: RefObject<T | null>; isInView: boolean } {
  const { once = true, threshold = 0.1, rootMargin = "0px" } = options;
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setIsInView(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  return { ref, isInView };
}
