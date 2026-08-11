"use client";

import { useState } from "react";
import {
  HighlightsEmptyState,
  type HighlightsPlan,
} from "@/components/events/HighlightsEmptyState";
import {
  suggestedHighlightCount,
  typicalRangeFor,
} from "@/lib/highlights/limits";

/**
 * Playground for the Highlights generator's front door (companion to
 * /dev/buttons). Fixtures are the real numbers from the Jordan x Kids Foot
 * Locker event so the copy is exercised against a shape that actually exists:
 * 679 files that are only 358 moments, because every capture ships in two
 * branded renditions.
 */
const FOOT_LOCKER: HighlightsPlan = {
  photos: 679,
  moments: 358,
  collapsed: 272,
  people: 87,
  spanMinutes: 296,
  recommended: suggestedHighlightCount(358),
  typical: typicalRangeFor(358),
};

/** A plainer event: no duplicate renditions, no faces indexed. */
const PLAIN: HighlightsPlan = {
  photos: 1240,
  moments: 1240,
  collapsed: 0,
  people: null,
  spanMinutes: 512,
  recommended: suggestedHighlightCount(1240),
  typical: typicalRangeFor(1240),
};

const CASES = ["collapsed", "plain", "indexing", "reading", "busy"] as const;
type CaseKey = (typeof CASES)[number];

export default function DevHighlightsPage() {
  const [log, setLog] = useState<string[]>([]);
  const [only, setOnly] = useState<CaseKey | null>(null);
  const push = (s: string) => setLog((l) => [`${l.length + 1}. ${s}`, ...l]);
  const shows = (k: CaseKey) => !only || only === k;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-8 py-16">
        <h1 className="font-editorial text-3xl text-stone-900 italic">
          Highlights generator
        </h1>
        <p className="mt-2 text-[13px] text-stone-500">
          The empty state of every event&apos;s Highlights section. Fixtures are
          the real Foot Locker numbers.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Chip active={!only} onClick={() => setOnly(null)}>
            all
          </Chip>
          {CASES.map((c) => (
            <Chip key={c} active={only === c} onClick={() => setOnly(c)}>
              {c}
            </Chip>
          ))}
        </div>

        {log.length > 0 && (
          <pre className="mt-6 rounded-lg bg-stone-900 px-4 py-3 text-[12px] leading-relaxed text-stone-200">
            {log.join("\n")}
          </pre>
        )}

        {shows("collapsed") && (
          <Case label="Ready — duplicate renditions collapsed">
            <HighlightsEmptyState
              plan={FOOT_LOCKER}
              onPreview={(o) =>
                push(`preview count=${o.count} coverage=${o.coverage}`)
              }
              onManual={() => push("manual")}
            />
          </Case>
        )}

        {shows("plain") && (
          <Case label="Ready — plain event, no faces indexed">
            <HighlightsEmptyState
              plan={PLAIN}
              onPreview={(o) =>
                push(`preview count=${o.count} coverage=${o.coverage}`)
              }
              onManual={() => push("manual")}
            />
          </Case>
        )}

        {shows("indexing") && (
          <Case label="Indexing incomplete — generation blocked">
            <HighlightsEmptyState
              plan={FOOT_LOCKER}
              indexing={{ indexed: 412, total: 679, etaMinutes: 9 }}
              onPreview={() => push("should not fire")}
            />
          </Case>
        )}

        {shows("reading") && (
          <Case label="Reading the event">
            <HighlightsEmptyState plan={null} onPreview={() => {}} />
          </Case>
        )}

        {shows("busy") && (
          <Case label="Busy — choosing">
            <HighlightsEmptyState
              plan={FOOT_LOCKER}
              busy
              onPreview={() => {}}
              onManual={() => {}}
            />
          </Case>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-stone-900 px-3 py-1 text-[12px] text-white"
          : "rounded-full border border-stone-200 px-3 py-1 text-[12px] text-stone-500 hover:border-stone-300"
      }
    >
      {children}
    </button>
  );
}

function Case({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <p className="text-[11px] tracking-wide text-stone-400 uppercase">
        {label}
      </p>
      <div className="mt-3 rounded-xl border border-stone-200">{children}</div>
    </section>
  );
}
