"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseMarqueeSelectOptions {
  /** Ref to the scrollable container for coordinate calculations */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Called with the IDs of images under the marquee */
  onSelect: (ids: string[]) => void;
  /** Whether marquee selection is enabled */
  enabled?: boolean;
}

/**
 * useMarqueeSelect — Rubber-band / lasso selection for the image grid.
 *
 * - Mousedown on empty grid space starts drawing
 * - Mousemove expands accent-colored rectangle
 * - Each frame: query `[data-image-id]` elements, check intersection
 * - Mouseup finalizes selection via onSelect(ids)
 * - Disabled on touch devices
 */
export function useMarqueeSelect({
  containerRef,
  onSelect,
  enabled = true,
}: UseMarqueeSelectOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const previewIdsRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);

  // Check intersection between two rects
  const rectsIntersect = useCallback(
    (a: DOMRect, b: { left: number; top: number; right: number; bottom: number }) => {
      return !(
        a.right < b.left ||
        a.left > b.right ||
        a.bottom < b.top ||
        a.top > b.bottom
      );
    },
    []
  );

  // Find all image elements under the marquee rect
  const getIntersectingIds = useCallback(
    (marqueeRect: MarqueeRect): string[] => {
      const container = containerRef.current;
      if (!container) return [];

      const containerBounds = container.getBoundingClientRect();
      const absoluteRect = {
        left: containerBounds.left + marqueeRect.x,
        top: containerBounds.top + marqueeRect.y,
        right: containerBounds.left + marqueeRect.x + marqueeRect.width,
        bottom: containerBounds.top + marqueeRect.y + marqueeRect.height,
      };

      const elements = container.querySelectorAll("[data-image-id]");
      const ids: string[] = [];

      elements.forEach((el) => {
        const bounds = el.getBoundingClientRect();
        if (rectsIntersect(bounds, absoluteRect)) {
          const id = el.getAttribute("data-image-id");
          if (id) ids.push(id);
        }
      });

      return ids;
    },
    [containerRef, rectsIntersect]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!enabled) return;

      // Only start on left mouse button
      if (e.button !== 0) return;

      // Don't start if clicking on interactive elements
      const target = e.target as HTMLElement;
      if (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("[data-image-id]")
      ) {
        return;
      }

      // Don't start on touch devices
      if ("ontouchstart" in window) return;

      const container = containerRef.current;
      if (!container) return;

      const containerBounds = container.getBoundingClientRect();
      const x = e.clientX - containerBounds.left;
      const y = e.clientY - containerBounds.top;

      startRef.current = { x, y };
      previewIdsRef.current = [];
      setIsDrawing(true);
      setRect({ x, y, width: 0, height: 0 });

      e.preventDefault();
    },
    [enabled, containerRef]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDrawing || !startRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      const containerBounds = container.getBoundingClientRect();
      const currentX = e.clientX - containerBounds.left;
      const currentY = e.clientY - containerBounds.top;

      const x = Math.min(startRef.current.x, currentX);
      const y = Math.min(startRef.current.y, currentY);
      const width = Math.abs(currentX - startRef.current.x);
      const height = Math.abs(currentY - startRef.current.y);

      const newRect = { x, y, width, height };
      setRect(newRect);

      // Use rAF to avoid computing intersections every mousemove
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        previewIdsRef.current = getIntersectingIds(newRect);
      });
    },
    [isDrawing, containerRef, getIntersectingIds]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing) return;

    // Finalize with whatever IDs are under the marquee
    if (rect && (rect.width > 5 || rect.height > 5)) {
      const ids = getIntersectingIds(rect);
      if (ids.length > 0) {
        onSelect(ids);
      }
    }

    startRef.current = null;
    previewIdsRef.current = [];
    setIsDrawing(false);
    setRect(null);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [isDrawing, rect, getIntersectingIds, onSelect]);

  // Attach global listeners when drawing
  useEffect(() => {
    if (isDrawing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDrawing, handleMouseMove, handleMouseUp]);

  // Attach mousedown on container
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener("mousedown", handleMouseDown);
    return () => container.removeEventListener("mousedown", handleMouseDown);
  }, [containerRef, enabled, handleMouseDown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    isDrawing,
    rect,
  };
}
