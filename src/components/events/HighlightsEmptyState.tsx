"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HIGHLIGHTS_STEP,
  MAX_HIGHLIGHTS,
  MIN_HIGHLIGHTS,
} from "@/lib/highlights/limits";
import { cn } from "@/lib/utils";

/**
 * What the generator learned about the event before proposing anything.
 *
 * `moments` is the number the whole feature counts in — not files. An event
 * that renders every capture twice (branded overlays) has half as many moments
 * as photos, and a reel built on files would show each one twice.
 */
export interface HighlightsPlan {
  /** Files in the event. */
  photos: number;
  /** Distinct captures after identical-timestamp renditions collapse. */
  moments: number;
  /** How many moments absorbed more than one file (0 hides the line). */
  collapsed: number;
  /** Named + unnamed persons found by face clustering, null if none ran. */
  people: number | null;
  /** Shooting span in minutes, null if capture times are missing. */
  spanMinutes: number | null;
  /** Suggested count, derived from the ratio real photographers keep. */
  recommended: number;
  /** The evidence band behind that suggestion, e.g. [15, 25]. */
  typical: [number, number];
}

export interface HighlightsIndexing {
  indexed: number;
  total: number;
  /**
   * Rough minutes left, if a rate is known. Worth threading through: the first
   * photographer to hit this state read a progress label with no number and no
   * estimate as a hang, and emailed to say the feature was stuck.
   */
  etaMinutes?: number | null;
}

function formatSpan(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * The Highlights section's empty state — and the feature's front door.
 *
 * Every event ships with a Highlights section, so this is the one surface
 * guaranteed to exist wherever the output lands. It reads the event back to
 * the photographer before asking for anything: naming the moment count (and
 * why it differs from the photo count) is what teaches the mental model the
 * rest of the flow depends on.
 *
 * Nothing here applies anything. The button opens a review.
 */
export function HighlightsEmptyState({
  plan,
  indexing,
  busy = false,
  onPreview,
  onManual,
  manualLabel = "or add them yourself",
}: {
  /** null while the event is still being read. */
  plan: HighlightsPlan | null;
  /** Present only when indexing is incomplete; blocks generation. */
  indexing?: HighlightsIndexing | null;
  busy?: boolean;
  onPreview: (opts: { count: number; coverage: boolean }) => void;
  onManual?: () => void;
  /** Label for the secondary escape — differs on a re-run, where it cancels. */
  manualLabel?: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [coverage, setCoverage] = useState(true);

  // ─── Indexing incomplete: say what it's waiting for, and don't offer a
  // button that would return a partial answer. A progress state that names no
  // reason and shows no movement is indistinguishable from a hang, which is
  // exactly how this read to the first photographer who hit it.
  if (indexing && indexing.indexed < indexing.total) {
    const pct = Math.round((indexing.indexed / indexing.total) * 100);
    return (
      <Shell>
        <p className="font-editorial text-2xl text-stone-800 italic">
          Still reading the photos
        </p>
        <p className="mt-3 max-w-md text-[13px] leading-relaxed text-stone-500">
          {indexing.indexed.toLocaleString()} of {indexing.total.toLocaleString()}{" "}
          done. Highlights waits for the whole event so it never picks from half
          of it.
        </p>
        <div className="mt-6 h-1 w-full max-w-xs overflow-hidden rounded-full bg-stone-200">
          <div
            className="h-full rounded-full bg-stone-800 transition-[width] duration-500"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <p className="mt-3 text-[12px] text-stone-400 tabular-nums">
          {pct}%
          {indexing.etaMinutes
            ? ` · about ${formatSpan(indexing.etaMinutes)} left`
            : ""}
        </p>
        <p className="mt-6 max-w-xs text-[12px] leading-relaxed text-stone-300">
          You can keep working. Nothing here needs you.
        </p>
      </Shell>
    );
  }

  if (!plan) {
    return (
      <Shell>
        <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
        <p className="mt-4 font-editorial text-xl text-stone-400 italic">
          Reading the event
        </p>
      </Shell>
    );
  }

  const value = count ?? plan.recommended;
  const pct = plan.moments ? Math.round((value / plan.moments) * 100) : 0;
  const max = Math.min(MAX_HIGHLIGHTS, Math.max(MIN_HIGHLIGHTS, plan.moments));

  const facts = [
    `${plan.photos.toLocaleString()} photos`,
    plan.collapsed > 0
      ? `${plan.collapsed.toLocaleString()} repeated captures counted once`
      : null,
    plan.people ? `${plan.people} people` : null,
    plan.spanMinutes ? `shot over ${formatSpan(plan.spanMinutes)}` : null,
  ].filter(Boolean) as string[];

  return (
    <Shell>
      <p className="font-editorial text-stone-800 italic">
        <span className="text-[44px] leading-none tracking-tight">
          {plan.moments.toLocaleString()}
        </span>
        <span className="mt-1 block text-2xl">moments in this event</span>
      </p>
      <p className="mt-4 text-[13px] text-stone-400">{facts.join("  ·  ")}</p>

      <p className="mt-6 max-w-md text-[13px] leading-relaxed text-stone-500">
        Pick a number and you&apos;ll get a set to review, swap, and cut. Nothing
        lands here until you say so.
      </p>

      <div className="mt-9 w-full max-w-sm text-left">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="hl-count"
            className="text-[11px] tracking-wide text-stone-400 uppercase"
          >
            How many
          </label>
          <span className="text-[13px] text-stone-500 tabular-nums">
            <span className="text-stone-800">{value}</span> · {pct}% of moments
          </span>
        </div>
        <input
          id="hl-count"
          type="range"
          min={MIN_HIGHLIGHTS}
          max={max}
          step={HIGHLIGHTS_STEP}
          value={value}
          onChange={(e) => setCount(Number(e.target.value))}
          className="mt-3 h-1 w-full cursor-pointer appearance-none rounded-full bg-stone-200 accent-stone-900"
        />
        {/* State the measured SPREAD, not the median. An earlier version cited
            "about 5%" while defaulting to 40 — the copy and the control
            disagreed, which reads as the product not believing itself. */}
        <p className="mt-3 text-[12px] leading-relaxed text-stone-400">
          Photographers here keep anywhere from {plan.typical[0]} to{" "}
          {plan.typical[1]} on an event this size.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCoverage((v) => !v)}
        className="mt-7 flex w-full max-w-sm items-start gap-3 text-left"
      >
        <span
          role="switch"
          aria-checked={coverage}
          className={cn(
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200",
            coverage ? "bg-stone-900" : "bg-stone-300"
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200",
              coverage ? "translate-x-[18px]" : "translate-x-[3px]"
            )}
          />
        </span>
        <span>
          <span className="block text-[13px] text-stone-700">
            Spread across the event
          </span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-stone-400">
            Balances picks across the day and the people in it. Off ranks purely
            on the photograph.
          </span>
        </span>
      </button>

      <div className="mt-9 flex items-center gap-4">
        <Button
          onClick={() => onPreview({ count: value, coverage })}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {busy ? "Choosing" : `Preview ${value} highlights`}
        </Button>
        {onManual && (
          <button
            type="button"
            onClick={onManual}
            className="text-[13px] text-stone-400 underline-offset-4 transition-colors hover:text-stone-600 hover:underline"
          >
            {manualLabel}
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {children}
    </div>
  );
}
