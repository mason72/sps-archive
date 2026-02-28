"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ImageData, ImageDetail } from "@/types/image";

interface UseLightboxOptions {
  images: ImageData[];
  initialImageId: string;
  onClose: () => void;
}

export interface ZoomState {
  scale: number;
  position: { x: number; y: number };
  isZoomed: boolean;
}

interface UseLightboxReturn {
  currentIndex: number;
  currentImage: ImageData;
  imageDetail: ImageDetail | null;
  isLoadingDetail: boolean;
  isMetadataOpen: boolean;
  toggleMetadata: () => void;
  goNext: () => void;
  goPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  close: () => void;
  totalImages: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  // Zoom
  zoom: ZoomState;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  setZoom: (scale: number) => void;
  handleZoomWheel: (e: WheelEvent) => void;
  handleDoubleClick: () => void;
  handlePanStart: (clientX: number, clientY: number) => void;
  handlePanMove: (clientX: number, clientY: number) => void;
  handlePanEnd: () => void;
  isPanning: boolean;
  // Touch zoom
  handleTouchStartZoom: (e: TouchEvent) => void;
  handleTouchMoveZoom: (e: TouchEvent) => void;
  handleTouchEndZoom: (e: TouchEvent) => void;
  // Download
  handleDownload: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

/**
 * useLightbox — Manages all lightbox interaction logic:
 * keyboard navigation, touch/swipe, scroll locking,
 * image detail fetching with caching, metadata toggle,
 * zoom/pan, and pinch-to-zoom.
 */
export function useLightbox({
  images,
  initialImageId,
  onClose,
}: UseLightboxOptions): UseLightboxReturn {
  // ── Navigation state ──
  const initialIndex = useMemo(
    () => Math.max(0, images.findIndex((img) => img.id === initialImageId)),
    [images, initialImageId]
  );
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);

  // ── Zoom state ──
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartPosRef = useRef({ x: 0, y: 0 });

  // ── Touch zoom refs ──
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchScale = useRef(1);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const isTouchPanning = useRef(false);
  const touchPanStartPos = useRef({ x: 0, y: 0 });

  // ── Detail fetching ──
  const [imageDetail, setImageDetail] = useState<ImageDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const detailCache = useRef<Map<string, ImageDetail>>(new Map());

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<Element | null>(null);

  const currentImage = images[currentIndex] || images[0];
  const hasNext = currentIndex < images.length - 1;
  const hasPrev = currentIndex > 0;
  const isZoomed = scale > 1;

  // ── Zoom helpers ──
  const clampScale = useCallback((s: number) => {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(s * 100) / 100));
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setScale((s) => clampScale(s + ZOOM_STEP));
  }, [clampScale]);

  const zoomOut = useCallback(() => {
    setScale((s) => {
      const next = clampScale(s - ZOOM_STEP);
      if (next <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  }, [clampScale]);

  const setZoomLevel = useCallback(
    (newScale: number) => {
      const clamped = clampScale(newScale);
      setScale(clamped);
      if (clamped <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    },
    [clampScale]
  );

  const handleDoubleClick = useCallback(() => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2);
    }
  }, [scale, resetZoom]);

  const handleZoomWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setScale((s) => {
        const next = clampScale(s + delta);
        if (next <= 1) {
          setPosition({ x: 0, y: 0 });
        }
        return next;
      });
    },
    [clampScale]
  );

  // ── Pan (mouse drag when zoomed) ──
  const handlePanStart = useCallback(
    (clientX: number, clientY: number) => {
      if (scale <= 1) return;
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = { x: clientX, y: clientY };
      panStartPosRef.current = { ...position };
    },
    [scale, position]
  );

  const handlePanMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isPanningRef.current || scale <= 1) return;
      const dx = (clientX - panStartRef.current.x) / scale;
      const dy = (clientY - panStartRef.current.y) / scale;
      setPosition({
        x: panStartPosRef.current.x + dx,
        y: panStartPosRef.current.y + dy,
      });
    },
    [scale]
  );

  const handlePanEnd = useCallback(() => {
    isPanningRef.current = false;
    setIsPanning(false);
  }, []);

  // ── Navigation ──
  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, images.length - 1));
    resetZoom();
  }, [images.length, resetZoom]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
    resetZoom();
  }, [resetZoom]);

  const toggleMetadata = useCallback(() => {
    setIsMetadataOpen((v) => !v);
  }, []);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── Download ──
  const handleDownload = useCallback(() => {
    const url = imageDetail?.downloadUrl || currentImage.originalUrl || currentImage.thumbnailUrl;
    const a = document.createElement("a");
    a.href = url;
    a.download = currentImage.originalFilename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [imageDetail, currentImage]);

  // ── Touch: pinch zoom + swipe + pan ──
  const getTouchDistance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStartZoom = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch start
        initialPinchDistance.current = getTouchDistance(e.touches);
        initialPinchScale.current = scale;
      } else if (e.touches.length === 1) {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
        touchStartTime.current = Date.now();

        // If zoomed, start touch panning
        if (scale > 1) {
          isTouchPanning.current = true;
          touchPanStartPos.current = { ...position };
        }
      }
    },
    [scale, position]
  );

  const handleTouchMoveZoom = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 2 && initialPinchDistance.current !== null) {
        // Pinch zoom
        e.preventDefault();
        const currentDistance = getTouchDistance(e.touches);
        const ratio = currentDistance / initialPinchDistance.current;
        const newScale = clampScale(initialPinchScale.current * ratio);
        setScale(newScale);
        if (newScale <= 1) {
          setPosition({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && isTouchPanning.current && scale > 1) {
        // Touch panning when zoomed
        e.preventDefault();
        const dx = (e.touches[0].clientX - touchStartX.current) / scale;
        const dy = (e.touches[0].clientY - touchStartY.current) / scale;
        setPosition({
          x: touchPanStartPos.current.x + dx,
          y: touchPanStartPos.current.y + dy,
        });
      }
    },
    [scale, clampScale]
  );

  const handleTouchEndZoom = useCallback(
    (e: TouchEvent) => {
      if (initialPinchDistance.current !== null && e.touches.length < 2) {
        // End pinch
        initialPinchDistance.current = null;
        return;
      }

      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const deltaX = e.changedTouches[0].clientX - touchStartX.current;
        const deltaY = e.changedTouches[0].clientY - touchStartY.current;
        const duration = Date.now() - touchStartTime.current;

        // Only swipe navigate if not zoomed and horizontal
        if (
          scale <= 1 &&
          Math.abs(deltaX) > 50 &&
          Math.abs(deltaX) > Math.abs(deltaY) * 1.5 &&
          duration < 300
        ) {
          if (deltaX < 0) goNext();
          else goPrev();
        }

        isTouchPanning.current = false;
      }
    },
    [scale, goNext, goPrev]
  );

  // ── Fetch image detail (lazy, cached) ──
  const fetchDetail = useCallback(async (imageId: string) => {
    if (detailCache.current.has(imageId)) {
      setImageDetail(detailCache.current.get(imageId)!);
      setIsLoadingDetail(false);
      return;
    }

    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/images/${imageId}`);
      if (res.ok) {
        const data: ImageDetail = await res.json();
        detailCache.current.set(imageId, data);
        setImageDetail(data);
      } else {
        setImageDetail(null);
      }
    } catch {
      setImageDetail(null);
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  // Prefetch adjacent images
  const prefetchDetail = useCallback(
    (imageId: string) => {
      if (detailCache.current.has(imageId)) return;
      fetch(`/api/images/${imageId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) detailCache.current.set(imageId, data);
        })
        .catch(() => {});
    },
    []
  );

  // Fetch current + prefetch adjacent when index changes
  useEffect(() => {
    const img = images[currentIndex];
    if (!img) return;

    fetchDetail(img.id);

    // Prefetch neighbors
    if (currentIndex > 0) prefetchDetail(images[currentIndex - 1].id);
    if (currentIndex < images.length - 1)
      prefetchDetail(images[currentIndex + 1].id);
  }, [currentIndex, images, fetchDetail, prefetchDetail]);

  // ── Keyboard handling ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't handle if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "i":
        case "I":
          e.preventDefault();
          toggleMetadata();
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
        case "_":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          resetZoom();
          break;
        case "d":
        case "D":
          e.preventDefault();
          handleDownload();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrev, close, toggleMetadata, zoomIn, zoomOut, resetZoom, handleDownload]);

  // ── Touch/swipe handling ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => handleTouchStartZoom(e);
    const onTouchMove = (e: TouchEvent) => handleTouchMoveZoom(e);
    const onTouchEnd = (e: TouchEvent) => handleTouchEndZoom(e);

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [handleTouchStartZoom, handleTouchMoveZoom, handleTouchEndZoom]);

  // ── Scroll lock + focus management ──
  useEffect(() => {
    // Save focus and lock scroll
    previousFocus.current = document.activeElement;
    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the container
    containerRef.current?.focus();

    return () => {
      document.body.style.overflow = savedOverflow;
      // Restore focus
      if (previousFocus.current instanceof HTMLElement) {
        previousFocus.current.focus();
      }
    };
  }, []);

  return {
    currentIndex,
    currentImage,
    imageDetail,
    isLoadingDetail,
    isMetadataOpen,
    toggleMetadata,
    goNext,
    goPrev,
    hasNext,
    hasPrev,
    close,
    totalImages: images.length,
    containerRef,
    // Zoom
    zoom: { scale, position, isZoomed },
    zoomIn,
    zoomOut,
    resetZoom,
    setZoom: setZoomLevel,
    handleZoomWheel,
    handleDoubleClick,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    // Touch zoom
    handleTouchStartZoom,
    handleTouchMoveZoom,
    handleTouchEndZoom,
    // Download
    handleDownload,
  };
}
