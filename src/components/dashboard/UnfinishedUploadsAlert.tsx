"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

interface UnfinishedEvent {
  eventId: string;
  name: string;
  count: number;
}

interface Summary {
  total: number;
  events: UnfinishedEvent[];
  truncated: boolean;
}

/**
 * Stores the total last dismissed, so the alert can be cleared without going
 * permanently blind. Suppresses ONLY an exact repeat — dismissing a 2,258-file
 * loss must never silence a later 5-file one.
 */
const DISMISSED_KEY = "pixeltrunk:unfinished-summary-dismissed";

/**
 * UnfinishedUploadsAlert — dashboard-level "the archive is incomplete" signal.
 *
 * The per-event banner only speaks to someone already looking at the broken
 * gallery, which is the one gallery you have no reason to open when you believe
 * the upload finished. This is what reaches you when you aren't looking: it
 * sits above the stats row, names the galleries, and links straight to them.
 */
export function UnfinishedUploadsAlert() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/upload/unfinished-summary")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Summary | null) => {
          if (!data || !data.total) return setSummary(null);
          let dismissed = 0;
          try {
            dismissed = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
          } catch {
            /* storage unavailable — better to show it than to hide it */
          }
          setSummary(data.total === dismissed ? null : data);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("events-changed", load);
    return () => window.removeEventListener("events-changed", load);
  }, []);

  if (!summary) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(summary.total));
    } catch {
      /* nothing to persist */
    }
    setSummary(null);
  };

  return (
    <div className="px-8 md:px-16 pt-6">
      <div className="max-w-5xl border border-amber-200 bg-amber-50/60 px-6 py-5">
        <div className="flex items-start gap-4">
          <RotateCcw className="mt-1 h-4 w-4 shrink-0 text-amber-600" />

          <div className="min-w-0 flex-1">
            <p className="font-editorial text-[22px] leading-tight text-stone-900">
              {summary.total.toLocaleString()}{" "}
              {summary.total === 1 ? "photo" : "photos"} never finished
              uploading
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">
              These were registered but never reached the archive — the session
              ended first. Open the gallery and drop the folder again; anything
              already archived is caught as a duplicate.
            </p>

            <ul className="mt-4 space-y-1.5">
              {summary.events.map((ev) => (
                <li key={ev.eventId}>
                  <Link
                    href={`/events/${ev.eventId}`}
                    className="group flex items-baseline justify-between gap-4 border-b border-amber-200/70 pb-1.5 text-[13px] transition-colors hover:border-amber-400"
                  >
                    <span className="truncate text-stone-800 group-hover:text-stone-900">
                      {ev.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-amber-800">
                      {ev.count.toLocaleString()}
                      {summary.truncated ? "+" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 text-[12px] text-stone-400 underline underline-offset-2 transition-colors hover:text-stone-700"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
