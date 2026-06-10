"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Check, Crosshair } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SmartStack } from "./SmartStack";
import { distributeBalanced, useResponsiveColumns } from "@/lib/gallery/grid-layout";
import type { ImageData, StackData } from "@/types/image";

interface ImageGridProps {
  images: ImageData[];
  stacks: StackData[];
  standalone: ImageData[];
  onToggleSelect?: (imageId: string) => void;
  onRangeSelect?: (imageId: string) => void;
  onImageDoubleClick?: (imageId: string) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  // Selection props
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  // Grid settings (from event settings)
  columnCount?: number;
  gap?: "tight" | "normal" | "loose";
  style?: "masonry" | "uniform";
  showFilenames?: boolean;
  /**
   * Manual drag-to-reorder. When true, tiles become sortable (stacks are
   * expected to be pre-expanded into `standalone` by the caller) and `onReorder`
   * fires with the full new id order on drop.
   */
  dndEnabled?: boolean;
  onReorder?: (orderedImageIds: string[]) => void;
  /**
   * Show a corner dot on tiles that have a focal point set (website slot
   * sections) — at a glance: art-directed crop vs default center crop.
   */
  showFocalBadge?: boolean;
}

/** Gap in px for each density — applied as column-gap + item margin-bottom. */
const GAP_PX = { tight: 2, normal: 6, loose: 12 } as const;

/**
 * ImageGrid — masonry via height-balanced distribution into flex columns.
 *
 * Items are packed shortest-column-first (distributeBalanced) so columns stay
 * even in height — round-robin balanced item COUNTS but not heights, which left
 * one column much taller when portrait tiles clustered in a small section. Ties
 * go to the leftmost column, so the first row still reads left-to-right. Tiles
 * keep their natural aspect ratio.
 *
 * When `dndEnabled` (the "Manual" sort), the whole grid is wrapped in a single
 * dnd-kit SortableContext spanning every tile regardless of which column div it
 * physically lives in — dnd-kit tracks geometry by measured rects, so dragging
 * across columns works, and reorder operates on the flat sequence independently
 * of the column layout. Stacks are expanded to loose tiles by the caller in this
 * mode, so every tile maps to exactly one section_images row = one sort_order.
 */
export function ImageGrid({
  stacks,
  standalone,
  onToggleSelect,
  onRangeSelect,
  onImageDoubleClick,
  onSetCover,
  hasSelection,
  selectedIds,
  columnCount: settingsColumnCount,
  gap = "normal",
  style = "masonry",
  showFilenames,
  dndEnabled,
  onReorder,
  showFocalBadge,
}: ImageGridProps) {
  const colCount = useResponsiveColumns(settingsColumnCount ?? 4);
  const gapPx = GAP_PX[gap];

  if (dndEnabled) {
    return (
      <SortableImageGrid
        standalone={standalone}
        onToggleSelect={onToggleSelect}
        onRangeSelect={onRangeSelect}
        onImageDoubleClick={onImageDoubleClick}
        hasSelection={hasSelection}
        selectedIds={selectedIds}
        colCount={colCount}
        gapPx={gapPx}
        style={style}
        showFilenames={showFilenames}
        onReorder={onReorder}
        showFocalBadge={showFocalBadge}
      />
    );
  }

  const gridItems: Array<
    | { type: "stack"; data: StackData }
    | { type: "image"; data: ImageData }
  > = [
    ...stacks.map((s) => ({ type: "stack" as const, data: s })),
    ...standalone.map((i) => ({ type: "image" as const, data: i })),
  ];

  if (gridItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-editorial text-xl text-stone-400 italic">
          No images yet
        </p>
        <p className="mt-2 text-[13px] text-stone-300">
          Upload some photos to get started
        </p>
      </div>
    );
  }

  const columns = distributeBalanced(gridItems, colCount, (item) => {
    const d = item.type === "image" ? item.data : item.data.images[0];
    return d && d.width && d.height ? d.height / d.width : 4 / 3;
  });

  const renderItem = (item: (typeof gridItems)[number]) => {
    const key =
      item.type === "stack" ? `stack-${item.data.id}` : `img-${item.data.id}`;
    return (
      <div key={key} style={{ marginBottom: `${gapPx}px` }}>
        {item.type === "stack" ? (
          <SmartStack
            stackId={item.data.id}
            stackType={item.data.stackType}
            imageCount={item.data.imageCount}
            images={item.data.images.map((img) => ({
              ...img,
              stackRank: img.stackRank ?? 0,
            }))}
            personName={item.data.personName}
            onToggleSelect={onToggleSelect}
            onImageDoubleClick={onImageDoubleClick}
            onSetCover={onSetCover}
            hasSelection={hasSelection}
            selectedIds={selectedIds}
            showFilename={showFilenames}
          />
        ) : (
          <GridImage
            image={item.data}
            hasSelection={hasSelection}
            isSelected={selectedIds?.has(item.data.id) ?? false}
            selectedIds={selectedIds}
            onSelect={() => onToggleSelect?.(item.data.id)}
            onRangeSelect={() => onRangeSelect?.(item.data.id)}
            onDoubleClick={() => onImageDoubleClick?.(item.data.id)}
            uniform={style === "uniform"}
            showFilename={showFilenames}
            sizes={`${Math.round(100 / colCount)}vw`}
            showFocalBadge={showFocalBadge}
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex items-start" style={{ gap: `${gapPx}px` }}>
      {columns.map((col, ci) => (
        <div key={ci} className="min-w-0 flex-1">
          {col.map(renderItem)}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── Manual (sortable) grid ─────────────────────── */

function SortableImageGrid({
  standalone,
  onToggleSelect,
  onRangeSelect,
  onImageDoubleClick,
  hasSelection,
  selectedIds,
  colCount,
  gapPx,
  style,
  showFilenames,
  onReorder,
  showFocalBadge,
}: {
  standalone: ImageData[];
  onToggleSelect?: (imageId: string) => void;
  onRangeSelect?: (imageId: string) => void;
  onImageDoubleClick?: (imageId: string) => void;
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  colCount: number;
  gapPx: number;
  style?: "masonry" | "uniform";
  showFilenames?: boolean;
  onReorder?: (orderedImageIds: string[]) => void;
  showFocalBadge?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const ids = useMemo(() => standalone.map((i) => i.id), [standalone]);
  const byId = useMemo(
    () => new Map(standalone.map((i) => [i.id, i])),
    [standalone]
  );

  // The move set for the in-flight drag (the whole selection if the dragged
  // tile is part of a multi-selection, else just the dragged tile).
  const moveSet = useMemo(() => {
    if (!activeId) return [] as string[];
    if (selectedIds?.has(activeId) && selectedIds.size > 1) {
      return ids.filter((id) => selectedIds.has(id)); // current visual order
    }
    return [activeId];
  }, [activeId, ids, selectedIds]);

  const sensors = useSensors(
    // 8px activation distance so a click still selects and a double-click still
    // opens the lightbox — only a real drag starts a reorder.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const active = String(e.active.id);
      const over = e.over ? String(e.over.id) : null;
      setActiveId(null);
      if (!over || over === active) return;

      const set =
        selectedIds?.has(active) && selectedIds.size > 1
          ? ids.filter((id) => selectedIds.has(id))
          : [active];
      const setLookup = new Set(set);
      if (setLookup.has(over)) return; // dropped onto a member of the move set

      const remaining = ids.filter((id) => !setLookup.has(id));
      const insertAt = remaining.indexOf(over);
      if (insertAt === -1) return;

      const next = [
        ...remaining.slice(0, insertAt),
        ...set,
        ...remaining.slice(insertAt),
      ];
      onReorder?.(next);
    },
    [ids, selectedIds, onReorder]
  );

  if (standalone.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-editorial text-xl text-stone-400 italic">
          No images in this section
        </p>
      </div>
    );
  }

  const columns = distributeBalanced(standalone, colCount, (img) =>
    img.width && img.height ? img.height / img.width : 4 / 3
  );
  const activeImage = activeId ? byId.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="flex items-start" style={{ gap: `${gapPx}px` }}>
          {columns.map((col, ci) => (
            <div key={ci} className="min-w-0 flex-1">
              {col.map((image) => (
                <div key={image.id} style={{ marginBottom: `${gapPx}px` }}>
                  <SortableTile
                    image={image}
                    isSelected={selectedIds?.has(image.id) ?? false}
                    inMoveSet={
                      activeId ? moveSet.includes(image.id) : false
                    }
                    hasSelection={hasSelection}
                    selectedIds={selectedIds}
                    onSelect={() => onToggleSelect?.(image.id)}
                    onRangeSelect={() => onRangeSelect?.(image.id)}
                    onDoubleClick={() => onImageDoubleClick?.(image.id)}
                    uniform={style === "uniform"}
                    showFilename={showFilenames}
                    sizes={`${Math.round(100 / colCount)}vw`}
                    showFocalBadge={showFocalBadge}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeImage ? (
          <div className="relative w-full opacity-90 shadow-2xl ring-2 ring-accent">
            <div
              className="relative w-full bg-stone-100"
              style={{
                aspectRatio:
                  style === "uniform"
                    ? "1 / 1"
                    : activeImage.width && activeImage.height
                    ? `${activeImage.width} / ${activeImage.height}`
                    : "3 / 4",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={activeImage.thumbnailUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            {moveSet.length > 1 && (
              <div className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white shadow-md">
                {moveSet.length}
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** A reorderable tile: GridImage wrapped in dnd-kit useSortable. */
function SortableTile({
  image,
  isSelected,
  inMoveSet,
  hasSelection,
  selectedIds,
  onSelect,
  onRangeSelect,
  onDoubleClick,
  uniform,
  showFilename,
  sizes,
  showFocalBadge,
}: {
  image: ImageData;
  isSelected: boolean;
  inMoveSet: boolean;
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  onSelect: () => void;
  onRangeSelect: () => void;
  onDoubleClick: () => void;
  uniform?: boolean;
  showFilename?: boolean;
  sizes?: string;
  showFocalBadge?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const styleObj = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Hide the originals being dragged (the DragOverlay shows them following the
    // cursor); the whole move set fades so a multi-drag reads as one gesture.
    opacity: isDragging || inMoveSet ? 0.35 : 1,
    touchAction: "none" as const,
  };

  return (
    <div ref={setNodeRef} style={styleObj} {...attributes} {...listeners}>
      <GridImage
        image={image}
        hasSelection={hasSelection}
        isSelected={isSelected}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onRangeSelect={onRangeSelect}
        onDoubleClick={onDoubleClick}
        uniform={uniform}
        showFilename={showFilename}
        dndManaged
        sizes={sizes}
        showFocalBadge={showFocalBadge}
      />
    </div>
  );
}

/** Individual grid cell with natural aspect ratio + fade-in on load.
 *  Selection-first: single click → select, double click → lightbox.
 */
function GridImage({
  image,
  onSelect,
  onRangeSelect,
  onDoubleClick,
  hasSelection,
  isSelected,
  selectedIds,
  uniform,
  showFilename,
  dndManaged,
  sizes,
  showFocalBadge,
}: {
  image: ImageData;
  onSelect: () => void;
  onRangeSelect: () => void;
  onDoubleClick: () => void;
  hasSelection?: boolean;
  isSelected?: boolean;
  selectedIds?: Set<string>;
  uniform?: boolean;
  showFilename?: boolean;
  /** True when a parent dnd-kit sortable owns the drag gesture. */
  dndManaged?: boolean;
  /** Rendered tile width hint for srcset selection (e.g. "20vw"). */
  sizes?: string;
  /** Mark tiles whose focal point is set (website slot sections). */
  showFocalBadge?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // One-shot guard so the on-error original fallback can't loop.
  const triedFallback = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Shift+click → range select (immediate, no debounce)
      if (e.shiftKey) {
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        onRangeSelect();
        return;
      }

      // Single click debounced — wait 200ms to see if double-click follows
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onSelect();
      }, 200);
    },
    [onSelect, onRangeSelect]
  );

  const handleDoubleClick = useCallback(() => {
    // Cancel the pending single-click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick();
  }, [onDoubleClick]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // If this image is selected, drag all selected images; otherwise just this one
      const ids = isSelected && selectedIds?.size ? Array.from(selectedIds) : [image.id];
      e.dataTransfer.setData("application/x-image-ids", JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "move";
    },
    [image.id, isSelected, selectedIds]
  );

  return (
    <button
      data-image-id={image.id}
      // In manual mode the parent dnd-kit sortable owns dragging; native HTML5
      // drag (used elsewhere to drop images onto sidebar sections) is disabled
      // to avoid two drag systems fighting on one element.
      draggable={!dndManaged}
      onDragStart={dndManaged ? undefined : handleDragStart}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group relative block w-full overflow-hidden bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${
        isSelected ? "ring-2 ring-accent ring-inset" : ""
      }`}
    >
      {/* Selection checkbox — always visible */}
      <div className="absolute top-2 left-2 z-10">
        <div
          className={`w-5 h-5 border-2 flex items-center justify-center transition-all duration-150 ${
            isSelected
              ? "bg-accent border-accent"
              : hasSelection
              ? "border-white/80 bg-black/20 backdrop-blur-sm"
              : "border-white/60 bg-black/10 backdrop-blur-sm opacity-0 group-hover:opacity-100"
          }`}
        >
          {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
        </div>
      </div>

      {/* Selection overlay tint */}
      {isSelected && (
        <div className="absolute inset-0 bg-accent/10 z-[1] pointer-events-none" />
      )}

      {/* Focal point set — this slot crop is art-directed, not center-cropped */}
      {showFocalBadge && image.focalX != null && image.focalY != null && (
        <div
          className="absolute top-2 right-2 z-[2] flex h-5 w-5 items-center justify-center border border-white/40 bg-black/30 backdrop-blur-sm pointer-events-none"
          title="Focal point set"
        >
          <Crosshair className="h-3 w-3 text-white" />
        </div>
      )}

      {/* Fixed-aspect box. Reserving the tile's FINAL height up front (from the
          image's known dimensions) means the image loads into already-correct
          space — zero layout shift, so CSS multicol never re-balances mid-load.
          That eliminated the grid-wide flicker as lazy images streamed in.
          Falls back to 3:4 only when dimensions are unknown. */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: uniform
            ? "1 / 1"
            : image.width && image.height
            ? `${image.width} / ${image.height}`
            : "3 / 4",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={image.thumbnailUrl}
          // Wide tiles on retina displays need more than the 400px thumb or
          // they upscale visibly soft — offer the 800px rendition and let the
          // browser pick by rendered width × DPR.
          srcSet={
            image.thumbnailLgUrl
              ? `${image.thumbnailUrl} 400w, ${image.thumbnailLgUrl} 800w`
              : undefined
          }
          sizes={image.thumbnailLgUrl ? sizes : undefined}
          alt={image.parsedName || image.originalFilename || ""}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={async () => {
            // Thumbnail missing/broken. SELF-HEAL: ask the server to rebuild it
            // from the original, then swap in the fresh thumbnail — so the gap
            // is permanently fixed for next load, not patched every time. Falls
            // back to the signed original if regeneration fails. One-shot
            // guarded so it can't loop.
            if (!imgRef.current || triedFallback.current) {
              setLoaded(true); // stop hiding the (broken) tile
              return;
            }
            triedFallback.current = true;
            try {
              const regen = await fetch(
                `/api/images/${image.id}/regenerate-thumbnail`,
                { method: "POST" }
              );
              if (regen.ok) {
                const { thumbnailUrl } = await regen.json();
                if (thumbnailUrl && imgRef.current) {
                  imgRef.current.srcset = ""; // srcset outranks src — clear it
                  imgRef.current.src = thumbnailUrl;
                  return;
                }
              }
              // Regeneration failed — fall back to the signed original.
              const res = await fetch(`/api/images/${image.id}`);
              if (res.ok) {
                const detail = await res.json();
                const url = detail.originalUrl || detail.thumbnailUrl;
                if (url && imgRef.current) {
                  imgRef.current.srcset = "";
                  imgRef.current.src = url;
                  return;
                }
              }
            } catch {
              /* fall through */
            }
            setLoaded(true);
          }}
        />
      </div>
      {showFilename && image.originalFilename && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 pointer-events-none z-[2]">
          <p className="text-[11px] text-white truncate">
            {image.originalFilename}
          </p>
        </div>
      )}
    </button>
  );
}
