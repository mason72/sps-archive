"use client";

import { useEffect, useCallback, useState } from "react";

interface GalleryShortcutActions {
  /** Select all visible images */
  onSelectAll?: () => void;
  /** Deselect all */
  onDeselectAll?: () => void;
  /** Favorite selected images */
  onFavoriteSelected?: () => void;
  /** Delete selected images */
  onDeleteSelected?: () => void;
  /** Toggle upload zone */
  onToggleUpload?: () => void;
  /** Open share modal */
  onShare?: () => void;
  /** Current selection count (to gate certain actions) */
  selectionCount?: number;
  /** Whether shortcuts should be active */
  enabled?: boolean;
}

/**
 * useGalleryShortcuts — Keyboard shortcuts for the event/gallery page.
 *
 * Shortcuts:
 *   A — Select all visible images
 *   D — Deselect all
 *   F — Favorite selected images
 *   Delete/Backspace — Delete selected images
 *   U — Toggle upload zone
 *   S — Open share modal
 *   ? — Toggle shortcuts help overlay
 */
export function useGalleryShortcuts({
  onSelectAll,
  onDeselectAll,
  onFavoriteSelected,
  onDeleteSelected,
  onToggleUpload,
  onShare,
  selectionCount = 0,
  enabled = true,
}: GalleryShortcutActions) {
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture when user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't capture when modifier keys are held (except for ⌘K which is handled by CommandPalette)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "a":
        case "A":
          e.preventDefault();
          onSelectAll?.();
          break;

        case "d":
          // lowercase d only — uppercase D might conflict with other things
          e.preventDefault();
          onDeselectAll?.();
          break;

        case "f":
        case "F":
          if (selectionCount > 0) {
            e.preventDefault();
            onFavoriteSelected?.();
          }
          break;

        case "Delete":
        case "Backspace":
          if (selectionCount > 0) {
            e.preventDefault();
            onDeleteSelected?.();
          }
          break;

        case "u":
        case "U":
          e.preventDefault();
          onToggleUpload?.();
          break;

        case "s":
        case "S":
          e.preventDefault();
          onShare?.();
          break;

        case "?":
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
      }
    },
    [
      enabled,
      onSelectAll,
      onDeselectAll,
      onFavoriteSelected,
      onDeleteSelected,
      onToggleUpload,
      onShare,
      selectionCount,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp };
}
