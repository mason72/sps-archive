"use client";

import { createPortal } from "react-dom";
import {
  X,
  ArrowLeftRight,
  Link2,
  Unlink2,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { useComparison } from "@/hooks/useComparison";
import { ComparisonPane } from "./ComparisonPane";
import { MetadataComparison } from "./MetadataComparison";
import type { ImageData } from "@/types/image";
import { cn } from "@/lib/utils";

interface ComparisonViewProps {
  images: ImageData[];
  initialLeftIndex: number;
  initialRightIndex: number;
  onClose: () => void;
  onPickImage?: (imageId: string) => void;
}

/**
 * ComparisonView — Full-screen side-by-side image comparison.
 * Portal-based viewer (same pattern as Lightbox) with synced zoom/pan,
 * metadata comparison strip, and keyboard shortcuts.
 *
 * Keys: Esc=close, S=swap, L=toggle sync, 1=pick left, 2=pick right,
 *       Arrow left/right=cycle right image
 */
export function ComparisonView({
  images,
  initialLeftIndex,
  initialRightIndex,
  onClose,
  onPickImage,
}: ComparisonViewProps) {
  const {
    leftImage,
    rightImage,
    leftDetail,
    rightDetail,
    isLoadingLeft,
    isLoadingRight,
    cycleRight,
    swap,
    close,
    isSynced,
    toggleSync,
    leftZoom,
    rightZoom,
    handleWheel,
    handleDoubleClick,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    pickLeft,
    pickRight,
    containerRef,
  } = useComparison({
    images,
    initialLeftIndex,
    initialRightIndex,
    onClose,
    onPickImage,
  });

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image comparison"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-white/[0.97] outline-none"
    >
      {/* ─── Top bar ─── */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-stone-100 shrink-0">
        {/* Left filename */}
        <p className="flex-1 text-[11px] text-stone-500 tracking-wide truncate max-w-[300px]">
          {leftImage.originalFilename}
        </p>

        {/* Center actions */}
        <div className="flex items-center gap-1 shrink-0 mx-4">
          {/* Cycle left */}
          <ToolbarButton
            onClick={() => cycleRight(-1)}
            label="Previous (←)"
            title="Previous image (←)"
          >
            <ChevronLeft className="h-[16px] w-[16px]" />
          </ToolbarButton>

          {/* Pick left */}
          <ToolbarButton
            onClick={pickLeft}
            label="Pick left (1)"
            title="Pick left image (1)"
            accent
          >
            <Check className="h-[14px] w-[14px]" />
            <span className="text-[10px] font-medium tracking-wider uppercase ml-0.5">L</span>
          </ToolbarButton>

          {/* Swap */}
          <ToolbarButton
            onClick={swap}
            label="Swap images (S)"
            title="Swap sides (S)"
          >
            <ArrowLeftRight className="h-[16px] w-[16px]" />
          </ToolbarButton>

          {/* Sync toggle */}
          <ToolbarButton
            onClick={toggleSync}
            label={isSynced ? "Unsync zoom (L)" : "Sync zoom (L)"}
            title={isSynced ? "Unsync zoom (L)" : "Sync zoom (L)"}
            active={isSynced}
          >
            {isSynced ? (
              <Link2 className="h-[16px] w-[16px]" />
            ) : (
              <Unlink2 className="h-[16px] w-[16px]" />
            )}
          </ToolbarButton>

          {/* Pick right */}
          <ToolbarButton
            onClick={pickRight}
            label="Pick right (2)"
            title="Pick right image (2)"
            accent
          >
            <span className="text-[10px] font-medium tracking-wider uppercase mr-0.5">R</span>
            <Check className="h-[14px] w-[14px]" />
          </ToolbarButton>

          {/* Cycle right */}
          <ToolbarButton
            onClick={() => cycleRight(1)}
            label="Next (→)"
            title="Next image (→)"
          >
            <ChevronRight className="h-[16px] w-[16px]" />
          </ToolbarButton>

          {/* Divider */}
          <div className="w-px h-5 bg-stone-200 mx-1" />

          {/* Close */}
          <ToolbarButton
            onClick={close}
            label="Close (Esc)"
            title="Close (Esc)"
          >
            <X className="h-[16px] w-[16px]" />
          </ToolbarButton>
        </div>

        {/* Right filename */}
        <p className="flex-1 text-right text-[11px] text-stone-500 tracking-wide truncate max-w-[300px]">
          {rightImage.originalFilename}
        </p>
      </div>

      {/* ─── Image panes ─── */}
      <div className="flex flex-1 min-h-0">
        {/* Left pane */}
        <div className="flex-1 border-r border-stone-200">
          <ComparisonPane
            image={leftImage}
            zoom={leftZoom}
            isPanning={isPanning}
            onWheel={(e) => handleWheel(e, "left")}
            onDoubleClick={() => handleDoubleClick("left")}
            onPanStart={(x, y) => handlePanStart(x, y, "left")}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
            label="A"
            isLoading={isLoadingLeft}
          />
        </div>

        {/* Right pane */}
        <div className="flex-1">
          <ComparisonPane
            image={rightImage}
            zoom={rightZoom}
            isPanning={isPanning}
            onWheel={(e) => handleWheel(e, "right")}
            onDoubleClick={() => handleDoubleClick("right")}
            onPanStart={(x, y) => handlePanStart(x, y, "right")}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
            label="B"
            isLoading={isLoadingRight}
          />
        </div>
      </div>

      {/* ─── Metadata comparison strip ─── */}
      <MetadataComparison
        leftImage={leftImage}
        rightImage={rightImage}
        leftDetail={leftDetail}
        rightDetail={rightDetail}
        isLoadingLeft={isLoadingLeft}
        isLoadingRight={isLoadingRight}
      />

      {/* ─── Keyboard hints ─── */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-4 text-[9px] uppercase tracking-[0.15em] text-stone-300 pointer-events-none">
        <span>Esc close</span>
        <span>S swap</span>
        <span>L sync</span>
        <span>1 pick A</span>
        <span>2 pick B</span>
        <span>← → cycle</span>
      </div>
    </div>,
    document.body
  );
}

/** Toolbar button — consistent styling for top bar actions */
function ToolbarButton({
  onClick,
  label,
  title,
  active,
  accent,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  active?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title}
      className={cn(
        "flex h-8 items-center gap-0.5 px-2 transition-colors duration-200",
        active
          ? "text-stone-900"
          : accent
          ? "text-emerald-600 hover:text-emerald-700"
          : "text-stone-400 hover:text-stone-900"
      )}
    >
      {children}
    </button>
  );
}
