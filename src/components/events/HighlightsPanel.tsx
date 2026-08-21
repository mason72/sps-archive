"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  HighlightsEmptyState,
  type HighlightsPlan,
} from "./HighlightsEmptyState";
import {
  HighlightsReview,
  type HighlightProposal,
} from "./HighlightsReview";
import type { ImageData } from "@/types/image";

/**
 * The Highlights generator, end to end: read the event, propose a set, review
 * it in place, accept it.
 *
 * Lives as one component so the editor page only has to decide *when* to show
 * it — the flow, its three endpoints and every intermediate state stay here
 * rather than being smeared across a 2,500-line page.
 *
 * Nothing writes until Accept. Accepting replaces the section's membership and
 * hands control back to the normal grid via `onApplied`.
 */
export function HighlightsPanel({
  eventId,
  columnCount,
  gap,
  existingCount = 0,
  aiReady = true,
  onApplied,
  onDismiss,
}: {
  eventId: string;
  columnCount?: number;
  gap?: "tight" | "normal" | "loose";
  /** Photos already in Highlights — a re-run REPLACES them, so say so. */
  existingCount?: number;
  /**
   * The page's live AI status (from the processing banner's poll). The plan is
   * re-read when this flips true, so the "Still reading the photos" state turns
   * into the generator on its own. It used to be fetched once on mount, which
   * froze the progress bar at whatever it said when the section was opened —
   * Justin watched AI finish in the banner and had to reload to get Highlights
   * back (2026-08-21).
   */
  aiReady?: boolean;
  /** Refresh the editor's sections/images once a set has been saved. */
  onApplied: () => void;
  /** Leave the generator without saving (re-run only). */
  onDismiss?: () => void;
}) {
  const [plan, setPlan] = useState<HighlightsPlan | null>(null);
  const [indexing, setIndexing] = useState<{ indexed: number; total: number } | null>(null);
  const [proposals, setProposals] = useState<HighlightProposal[] | null>(null);
  const [totalMoments, setTotalMoments] = useState(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [coverage, setCoverage] = useState(true);

  const waiting = indexing !== null && indexing.indexed < indexing.total;

  // Read the plan on mount, again whenever AI reports ready, and on a slow
  // poll while indexing is incomplete (belt and braces: the banner's own poll
  // can miss the flip if the page was opened after it settled).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/highlights/plan`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        setIndexing(data.indexing ?? null);
        setPlan({
          photos: data.photos,
          moments: data.moments,
          collapsed: data.collapsed,
          people: data.people,
          spanMinutes: data.spanMinutes,
          recommended: data.recommended,
          typical: data.typical,
        });
      } catch {
        if (!cancelled) toast.error("Could not read this event");
      }
    };
    void load();
    const timer = waiting ? setInterval(load, 30_000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [eventId, aiReady, waiting]);

  const propose = useCallback(
    async (opts: { count: number; coverage: boolean }, mode: "first" | "refresh") => {
      if (mode === "first") setBusy(true);
      else setRefreshing(true);
      try {
        const res = await fetch(`/api/events/${eventId}/highlights/propose`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setTotalMoments(data.totalMoments);
        setCount(data.count);
        setCoverage(opts.coverage);
        setProposals(
          (data.proposals as { momentId: string; rank: number; chosenIndex: number; frames: ImageData[] }[]).map(
            (p) => ({
              momentId: p.momentId,
              rank: p.rank,
              chosenIndex: p.chosenIndex,
              frames: p.frames,
            })
          )
        );
        if (data.ranker === "unranked") {
          toast("Ranked by capture order — accept a few sets and it learns your eye");
        }
      } catch {
        toast.error("Could not choose highlights");
      } finally {
        setBusy(false);
        setRefreshing(false);
      }
    },
    [eventId]
  );

  const apply = useCallback(
    async (picks: { momentId: string; imageId: string }[]) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/events/${eventId}/highlights/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ picks }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        toast.success(`${data.applied} highlights saved`);
        setProposals(null);
        onApplied();
      } catch {
        toast.error("Could not save highlights");
      } finally {
        setBusy(false);
      }
    },
    [eventId, onApplied]
  );

  if (proposals) {
    return (
      <HighlightsReview
        proposals={proposals}
        initialCount={count}
        totalMoments={totalMoments}
        columnCount={columnCount}
        gap={gap}
        busy={busy}
        refreshing={refreshing}
        replacingCount={existingCount}
        onApply={apply}
        // A refresh re-proposes with the same shape; the review resets its own
        // cuts and swaps when the proposals array changes.
        onRefresh={() => propose({ count, coverage }, "refresh")}
        onCancel={() => {
          setProposals(null);
          onDismiss?.();
        }}
      />
    );
  }

  return (
    <HighlightsEmptyState
      plan={plan}
      indexing={indexing}
      busy={busy}
      onPreview={(opts) => propose(opts, "first")}
      // Only a re-run has something to back out of; on a genuinely empty
      // section this link would have been a no-op.
      onManual={existingCount > 0 ? onDismiss : undefined}
      manualLabel="or leave it as it is"
    />
  );
}
