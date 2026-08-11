"use client";

import { useState, useTransition } from "react";
import {
  HighlightsReview,
  type HighlightProposal,
} from "@/components/events/HighlightsReview";
import { DEFAULT_HIGHLIGHTS } from "@/lib/highlights/limits";

/** Client wrapper so the server page can stay a pure data loader. */
export function ReviewPlayground({
  proposals,
  totalMoments,
}: {
  proposals: HighlightProposal[];
  totalMoments: number;
}) {
  const [pool, setPool] = useState(proposals);
  const [applied, setApplied] = useState<
    { momentId: string; imageId: string }[] | null
  >(null);
  const [refreshing, startRefresh] = useTransition();

  // Stand-in for re-running the generator: rotate the ranked pool so a refresh
  // genuinely returns different photographs. The real one re-scores; what this
  // exercises is the contract — a NEW proposals array, and local cuts/swaps
  // resetting with it.
  const refresh = () =>
    startRefresh(() =>
      setPool((p) => {
        const shift = 7;
        return [...p.slice(shift), ...p.slice(0, shift)].map((x, i) => ({
          ...x,
          rank: i + 1,
        }));
      })
    );

  return (
    <>
      {applied && (
        <div className="mx-auto max-w-6xl px-8 pb-4">
          <pre className="max-h-40 overflow-auto rounded-lg bg-stone-900 px-4 py-3 text-[12px] leading-relaxed text-stone-200">
            {`accepted ${applied.length} picks\n` +
              applied
                .slice(0, 6)
                .map((p) => `${p.momentId}  →  ${p.imageId}`)
                .join("\n") +
              (applied.length > 6 ? `\n… ${applied.length - 6} more` : "")}
          </pre>
        </div>
      )}
      <HighlightsReview
        proposals={pool}
        initialCount={DEFAULT_HIGHLIGHTS}
        totalMoments={totalMoments}
        // Mirrors an event's own grid setting — the review must look like the
        // section it is previewing, not like a bespoke contact sheet.
        columnCount={6}
        refreshing={refreshing}
        onApply={setApplied}
        onRefresh={refresh}
        onCancel={() => setApplied(null)}
      />
    </>
  );
}
