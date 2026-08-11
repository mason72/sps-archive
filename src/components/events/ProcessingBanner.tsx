"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

interface Status {
  total: number;
  indexed: number;
  uploading: number;
  /** Pending for over 30 minutes — ghosts, not uploads in flight. */
  stalled: number;
  startedAt: string | null;
  perMinute: number | null;
  etaMinutes: number | null;
  complete: boolean;
  /**
   * An SPS import currently pulling photos into this event.
   *
   * Takes precedence over `uploading` in the copy below, because during an
   * import `uploading` is the importer's concurrency window (about six) rather
   * than the work left — a number that reads as nearly-finished with hundreds
   * still to come.
   */
  importing: {
    jobId: string;
    landed: number;
    expectedTotal: number | null;
    failed: number;
  } | null;
}

/**
 * Live AI-processing status, at the top of the event page.
 *
 * A status word alone ("Queued") relocates anxiety rather than removing it —
 * you still can't tell whether anything is happening, how long it will take,
 * or whether you're blocked (Mason, 2026-08-10, on a 5,787-photo event sitting
 * at "Queued"). So this says all three, out loud, in the empty space at the
 * top of the page:
 *
 *   • what has actually been done, as a count and a bar that moves
 *   • how long is left, from MEASURED throughput on this event
 *   • what is and isn't available meanwhile — the part that decides whether
 *     you can get on with your day or have to wait
 *
 * It polls only while there's work in flight, then disappears for good.
 */
export function ProcessingBanner({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/processing`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (cancelled) return;
        setStatus(data);
        // Stop polling the moment there's nothing left to watch. An import in
        // flight gets a much tighter cadence than AI indexing: photos land every
        // couple of seconds, and a 20s refresh on a number that visibly should
        // be moving is what makes a working import look stuck.
        if (!data.complete) {
          timer = setTimeout(poll, data.importing ? 3_000 : 20_000);
        }
      } catch {
        /* transient — the next mount tries again */
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [eventId]);

  // Stay up while there are ghosts to clear, even if indexing has finished —
  // otherwise the one control that resolves them disappears. An import in
  // flight also keeps it up even at total === 0, which is the first minute of a
  // pull into a brand-new event: the moment there is most to explain.
  if (!status) return null;
  if (status.total === 0 && !status.importing) return null;
  if (status.complete && status.stalled === 0) return null;

  const imp = status.importing;
  // While importing, the bar tracks the IMPORT, not indexing — that is the work
  // actually happening, and it has a real denominator.
  const pct = imp
    ? imp.expectedTotal
      ? Math.min(1, imp.landed / imp.expectedTotal)
      : 0
    : status.total > 0
      ? status.indexed / status.total
      : 0;
  const eta = status.etaMinutes;
  const etaLabel =
    eta === null
      ? "working out how long this will take…"
      : eta < 1
        ? "less than a minute left"
        : eta < 60
          ? `about ${eta} minute${eta === 1 ? "" : "s"} left`
          : `about ${Math.floor(eta / 60)}h ${eta % 60}m left`;

  return (
    <div className="mb-10 border border-stone-200 bg-stone-50/60 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="flex items-center gap-2 text-[13px] text-stone-700">
          <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
          {imp ? (
            <>
              <span className="font-medium">
                Importing from SimplePhotoShare —{" "}
                {imp.landed.toLocaleString()}
                {imp.expectedTotal
                  ? ` of ${imp.expectedTotal.toLocaleString()}`
                  : ""}{" "}
                copied
              </span>
              <span className="text-stone-400">
                — AI processing starts once the last one lands
              </span>
            </>
          ) : status.uploading > 0 ? (
            <>
              <span className="font-medium">
                {status.uploading.toLocaleString()} photo
                {status.uploading === 1 ? "" : "s"} still uploading
              </span>
              <span className="text-stone-400">
                — AI processing starts once they land
              </span>
            </>
          ) : status.indexed === 0 ? (
            <>
              <span className="font-medium">Queued for AI processing</span>
              {/* The real number, because "a few minutes" sent Mason back to
                  refresh a page that was never going to change yet: the lane is
                  debounced 15 minutes per event on purpose, so an upload session
                  triggers one sweep after it settles instead of one per photo. */}
              <span className="text-stone-400">
                — starts automatically, up to 15 minutes after the last photo lands
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">
                Processing {status.indexed.toLocaleString()} of{" "}
                {status.total.toLocaleString()}
              </span>
              <span className="text-stone-400">— {etaLabel}</span>
            </>
          )}
        </p>
        <span className="text-[12px] tabular-nums text-stone-400">
          {Math.round(pct * 100)}%
        </span>
      </div>

      <div className="mt-3 h-[3px] w-full overflow-hidden bg-stone-200">
        <div
          className="h-full bg-emerald-500 transition-[width] duration-1000 ease-out"
          style={{ width: `${Math.max(pct * 100, 1.5)}%` }}
        />
      </div>

      {/* Stalled rows get their own line AND a way out. They are not
          "uploading" — their bytes never arrived and never will — so telling
          the photographer to wait is a lie, and leaving them there keeps the
          event's photo count wrong and its grid full of blank tiles. */}
      {status.stalled > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-amber-800">
          <span>
            {status.stalled.toLocaleString()} photo
            {status.stalled === 1 ? "" : "s"} never finished uploading — their
            files never reached us.
          </span>
          <button
            type="button"
            disabled={clearing}
            onClick={async () => {
              setClearing(true);
              try {
                const res = await fetch(
                  `/api/events/${eventId}/unfinished-uploads`,
                  { method: "DELETE" }
                );
                const r = (await res.json()) as {
                  deleted?: number;
                  recoverable?: number;
                };
                if (res.ok) {
                  toast.success(
                    `Cleared ${(r.deleted ?? 0).toLocaleString()} unfinished upload${r.deleted === 1 ? "" : "s"}`,
                    {
                      description: r.recoverable
                        ? `${r.recoverable} had already arrived and will be repaired automatically.`
                        : "Re-drop those files if you still want them.",
                    }
                  );
                  setStatus((s) => (s ? { ...s, stalled: 0 } : s));
                } else {
                  toast.error("Couldn't clear those rows");
                }
              } catch {
                toast.error("Couldn't clear those rows");
              } finally {
                setClearing(false);
              }
            }}
            className="underline underline-offset-2 hover:text-amber-950 disabled:opacity-50"
          >
            {clearing ? "Clearing…" : "Clear them"}
          </button>
        </p>
      )}

      {/* The line that actually answers "am I blocked?". */}
      <p className="mt-3 text-[12px] leading-relaxed text-stone-500">
        <span className="text-stone-600">Available now:</span> everything you
        see here — sections, stacks, covers, sharing and downloads.{" "}
        <span className="text-stone-600">Switches on when this finishes:</span>{" "}
        search by description, the People tab, guest selfie search and smart
        sections. Nothing is blocked — you can publish and send this gallery
        today.
      </p>
    </div>
  );
}
