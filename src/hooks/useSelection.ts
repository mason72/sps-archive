"use client";

import { useState, useCallback, useMemo } from "react";

/**
 * useSelection — Manages multi-select state for the image gallery.
 * Tracks selected image IDs and provides toggle/bulk operations.
 */
export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isSelecting = selectedIds.size > 0;
  const count = selectedIds.size;

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleStack = useCallback((imageIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = imageIds.every((id) => next.has(id));
      if (allSelected) {
        imageIds.forEach((id) => next.delete(id));
      } else {
        imageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  return {
    selectedIds,
    selectedArray,
    isSelecting,
    count,
    toggle,
    selectAll,
    deselectAll,
    toggleStack,
  };
}
