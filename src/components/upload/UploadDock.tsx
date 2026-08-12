"use client";

/**
 * UploadDock — the floating "still uploading" pill.
 *
 * Uploads now outlive the page that started them, which is only useful if you
 * can still see them. The dock lives in the layout, aggregates every running
 * batch, and links back to the gallery doing the work.
 *
 * It hides when every active batch belongs to the event you're already looking
 * at — that page shows the full list inline, and two progress readouts on one
 * screen is noise.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronUp, X } from "lucide-react";
import { useUploadManager } from "./UploadManager";

export function UploadDock() {
  const { batches, speedMbps, cancelBatch } = useUploadManager();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  // Sidebar "N failed" badges open the dock to the file list — the failed
  // rows (and their retry) already live here.
  useEffect(() => {
    const open = () => setExpanded(true);
    window.addEventListener("pt:open-upload-dock", open);
    return () => window.removeEventListener("pt:open-upload-dock", open);
  }, []);

  const active = useMemo(
    () =>
      batches
        .map((b) => {
          const inFlight = b.files.filter(
            (f) => f.status === "pending" || f.status === "uploading"
          );
          return {
            id: b.id,
            eventId: b.eventId,
            eventName: b.eventName,
            sectionName: b.sectionName,
            remaining: inFlight.length,
            // "Done" counts every file that reached a terminal, successful
            // state — uploaded, or already present and linked/skipped. All of
            // them are accounted for; none is still owed to the photographer.
            done: b.files.filter(
              (f) =>
                f.status === "complete" ||
                f.status === "duplicate" ||
                f.status === "linked"
            ).length,
            // The DENOMINATOR IS WHAT YOU DROPPED, and it never moves.
            // It used to exclude duplicates, so the total shrank as the server
            // discovered them chunk by chunk — Justin watched 1,106 become
            // 1,090 mid-upload and reasonably read it as broken arithmetic
            // (2026-08-11). A total that changes while you watch destroys the
            // one thing a progress bar is for: knowing that what you handed
            // over is all accounted for.
            total: b.files.length,
            settled: b.files.filter(
              (f) => f.status === "duplicate" || f.status === "linked"
            ).length,
            // Fractional bytes of in-flight files, so the bar creeps.
            fractional: inFlight.reduce(
              (a, f) => a + (f.status === "uploading" ? f.progress / 100 : 0),
              0
            ),
          };
        })
        .filter((b) => b.remaining > 0),
    [batches]
  );

  const onThisEventPage = (eventId: string) =>
    pathname === `/events/${eventId}`;

  if (active.length === 0) return null;
  // The event page already shows all of this inline.
  if (active.every((b) => onThisEventPage(b.eventId))) return null;

  // Count distinct GALLERIES, not batches — two folders dropped into different
  // sections of one event are two batches but one gallery, and "2 galleries"
  // would be a lie about where the work is.
  const galleryCount = new Set(active.map((b) => b.eventId)).size;
  const total = active.reduce((a, b) => a + b.total, 0);
  const done = active.reduce((a, b) => a + b.done, 0);
  const fractional = active.reduce((a, b) => a + b.fractional, 0);
  const pct = total > 0 ? Math.min(100, ((done + fractional) / total) * 100) : 0;
  const speed =
    speedMbps && speedMbps >= 0.05 ? `${speedMbps.toFixed(1)} Mbps` : null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[min(380px,calc(100vw-3rem))]">
      {expanded && (
        <div className="mb-2 overflow-hidden border border-stone-200 bg-white shadow-lg">
          <ul className="divide-y divide-stone-100">
            {active.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/events/${b.eventId}`}
                    className="block truncate text-[13px] text-stone-800 hover:text-stone-950"
                  >
                    {/* Name the GALLERY when more than one is running — a bare
                        section name can't tell you where the work is. */}
                    {galleryCount > 1 && b.eventName ? (
                      <>
                        <span className="text-stone-500">{b.eventName}</span>
                        <span className="text-stone-300"> · </span>
                      </>
                    ) : null}
                    {b.sectionName || "Unsorted"}
                  </Link>
                  <p className="mt-0.5 text-[11px] tabular-nums text-stone-500">
                    {b.done.toLocaleString()} of {b.total.toLocaleString()} ·{" "}
                    {b.remaining.toLocaleString()} to go
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelBatch(b.id)}
                  aria-label="Cancel this upload"
                  className="shrink-0 p-1 text-stone-300 transition-colors hover:text-stone-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border border-stone-200 bg-white shadow-lg">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>

          <Link
            href={`/events/${active[0].eventId}`}
            className="min-w-0 flex-1 group"
          >
            <p className="truncate text-[13px] text-stone-900 group-hover:text-stone-950">
              Uploading{" "}
              <span className="tabular-nums">
                {done.toLocaleString()} of {total.toLocaleString()}
              </span>
              {galleryCount > 1 ? (
                <span className="text-stone-400"> · {galleryCount} galleries</span>
              ) : active.length > 1 ? (
                <span className="text-stone-400"> · {active.length} sections</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              {speed ? `${speed} · ` : ""}tap to view
            </p>
          </Link>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse upload list" : "Expand upload list"}
            className="shrink-0 p-1 text-stone-400 transition-colors hover:text-stone-700"
          >
            <ChevronUp
              className={`h-4 w-4 transition-transform duration-300 ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>

        <div className="h-0.5 w-full bg-stone-100">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
