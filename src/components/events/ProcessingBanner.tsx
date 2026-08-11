"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

interface Status {
  total: number;
  indexed: number;
  uploading: number;
  startedAt: string | null;
  perMinute: number | null;
  etaMinutes: number | null;
  complete: boolean;
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
        // Stop polling the moment there's nothing left to watch.
        if (!data.complete) timer = setTimeout(poll, 20_000);
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

  if (!status || status.complete || status.total === 0) return null;

  const pct = status.total > 0 ? status.indexed / status.total : 0;
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
          {status.uploading > 0 ? (
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
              <span className="text-stone-400">
                — starts automatically, usually within a few minutes
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
