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

/** Minimum drag distance in px before the marquee activates */
const DRAG_THRESHOLD = 8;

/**
 * useMarqueeSelect — Rubber-band / lasso selection for the image grid.
 *
 * - Mousedown anywhere in the grid area starts tracking
 * - After exceeding DRAG_THRESHOLD px, the accent marquee rectangle appears
 * - Each frame: query `[data-image-id]` elements, check intersection
 * - Mouseup finalizes selection via onSelect(ids)
 * - Small movements (< threshold) pass through as normal clicks
 * - Disabled on touch devices
 */
export function useMarqueeSelect({
  containerRef,
  onSelect,
  enabled = true,
}: UseMarqueeSelectOptions) {
  const [isDrawing, setIsDrawing] = useState(false);
  const drawingRef = useRef(false); // synchronous mirror of isDrawing (avoids stale closure)
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const rectRef = useRef<MarqueeRect | null>(null); // synchronous mirror of rect
  const startRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const trackingRef = useRef(false); // mousedown happened, watching for threshold
  const previewIdsRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const clickBlockerRef = useRef(false);

  // Stable refs for latest handler versions (avoids stale closures in global listeners)
  const handleMouseMoveRef = useRef<(e: MouseEvent) => void>(() => {});
  const handleMouseUpRef = useRef<() => void>(() => {});

  // Stable wrapper functions that never change identity (safe for add/removeEventListener)
  // Defined early so they can be referenced by handleMouseDown and handleMouseUp
  const stableMouseMove = useCallback((e: MouseEvent) => handleMouseMoveRef.current(e), []);
  const stableMouseUp = useCallback(() => handleMouseUpRef.current(), []);

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

      // Don't start if clicking on non-image interactive elements (links, inputs)
      const target = e.target as HTMLElement;
      if (
        target.closest("a") ||
        target.closest("input") ||
        target.closest("select") ||
        target.closest("[data-no-marquee]")
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

      // Start tracking, but don't activate marquee until threshold exceeded
      startRef.current = { x, y, clientX: e.clientX, clientY: e.clientY };
      trackingRef.current = true;
      previewIdsRef.current = [];

      // Attach global listeners immediately so mousemove/mouseup are captured
      window.addEventListener("mousemove", stableMouseMove);
      window.addEventListener("mouseup", stableMouseUp);
    },
    [enabled, containerRef, stableMouseMove, stableMouseUp]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!startRef.current) return;

      const container = containerRef.current;
      if (!container) return;

      // Check if we've exceeded the drag threshold to start drawing
      if (trackingRef.current && !drawingRef.current) {
        const dx = e.clientX - startRef.current.clientX;
        const dy = e.clientY - startRef.current.clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < DRAG_THRESHOLD) return;

        // Threshold exceeded — activate marquee mode
        trackingRef.current = false;
        drawingRef.current = true;
        setIsDrawing(true);
        clickBlockerRef.current = true;

        // Prevent text selection while dragging
        e.preventDefault();
      }

      if (!drawingRef.current && !trackingRef.current) return;

      const containerBounds = container.getBoundingClientRect();
      const currentX = e.clientX - containerBounds.left;
      const currentY = e.clientY - containerBounds.top;

      const x = Math.min(startRef.current.x, currentX);
      const y = Math.min(startRef.current.y, currentY);
      const width = Math.abs(currentX - startRef.current.x);
      const height = Math.abs(currentY - startRef.current.y);

      const newRect = { x, y, width, height };
      rectRef.current = newRect;
      setRect(newRect);

      // Use rAF to avoid computing intersections every mousemove
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        previewIdsRef.current = getIntersectingIds(newRect);
      });

      e.preventDefault();
    },
    [containerRef, getIntersectingIds]
  );

  const handleMouseUp = useCallback(() => {
    const wasDrawing = drawingRef.current;
    const wasTracking = trackingRef.current;
    const currentRect = rectRef.current;

    // Always clean up tracking state
    trackingRef.current = false;
    drawingRef.current = false;

    // Always remove global listeners (they were attached in mousedown)
    window.removeEventListener("mousemove", stableMouseMove);
    window.removeEventListener("mouseup", stableMouseUp);

    if (!wasDrawing && !wasTracking) return;

    // Finalize with whatever IDs are under the marquee
    if (wasDrawing && currentRect && (currentRect.width > 5 || currentRect.height > 5)) {
      const ids = getIntersectingIds(currentRect);
      if (ids.length > 0) {
        onSelect(ids);
      }
    }

    startRef.current = null;
    rectRef.current = null;
    previewIdsRef.current = [];
    setIsDrawing(false);
    setRect(null);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Block the next click event (from mouseup on a button) if we were drawing
    if (wasDrawing) {
      clickBlockerRef.current = true;
      requestAnimationFrame(() => {
        setTimeout(() => {
          clickBlockerRef.current = false;
        }, 0);
      });
    }
  }, [getIntersectingIds, onSelect, stableMouseMove, stableMouseUp]);

  // Keep handler refs current so stable wrappers always call latest versions
  useEffect(() => {
    handleMouseMoveRef.current = handleMouseMove;
    handleMouseUpRef.current = handleMouseUp;
  });

  // Block click events that fire after a marquee drag
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blockClick = (e: Event) => {
      if (clickBlockerRef.current) {
        e.stopPropagation();
        e.preventDefault();
        clickBlockerRef.current = false;
      }
    };

    container.addEventListener("click", blockClick, true); // capture phase
    return () => container.removeEventListener("click", blockClick, true);
  }, [containerRef]);

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
