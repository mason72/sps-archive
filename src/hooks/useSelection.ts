"use client";

import { useState, useCallback, useMemo, useRef } from "react";

/**
 * useSelection — Manages multi-select state for the image gallery.
 * Selection-first model: checkboxes always visible, single click selects.
 * Supports toggle, range select (shift+click), marquee (addToSelection), and bulk ops.
 */
export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastSelectedIdRef = useRef<string | null>(null);

  const hasSelection = selectedIds.size > 0;
  const count = selectedIds.size;

  /** Toggle a single image. Updates lastSelectedId when adding. */
  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        lastSelectedIdRef.current = id;
      }
      return next;
    });
  }, []);

  /** Shift+click range selection: select all between lastSelectedId and targetId. */
  const rangeSelect = useCallback((targetId: string, orderedIds: string[]) => {
    const lastId = lastSelectedIdRef.current;
    if (!lastId) {
      // No previous selection — just toggle this one
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      lastSelectedIdRef.current = targetId;
      return;
    }

    const lastIndex = orderedIds.indexOf(lastId);
    const targetIndex = orderedIds.indexOf(targetId);

    if (lastIndex === -1 || targetIndex === -1) {
      // Fallback: just select the target
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      lastSelectedIdRef.current = targetId;
      return;
    }

    const start = Math.min(lastIndex, targetIndex);
    const end = Math.max(lastIndex, targetIndex);
    const rangeIds = orderedIds.slice(start, end + 1);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      rangeIds.forEach((id) => next.add(id));
      return next;
    });
    lastSelectedIdRef.current = targetId;
  }, []);

  /** Union merge for marquee/rubber-band selection. */
  const addToSelection = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    lastSelectedIdRef.current = ids[ids.length - 1];
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
    if (ids.length > 0) {
      lastSelectedIdRef.current = ids[ids.length - 1];
    }
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  }, []);

  const toggleStack = useCallback((imageIds: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = imageIds.every((id) => next.has(id));
      if (allSelected) {
        imageIds.forEach((id) => next.delete(id));
      } else {
        imageIds.forEach((id) => next.add(id));
        if (imageIds.length > 0) {
          lastSelectedIdRef.current = imageIds[imageIds.length - 1];
        }
      }
      return next;
    });
  }, []);

  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  return {
    selectedIds,
    selectedArray,
    hasSelection,
    count,
    toggle,
    rangeSelect,
    addToSelection,
    selectAll,
    deselectAll,
    toggleStack,
  };
}
