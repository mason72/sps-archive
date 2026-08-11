"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Layers, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageGrid } from "@/components/gallery/ImageGrid";
import {
  HIGHLIGHTS_STEP,
  MAX_HIGHLIGHTS,
  MIN_HIGHLIGHTS,
} from "@/lib/highlights/limits";
import { cn } from "@/lib/utils";
import type { ImageData } from "@/types/image";

/**
 * One proposed moment. `frames` is every capture that collapsed into it —
 * burst siblings and duplicate branded renditions alike — which is what makes
 * "right moment, wrong frame" a swap instead of a rejection.
 */
export interface HighlightProposal {
  momentId: string;
  /** Position in the ranked pool; 1 is the strongest. */
  rank: number;
  /** Real grid images, so the review renders through the same component the
   *  section itself uses. */
  frames: ImageData[];
  /** Index into `frames` currently representing the moment. */
  chosenIndex: number;
}

/**
 * The Highlights review — the proposal rendered *in place*, in the section's
 * own masonry, through the section's own grid component.
 *
 * Why not a bespoke contact sheet: `ImageGrid` sizes every tile to the image's
 * natural aspect ratio, so nothing is cropped, and where it does crop it honours
 * `focal_x/y`. A purpose-built review grid re-introduced a 2:3 crop the app
 * never imposes AND skipped the focal point — cutting faces in the one surface
 * whose entire job is judging photographs. Reusing the grid also means the
 * preview cannot drift from the thing it is previewing (lesson 70).
 *
 * Nothing persists until Apply. Re-thresholding is local: the pool is scored
 * once and the slider only moves a boundary, so changing your mind is free.
 */
export function HighlightsReview({
  proposals,
  initialCount,
  totalMoments,
  columnCount,
  gap = "normal",
  busy = false,
  refreshing = false,
  onApply,
  onRefresh,
  onCancel,
}: {
  /** The full ranked pool, best first. Longer than initialCount so dismissals can backfill. */
  proposals: HighlightProposal[];
  initialCount: number;
  totalMoments: number;
  /** Mirror the event's own grid settings so the preview matches the section. */
  columnCount?: number;
  gap?: "tight" | "normal" | "loose";
  busy?: boolean;
  refreshing?: boolean;
  onApply: (picks: { momentId: string; imageId: string }[]) => void;
  /**
   * Propose a different set. The parent re-runs the generator and hands back a
   * new `proposals` array; local edits reset with it, because a refresh is a
   * new proposal, not an edit to this one.
   */
  onRefresh?: () => void;
  onCancel?: () => void;
}) {
  const [count, setCount] = useState(initialCount);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [frameByMoment, setFrameByMoment] = useState<Map<string, number>>(
    new Map()
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  // A refresh replaces the proposal wholesale, so cuts, swaps and the open
  // panel belong to the old one. Keeping them would silently apply last
  // round's edits to this round's photographs.
  const proposalsRef = useRef(proposals);
  useEffect(() => {
    if (proposalsRef.current === proposals) return;
    proposalsRef.current = proposals;
    setDismissed(new Set());
    setFrameByMoment(new Map());
    setExpanded(null);
  }, [proposals]);

  const kept = useMemo(
    () => proposals.filter((p) => !dismissed.has(p.momentId)),
    [proposals, dismissed]
  );
  const shown = useMemo(() => kept.slice(0, count), [kept, count]);
  /** Ran out of pool: the slider is asking for more than survives dismissals. */
  const short = count - shown.length;

  const frameIndex = (p: HighlightProposal) =>
    frameByMoment.get(p.momentId) ?? p.chosenIndex;

  /** The chosen frame per shown moment, in rank order — what the grid renders. */
  const images = useMemo(
    () => shown.map((p) => p.frames[frameIndex(p)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, frameByMoment]
  );
  const byImageId = useMemo(() => {
    const m = new Map<string, HighlightProposal>();
    for (const p of shown) m.set(p.frames[frameIndex(p)].id, p);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, frameByMoment]);

  const picks = shown.map((p) => ({
    momentId: p.momentId,
    imageId: p.frames[frameIndex(p)].id,
  }));

  return (
    <div className="flex flex-col">
      {/* Proposal toolbar. Tinted rather than white so the section reads as a
          MODE — in-place preview otherwise looks identical to a saved section,
          and "nothing is saved" has to be legible from the page, not just from
          the copy. Three verbs, one accent: accept is the only filled button. */}
      <div className="sticky top-0 z-20 border-b border-stone-300 bg-stone-100/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <div>
            <p className="font-editorial text-lg text-stone-800 italic">
              {shown.length} highlights proposed
            </p>
            <p className="mt-0.5 text-[12px] text-stone-500">
              from {totalMoments.toLocaleString()} moments · nothing is saved
              until you accept
            </p>
          </div>

          <div className="min-w-[180px] flex-1">
            <label
              htmlFor="hl-review-count"
              className="text-[11px] tracking-wide text-stone-400 uppercase"
            >
              How many
            </label>
            <input
              id="hl-review-count"
              type="range"
              min={MIN_HIGHLIGHTS}
              max={Math.min(proposals.length, MAX_HIGHLIGHTS)}
              step={HIGHLIGHTS_STEP}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={refreshing}
              className="mt-1.5 h-1 w-full max-w-xs cursor-pointer appearance-none rounded-full bg-stone-300 accent-stone-900"
            />
            {short > 0 && (
              <p className="mt-1.5 text-[12px] text-stone-500">
                {short} more would need a longer list than we ranked.
              </p>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {onCancel && (
              <Button variant="ghost" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
            {onRefresh && (
              <Button
                variant="secondary"
                onClick={onRefresh}
                disabled={busy || refreshing}
                title="Propose a different set"
              >
                <RefreshCw
                  className={cn(
                    "mr-2 h-4 w-4",
                    refreshing && "animate-spin"
                  )}
                />
                {refreshing ? "Choosing" : "Refresh"}
              </Button>
            )}
            <Button
              onClick={() => onApply(picks)}
              disabled={busy || refreshing || !shown.length}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Accept {shown.length}
            </Button>
          </div>
        </div>

        {dismissed.size > 0 && (
          <p className="mt-3 text-[12px] text-stone-500">
            {dismissed.size} cut, backfilled from the next best.{" "}
            <button
              type="button"
              onClick={() => setDismissed(new Set())}
              className="underline underline-offset-4 hover:text-stone-800"
            >
              Restore
            </button>
          </p>
        )}
      </div>

      <div className="px-6 py-6">
        <ImageGrid
          images={images}
          stacks={[]}
          standalone={images}
          columnCount={columnCount}
          gap={gap}
          style="masonry"
          emptyTitle="Everything was cut"
          emptySubtitle="Restore some, or close and pick by hand."
          tileOverlay={(image) => {
            const p = byImageId.get(image.id);
            if (!p) return null;
            const idx = frameIndex(p);
            const isOpen = expanded === p.momentId;
            return (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setDismissed((d) => new Set(d).add(p.momentId))
                  }
                  aria-label="Cut this pick"
                  className="pointer-events-auto absolute top-2 right-2 rounded-full bg-white/85 p-1.5 text-stone-600 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-stone-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>

                {p.frames.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : p.momentId)}
                    className={cn(
                      "pointer-events-auto absolute bottom-2 left-2 flex items-center gap-1 rounded-full px-2 py-1 text-[11px] backdrop-blur transition-colors",
                      isOpen
                        ? "bg-stone-900 text-white"
                        : "bg-white/85 text-stone-600 hover:text-stone-900"
                    )}
                  >
                    <Layers className="h-3 w-3" />
                    {idx + 1} of {p.frames.length}
                  </button>
                )}

                {/* Sibling frames sit over the tile so the masonry never
                    reflows mid-review. */}
                {isOpen && (
                  <div className="pointer-events-auto absolute inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-2 backdrop-blur">
                    <p className="mb-1.5 px-0.5 text-[11px] text-stone-400">
                      Same moment, other frames
                    </p>
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {p.frames.map((f, i) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => {
                            setFrameByMoment((m) =>
                              new Map(m).set(p.momentId, i)
                            );
                            setExpanded(null);
                          }}
                          className={cn(
                            "h-14 w-11 shrink-0 overflow-hidden rounded-md border-2 transition-colors",
                            i === idx
                              ? "border-stone-900"
                              : "border-transparent hover:border-stone-300"
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            style={
                              f.focalX != null && f.focalY != null
                                ? {
                                    objectPosition: `${f.focalX}% ${f.focalY}%`,
                                  }
                                : undefined
                            }
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
