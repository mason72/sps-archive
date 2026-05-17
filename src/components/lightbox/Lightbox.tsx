"use client";

import { createPortal } from "react-dom";
import { useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Info, Download, X } from "lucide-react";
import { useLightbox } from "./useLightbox";
import { LightboxImage } from "./LightboxImage";
import { MetadataPanel } from "./MetadataPanel";
import type { ImageData } from "@/types/image";

/**
 * A photographer-facing action wired into the lightbox top bar.
 *
 * Pass an array of these from the event page (e.g. Delete, Set as cover,
 * Add to section). Each gets a top-bar button plus an optional keyboard
 * shortcut. Callbacks receive the currently-viewed image so they can
 * dispatch a per-image action without the host having to track it.
 */
export interface LightboxAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Keyboard shortcut character (e.g. "Delete", "f", "s"). Case-sensitive. */
  shortcut?: string;
  /**
   * Called with the currently-viewed image. Return Promise<"close"> to
   * auto-close the lightbox after the action (e.g. after a delete).
   */
  onAct: (image: ImageData) => void | "close" | Promise<void | "close">;
  /** Highlight in red so destructive actions read as such. */
  destructive?: boolean;
  /**
   * When true, the first press of the button (or keyboard shortcut)
   * doesn't fire onAct — instead the button enters a "Confirm" state
   * for ~3s. A second press within that window runs onAct; otherwise
   * the button reverts. Replaces native `confirm()` dialogs that
   * felt jarring against the editorial lightbox surface.
   */
  requiresConfirm?: boolean;
  /** Label to display while in confirm state. Defaults to "Confirm". */
  confirmLabel?: string;
}

interface LightboxProps {
  images: ImageData[];
  initialImageId: string;
  onClose: () => void;
  /** Optional photographer actions rendered in the top bar. */
  actions?: LightboxAction[];
}

/**
 * Lightbox — Full-screen image viewer with keyboard navigation,
 * zoom/pan, metadata sidebar, and download support. Renders as a portal
 * to avoid z-index issues with the page layout. Light theme design.
 */
/** ~3 second auto-cancel window for requiresConfirm actions. */
const CONFIRM_WINDOW_MS = 3000;

export function Lightbox({ images, initialImageId, onClose, actions }: LightboxProps) {
  // Per-action confirm state. Tracks which action is awaiting a
  // second press (for requiresConfirm actions like Delete).
  // CONFIRM_WINDOW_MS gives the user time to commit without re-reading
  // a modal dialog every time.
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
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
    totalImages,
    containerRef,
    // Zoom
    zoom,
    handleZoomWheel,
    handleDoubleClick,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    isPanning,
    // Download
    handleDownload,
  } = useLightbox({ images, initialImageId, onClose });

  const clearConfirm = () => {
    setPendingConfirmId(null);
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  };

  /**
   * Single source of truth for "press this action."
   * Handles the requiresConfirm two-stage flow uniformly for both the
   * top-bar buttons and the keyboard-shortcut listener.
   */
  const dispatchAction = async (action: LightboxAction, image: ImageData) => {
    if (action.requiresConfirm && pendingConfirmId !== action.id) {
      // First press — enter confirm state with auto-cancel.
      setPendingConfirmId(action.id);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(clearConfirm, CONFIRM_WINDOW_MS);
      return;
    }
    clearConfirm();
    const result = await action.onAct(image);
    if (result === "close") {
      close();
    }
  };

  // Clear any pending confirm when the user navigates to a different
  // image — a destructive confirm should never carry over to a photo
  // the user didn't intend.
  useEffect(() => {
    clearConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage.id]);

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-white/[0.97] lightbox-open outline-none"
    >
      {/* ─── Top bar ─── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4 lightbox-open"
        style={{ animationDelay: "0.1s" }}
      >
        {/* Counter */}
        <span
          className="text-[11px] font-medium uppercase tracking-[0.25em] text-stone-400 shrink-0"
          aria-live="polite"
        >
          {currentIndex + 1} of {totalImages}
        </span>

        {/* Filename — centered in top bar */}
        <p className="text-[11px] text-stone-500 tracking-wide truncate max-w-[400px] mx-4">
          {currentImage.originalFilename}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Photographer actions (delete, set-as-cover, etc.) come first
              so destructive items don't sit right next to the close X. */}
          {actions?.map((action) => {
            const isPending = pendingConfirmId === action.id;
            return (
              <button
                key={action.id}
                onClick={() => dispatchAction(action, currentImage)}
                className={`flex items-center gap-1.5 px-2.5 h-10 transition-colors duration-200 ${
                  isPending
                    ? "text-red-600"
                    : action.destructive
                      ? "text-stone-400 hover:text-red-600"
                      : "text-stone-400 hover:text-stone-900"
                }`}
                aria-label={
                  isPending
                    ? `${action.confirmLabel || "Confirm"} — ${action.label}`
                    : action.label
                }
                title={
                  action.shortcut
                    ? `${action.label} (${action.shortcut})`
                    : action.label
                }
              >
                {action.icon}
                {isPending && (
                  <span className="text-[11px] uppercase tracking-[0.15em] font-medium">
                    {action.confirmLabel || "Confirm"}
                  </span>
                )}
              </button>
            );
          })}

          <button
            onClick={toggleMetadata}
            className={`flex h-10 w-10 items-center justify-center transition-colors duration-300 ${
              isMetadataOpen
                ? "text-stone-900"
                : "text-stone-400 hover:text-stone-900"
            }`}
            aria-label="Toggle image details"
            title="Info (i)"
          >
            <Info className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={handleDownload}
            className="flex h-10 w-10 items-center justify-center text-stone-400 hover:text-stone-900 transition-colors duration-300"
            aria-label="Download original image"
            title="Download (d)"
          >
            <Download className="h-[18px] w-[18px]" />
          </button>

          <button
            onClick={close}
            className="flex h-10 w-10 items-center justify-center text-stone-400 hover:text-stone-900 transition-colors duration-300"
            aria-label="Close viewer"
            title="Close (Esc)"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {/* Bind keyboard shortcuts for any provided actions. Shortcuts
          flow through dispatchAction so requiresConfirm gets the same
          two-stage handling as the button. */}
      <ActionShortcuts
        actions={actions}
        image={currentImage}
        onDispatch={dispatchAction}
      />

      {/* ─── Main content ─── */}
      <div className="flex h-full pt-14 pb-4">
        {/* Image area with navigation — generous side padding only on
            md+ so mobile users get the full screen width for the image. */}
        <div className="relative flex flex-1 items-center justify-center px-12 md:px-16">
          {/* Left arrow — visible on all sizes; smaller / lower-contrast on mobile */}
          {hasPrev && !zoom.isZoomed && (
            <button
              onClick={goPrev}
              className="absolute left-2 md:left-4 z-10 flex h-9 w-9 md:h-10 md:w-10 items-center justify-center bg-stone-200/60 text-stone-500 hover:bg-stone-300/80 hover:text-stone-900 transition-colors duration-300"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          {/* Image — key forces remount for enter animation */}
          <LightboxImage
            key={currentImage.id}
            image={currentImage}
            zoom={zoom}
            onWheel={handleZoomWheel}
            onDoubleClick={handleDoubleClick}
            onPanStart={handlePanStart}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
            isPanning={isPanning}
          />

          {/* Right arrow — visible on all sizes */}
          {hasNext && !zoom.isZoomed && (
            <button
              onClick={goNext}
              className="absolute right-2 md:right-4 z-10 flex h-9 w-9 md:h-10 md:w-10 items-center justify-center bg-stone-200/60 text-stone-500 hover:bg-stone-300/80 hover:text-stone-900 transition-colors duration-300"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}

          {/* Zoom indicator */}
          {zoom.isZoomed && (
            <div className="absolute bottom-6 right-6 z-10 lightbox-open">
              <span className="text-[11px] tabular-nums text-stone-400 font-medium tracking-wider">
                {zoom.scale.toFixed(1)}x
              </span>
            </div>
          )}
        </div>

        {/* Metadata sidebar */}
        <MetadataPanel
          image={currentImage}
          detail={imageDetail}
          isLoading={isLoadingDetail}
          isOpen={isMetadataOpen}
        />
      </div>
    </div>,
    document.body
  );
}

/**
 * Bind keyboard shortcuts for the optional photographer actions.
 *
 * Lives as a sibling component so each action's shortcut can be added /
 * removed independently as the action list changes, without re-running
 * the lightbox's own keyboard effect.
 */
function ActionShortcuts({
  actions,
  image,
  onDispatch,
}: {
  actions: LightboxAction[] | undefined;
  image: ImageData;
  onDispatch: (action: LightboxAction, image: ImageData) => void | Promise<void>;
}) {
  useEffect(() => {
    if (!actions || actions.length === 0) return;

    function onKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in an input.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Don't fight modifier-key chords.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const match = actions!.find(
        (a) => a.shortcut !== undefined && a.shortcut === e.key
      );
      if (!match) return;
      e.preventDefault();
      void onDispatch(match, image);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actions, image, onDispatch]);

  return null;
}
