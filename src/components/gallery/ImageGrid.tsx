"use client";

import { useState, useRef, useCallback, useMemo } from "react";
import { Check, Crosshair, Play } from "lucide-react";
import { formatDuration } from "@/lib/upload/media";
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
import { reorderWithStacks } from "@/lib/gallery/reorder";
import { SmartStack } from "./SmartStack";
import { distributeBalanced, useResponsiveColumns } from "@/lib/gallery/grid-layout";
import type { ImageData, StackData } from "@/types/image";

/** How long a "pending" row counts as an upload-in-progress (placeholder tile,
 *  no thumbnail fetch) before we treat it as a straggler worth loading. */
const SETTLE_WINDOW_MS = 15 * 60 * 1000;

/** Page-wide cap on concurrent self-heal regenerations. Each one downloads the
 *  original and runs sharp ×3 server-side — a grid of broken tiles must
 *  trickle-heal, never stampede (the amplifier in the eBay incident). */
let regenInFlight = 0;
const REGEN_MAX_CONCURRENT = 3;

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
  /**
   * TDP Work job sections: the first image by drag order is the job's cover
   * on the website — badge it so the team knows what leads.
   */
  coverImageId?: string | null;
  /**
   * Per-image slot badge keyed by image id (TDP Website scenes): which page
   * position each photo fills. Computed by the page from the active scene +
   * manual drag order — the grid just renders what it's given. See TileBadge.
   */
  positionBadges?: Map<string, TileBadge>;
}

/**
 * A corner badge telling the team how a tile maps to the live site:
 *  - position: this photo fills a specific, ordered page spot (label = the
 *    position number, or the item name once the registry carries one)
 *  - extra: beyond the page's used count — won't appear on the site (dimmed)
 *  - cover: the single image the page uses (slot scenes / OG)
 *  - pinned: a pinned-prefix pool tile that always renders
 */
export interface TileBadge {
  label: string;
  variant: "position" | "extra" | "cover" | "pinned";
  /** Full text for the tooltip (e.g. "Position 3 — Touch-ups"). */
  title?: string;
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
  coverImageId,
  positionBadges,
}: ImageGridProps) {
  const colCount = useResponsiveColumns(settingsColumnCount ?? 4);
  const gapPx = GAP_PX[gap];

  if (dndEnabled) {
    return (
      <SortableImageGrid
        stacks={stacks}
        standalone={standalone}
        onSetCover={onSetCover}
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
        coverImageId={coverImageId}
        positionBadges={positionBadges}
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
            isCover={item.data.id === coverImageId}
            badge={positionBadges?.get(item.data.id)}
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
  stacks,
  standalone,
  onSetCover,
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
  coverImageId,
  positionBadges,
}: {
  stacks: StackData[];
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
  coverImageId?: string | null;
  positionBadges?: Map<string, TileBadge>;
  onSetCover?: (stackId: string, imageId: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // A sortable ITEM is a stack or a loose image. The manual order persisted
  // server-side is still one row per image, so a stack is expanded back into
  // its members on drop — the stack is a handle, not a new kind of record.
  type SortItem =
    | { type: "stack"; id: string; data: StackData }
    | { type: "image"; id: string; data: ImageData };

  const items = useMemo<SortItem[]>(
    () => [
      ...stacks.map((st) => ({ type: "stack" as const, id: st.id, data: st })),
      ...standalone.map((img) => ({ type: "image" as const, id: img.id, data: img })),
    ],
    [stacks, standalone]
  );

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items]
  );
  /** Item id -> the image ids it stands for, in display order. */
  const expand = useCallback(
    (id: string): string[] => {
      const item = itemById.get(id);
      if (!item) return [];
      return item.type === "stack"
        ? item.data.images.map((img) => img.id)
        : [item.data.id];
    },
    [itemById]
  );

  // The move set for the in-flight drag (the whole selection if the dragged
  // tile is part of a multi-selection, else just the dragged tile).
  // Multi-select drag applies to loose images only; a stack always moves as
  // itself, which is the whole point of dragging one.
  const moveSet = useMemo(() => {
    if (!activeId) return [] as string[];
    const active = itemById.get(activeId);
    if (active?.type === "image" && selectedIds?.has(activeId) && selectedIds.size > 1) {
      return ids.filter((id) => itemById.get(id)?.type === "image" && selectedIds.has(id));
    }
    return [activeId];
  }, [activeId, ids, itemById, selectedIds]);

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

      const activeItem = itemById.get(active);
      const set =
        activeItem?.type === "image" && selectedIds?.has(active) && selectedIds.size > 1
          ? ids.filter((id) => itemById.get(id)?.type === "image" && selectedIds.has(id))
          : [active];

      // Expansion back to image ids lives in @/lib/gallery/reorder, with the
      // "output is always a permutation of every image on screen" invariant
      // under test — dropping or duplicating an id here corrupts a section.
      const next = reorderWithStacks({ ids, expand, active, over, moveSet: set });
      if (next) onReorder?.(next);
    },
    [ids, itemById, expand, selectedIds, onReorder]
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="font-editorial text-xl text-stone-400 italic">
          No images in this section
        </p>
      </div>
    );
  }

  const columns = distributeBalanced(items, colCount, (item) => {
    const d = item.type === "image" ? item.data : item.data.images[0];
    return d && d.width && d.height ? d.height / d.width : 4 / 3;
  });
  const activeItem = activeId ? itemById.get(activeId) : null;
  const activeImage = activeItem
    ? activeItem.type === "image"
      ? activeItem.data
      : activeItem.data.images[0]
    : null;
  const activeStackCount =
    activeItem?.type === "stack" ? activeItem.data.imageCount : 0;

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
              {col.map((item) =>
                item.type === "stack" ? (
                  <div key={item.id} style={{ marginBottom: `${gapPx}px` }}>
                    <SortableStackTile
                      stack={item.data}
                      inMoveSet={activeId ? moveSet.includes(item.id) : false}
                      onToggleSelect={onToggleSelect}
                      onImageDoubleClick={onImageDoubleClick}
                      onSetCover={onSetCover}
                      hasSelection={hasSelection}
                      selectedIds={selectedIds}
                      showFilename={showFilenames}
                    />
                  </div>
                ) : (
                  <div key={item.id} style={{ marginBottom: `${gapPx}px` }}>
                    <SortableTile
                      image={item.data}
                      isSelected={selectedIds?.has(item.id) ?? false}
                      inMoveSet={activeId ? moveSet.includes(item.id) : false}
                      hasSelection={hasSelection}
                      selectedIds={selectedIds}
                      onSelect={() => onToggleSelect?.(item.id)}
                      onRangeSelect={() => onRangeSelect?.(item.id)}
                      onDoubleClick={() => onImageDoubleClick?.(item.id)}
                      uniform={style === "uniform"}
                      showFilename={showFilenames}
                      sizes={`${Math.round(100 / colCount)}vw`}
                      showFocalBadge={showFocalBadge}
                      isCover={item.id === coverImageId}
                      badge={positionBadges?.get(item.id)}
                    />
                  </div>
                )
              )}
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
                style={
                  activeImage.focalX != null && activeImage.focalY != null
                    ? {
                        objectPosition: `${activeImage.focalX}% ${activeImage.focalY}%`,
                      }
                    : undefined
                }
              />
            </div>
            {(activeStackCount > 1 || moveSet.length > 1) && (
              <div className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white shadow-md">
                {activeStackCount > 1 ? activeStackCount : moveSet.length}
              </div>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * A reorderable STACK: SmartStack wrapped in useSortable, so a person's whole
 * set moves as one gesture. Dropping it expands to its member image ids (see
 * handleDragEnd), keeping the persisted manual order one row per image.
 */
function SortableStackTile({
  stack,
  inMoveSet,
  onToggleSelect,
  onImageDoubleClick,
  onSetCover,
  hasSelection,
  selectedIds,
  showFilename,
}: {
  stack: StackData;
  inMoveSet: boolean;
  onToggleSelect?: (imageId: string) => void;
  onImageDoubleClick?: (imageId: string) => void;
  onSetCover?: (stackId: string, imageId: string) => void;
  hasSelection?: boolean;
  selectedIds?: Set<string>;
  showFilename?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stack.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging || inMoveSet ? 0.35 : 1,
        touchAction: "none" as const,
      }}
      {...attributes}
      {...listeners}
    >
      <SmartStack
        stackId={stack.id}
        stackType={stack.stackType}
        imageCount={stack.imageCount}
        images={stack.images.map((img) => ({ ...img, stackRank: img.stackRank ?? 0 }))}
        personName={stack.personName}
        onToggleSelect={onToggleSelect}
        onImageDoubleClick={onImageDoubleClick}
        onSetCover={onSetCover}
        hasSelection={hasSelection}
        selectedIds={selectedIds}
        showFilename={showFilename}
      />
    </div>
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
  isCover,
  badge,
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
  isCover?: boolean;
  badge?: TileBadge;
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
        isCover={isCover}
        badge={badge}
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
  isCover,
  badge,
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
  /** First image of a job section — the website cover for that job. */
  isCover?: boolean;
  /** Slot-mapping badge for TDP Website scenes (position / cover / extra). */
  badge?: TileBadge;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // One-shot guard so the on-error original fallback can't loop.
  const triedFallback = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // An upload still settling (row "pending" and freshly created) has no
  // derivative yet BY DESIGN — requesting one can only 404, and before this
  // guard that 404 fired a regenerate call whose original-download + sharp run
  // piled onto the already-busy upload functions. During a burst upload the
  // grid refreshes every ~1.5s, so that feedback loop produced 800+ pointless
  // 500s in the eBay HEADSHOTS incident. Render a quiet placeholder instead;
  // the live refresh swaps the real tile in as soon as the row completes.
  const isSettling =
    image.processingStatus === "pending" &&
    Date.now() - new Date(image.createdAt).getTime() < SETTLE_WINDOW_MS;

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

      {/* Job cover — the first image by drag order leads the job on the site */}
      {isCover && (
        <div className="absolute bottom-2 left-2 z-[2] border border-white/40 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.15em] text-white pointer-events-none">
          Cover
        </div>
      )}

      {/* Slot mapping — where this photo lands on the live site (TDP Website
          scenes). Position numbers/labels for ordered scenes, cover for slots,
          and a dimmed "extra" for tiles past the page's used count. */}
      {badge && (
        <div
          className={`absolute bottom-2 left-2 z-[2] max-w-[calc(100%-1rem)] truncate border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] backdrop-blur-sm pointer-events-none ${
            badge.variant === "position"
              ? "border-accent bg-accent/90 text-white"
              : badge.variant === "extra"
              ? "border-white/30 bg-stone-900/55 text-white/80"
              : "border-white/40 bg-black/45 text-white"
          }`}
          title={badge.title ?? badge.label}
        >
          {badge.label}
        </div>
      )}
      {/* "Extra" tiles won't appear on the site — wash them back so the used
          set reads first. */}
      {badge?.variant === "extra" && (
        <div className="absolute inset-0 z-[1] bg-white/50 pointer-events-none" />
      )}

      {/* Video — poster tile with a play marker + duration */}
      {image.mediaType === "video" && (
        <div className="absolute bottom-2 right-2 z-[2] flex items-center gap-1 border border-white/40 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 pointer-events-none">
          <Play className="h-2.5 w-2.5 text-white" fill="currentColor" />
          {image.durationSeconds != null && (
            <span className="text-[10px] font-medium tabular-nums text-white">
              {formatDuration(image.durationSeconds)}
            </span>
          )}
        </div>
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
        {isSettling ? (
          // Upload in flight — no derivative exists yet. Quiet pulse, no fetch.
          <div className="absolute inset-0 animate-pulse bg-stone-200/70" />
        ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
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
          // Cropped tiles (uniform mode, or the 3:4 fallback when dimensions
          // are unknown) keep the subject in frame, same as the website.
          style={
            image.focalX != null && image.focalY != null
              ? { objectPosition: `${image.focalX}% ${image.focalY}%` }
              : undefined
          }
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
            // A pending row past the settle window either has no original yet
            // or never will (ghost) — regenerating can't succeed and the storm
            // it feeds is worse than a placeholder. The live refresh or the
            // nightly reconciler resolves the row either way.
            if (image.processingStatus === "pending") {
              imgRef.current.style.display = "none";
              setLoaded(true);
              return;
            }
            try {
              if (regenInFlight < REGEN_MAX_CONCURRENT) {
                regenInFlight++;
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
                  } else if (regen.status === 410) {
                    // Original is gone from storage (confirmed ghost) — the
                    // original fallback below would fail too. Placeholder it;
                    // the nightly reconciler removes the row.
                    if (imgRef.current) imgRef.current.style.display = "none";
                    setLoaded(true);
                    return;
                  }
                } finally {
                  regenInFlight--;
                }
              }
              // Videos: regeneration re-queues the poster job (async) and the
              // "original" is an mp4 an <img> can't render — keep the
              // placeholder; the poster appears on the next refresh.
              if (image.mediaType === "video") {
                setLoaded(true);
                return;
              }
              // Regeneration failed/skipped — fall back to the signed original.
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
        )}
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
