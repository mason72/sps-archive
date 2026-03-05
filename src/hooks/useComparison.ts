"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ImageData, ImageDetail } from "@/types/image";

export interface ComparisonZoomState {
  scale: number;
  position: { x: number; y: number };
}

interface UseComparisonOptions {
  images: ImageData[];
  initialLeftIndex: number;
  initialRightIndex: number;
  onClose: () => void;
  onPickImage?: (imageId: string) => void;
}

interface UseComparisonReturn {
  // Image state
  leftIndex: number;
  rightIndex: number;
  leftImage: ImageData;
  rightImage: ImageData;
  leftDetail: ImageDetail | null;
  rightDetail: ImageDetail | null;
  isLoadingLeft: boolean;
  isLoadingRight: boolean;
  // Navigation
  cycleRight: (direction: 1 | -1) => void;
  swap: () => void;
  close: () => void;
  // Zoom (synced by default)
  zoom: ComparisonZoomState;
  isSynced: boolean;
  toggleSync: () => void;
  leftZoom: ComparisonZoomState;
  rightZoom: ComparisonZoomState;
  handleWheel: (e: WheelEvent, side: "left" | "right") => void;
  handleDoubleClick: (side: "left" | "right") => void;
  handlePanStart: (clientX: number, clientY: number, side: "left" | "right") => void;
  handlePanMove: (clientX: number, clientY: number) => void;
  handlePanEnd: () => void;
  isPanning: boolean;
  // Actions
  pickLeft: () => void;
  pickRight: () => void;
  // Refs
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

/**
 * useComparison — Manages side-by-side image comparison state.
 * Synced zoom/pan by default, with independent mode toggle.
 */
export function useComparison({
  images,
  initialLeftIndex,
  initialRightIndex,
  onClose,
  onPickImage,
}: UseComparisonOptions): UseComparisonReturn {
  const [leftIndex, setLeftIndex] = useState(initialLeftIndex);
  const [rightIndex, setRightIndex] = useState(initialRightIndex);
  const [isSynced, setIsSynced] = useState(true);

  // Synced zoom (used when isSynced = true)
  const [syncedZoom, setSyncedZoom] = useState<ComparisonZoomState>({
    scale: 1,
    position: { x: 0, y: 0 },
  });

  // Independent zooms (used when isSynced = false)
  const [leftZoom, setLeftZoom] = useState<ComparisonZoomState>({
    scale: 1,
    position: { x: 0, y: 0 },
  });
  const [rightZoom, setRightZoom] = useState<ComparisonZoomState>({
    scale: 1,
    position: { x: 0, y: 0 },
  });

  // Pan tracking
  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panSideRef = useRef<"left" | "right">("left");
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartPosRef = useRef({ x: 0, y: 0 });

  // Detail fetching
  const [leftDetail, setLeftDetail] = useState<ImageDetail | null>(null);
  const [rightDetail, setRightDetail] = useState<ImageDetail | null>(null);
  const [isLoadingLeft, setIsLoadingLeft] = useState(false);
  const [isLoadingRight, setIsLoadingRight] = useState(false);
  const detailCache = useRef<Map<string, ImageDetail>>(new Map());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  const leftImage = images[leftIndex] || images[0];
  const rightImage = images[rightIndex] || images[1] || images[0];

  // ── Zoom helpers ──
  const clamp = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(s * 100) / 100));

  const getActiveZoom = useCallback(
    (side: "left" | "right"): ComparisonZoomState => {
      if (isSynced) return syncedZoom;
      return side === "left" ? leftZoom : rightZoom;
    },
    [isSynced, syncedZoom, leftZoom, rightZoom]
  );

  const setActiveZoom = useCallback(
    (side: "left" | "right", updater: (prev: ComparisonZoomState) => ComparisonZoomState) => {
      if (isSynced) {
        setSyncedZoom(updater);
      } else {
        (side === "left" ? setLeftZoom : setRightZoom)(updater);
      }
    },
    [isSynced]
  );

  // ── Wheel zoom ──
  const handleWheel = useCallback(
    (e: WheelEvent, side: "left" | "right") => {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setActiveZoom(side, (prev) => {
        const next = clamp(prev.scale + delta);
        return {
          scale: next,
          position: next <= 1 ? { x: 0, y: 0 } : prev.position,
        };
      });
    },
    [setActiveZoom]
  );

  // ── Double click zoom ──
  const handleDoubleClick = useCallback(
    (side: "left" | "right") => {
      setActiveZoom(side, (prev) => {
        if (prev.scale > 1) {
          return { scale: 1, position: { x: 0, y: 0 } };
        }
        return { scale: 2, position: prev.position };
      });
    },
    [setActiveZoom]
  );

  // ── Pan ──
  const handlePanStart = useCallback(
    (clientX: number, clientY: number, side: "left" | "right") => {
      const z = getActiveZoom(side);
      if (z.scale <= 1) return;
      isPanningRef.current = true;
      setIsPanning(true);
      panSideRef.current = side;
      panStartRef.current = { x: clientX, y: clientY };
      panStartPosRef.current = { ...z.position };
    },
    [getActiveZoom]
  );

  const handlePanMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isPanningRef.current) return;
      const side = panSideRef.current;
      const z = getActiveZoom(side);
      if (z.scale <= 1) return;

      const dx = (clientX - panStartRef.current.x) / z.scale;
      const dy = (clientY - panStartRef.current.y) / z.scale;

      setActiveZoom(side, (prev) => ({
        ...prev,
        position: {
          x: panStartPosRef.current.x + dx,
          y: panStartPosRef.current.y + dy,
        },
      }));
    },
    [getActiveZoom, setActiveZoom]
  );

  const handlePanEnd = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  // ── Navigation ──
  const cycleRight = useCallback(
    (direction: 1 | -1) => {
      setRightIndex((prev) => {
        let next = prev + direction;
        if (next < 0) next = images.length - 1;
        if (next >= images.length) next = 0;
        // Skip left image
        if (next === leftIndex) {
          next += direction;
          if (next < 0) next = images.length - 1;
          if (next >= images.length) next = 0;
        }
        return next;
      });
    },
    [images.length, leftIndex]
  );

  const swap = useCallback(() => {
    setLeftIndex(rightIndex);
    setRightIndex(leftIndex);
  }, [leftIndex, rightIndex]);

  const toggleSync = useCallback(() => {
    setIsSynced((v) => {
      if (!v) {
        // Switching to synced: reset both to current synced state
        const current = syncedZoom;
        setLeftZoom(current);
        setRightZoom(current);
      }
      return !v;
    });
  }, [syncedZoom]);

  const pickLeft = useCallback(() => {
    onPickImage?.(leftImage.id);
  }, [onPickImage, leftImage.id]);

  const pickRight = useCallback(() => {
    onPickImage?.(rightImage.id);
  }, [onPickImage, rightImage.id]);

  // ── Detail fetching ──
  const fetchDetail = useCallback(async (imageId: string): Promise<ImageDetail | null> => {
    if (detailCache.current.has(imageId)) {
      return detailCache.current.get(imageId)!;
    }
    try {
      const res = await fetch(`/api/images/${imageId}`);
      if (res.ok) {
        const data: ImageDetail = await res.json();
        detailCache.current.set(imageId, data);
        return data;
      }
    } catch {}
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingLeft(true);
    fetchDetail(leftImage.id).then((d) => {
      if (!cancelled) {
        setLeftDetail(d);
        setIsLoadingLeft(false);
      }
    });
    return () => { cancelled = true; };
  }, [leftImage.id, fetchDetail]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingRight(true);
    fetchDetail(rightImage.id).then((d) => {
      if (!cancelled) {
        setRightDetail(d);
        setIsLoadingRight(false);
      }
    });
    return () => { cancelled = true; };
  }, [rightImage.id, fetchDetail]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "s":
        case "S":
          e.preventDefault();
          swap();
          break;
        case "l":
        case "L":
          e.preventDefault();
          toggleSync();
          break;
        case "1":
          e.preventDefault();
          pickLeft();
          break;
        case "2":
          e.preventDefault();
          pickRight();
          break;
        case "ArrowRight":
          e.preventDefault();
          cycleRight(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          cycleRight(-1);
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, swap, toggleSync, pickLeft, pickRight, cycleRight]);

  // ── Scroll lock + focus ──
  useEffect(() => {
    previousFocus.current = document.activeElement;
    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus();

    return () => {
      document.body.style.overflow = savedOverflow;
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, []);

  // Effective zoom for each side
  const effectiveLeftZoom = isSynced ? syncedZoom : leftZoom;
  const effectiveRightZoom = isSynced ? syncedZoom : rightZoom;

  return {
    leftIndex,
    rightIndex,
    leftImage,
    rightImage,
    leftDetail,
    rightDetail,
    isLoadingLeft,
    isLoadingRight,
    cycleRight,
    swap,
    close: onClose,
    zoom: syncedZoom,
    isSynced,
    toggleSync,
    leftZoom: effectiveLeftZoom,
    rightZoom: effectiveRightZoom,
    handleWheel,
    handleDoubleClick,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    pickLeft,
    pickRight,
    containerRef,
  };
}
