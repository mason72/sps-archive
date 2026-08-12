"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useEventUploadProgress } from "@/components/upload/UploadManager";

export interface Status {
  total: number;
  indexed: number;
  uploading: number;
  /** Pending for over 30 minutes — ghosts, not uploads in flight. */
  stalled: number;
  startedAt: string | null;
  perMinute: number | null;
  etaMinutes: number | null;
  /** Forecast from known throughput, used only before a measured rate exists. */
  forecastMinutes: number | null;
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
export function ProcessingBanner({
  eventId,
  onStatus,
}: {
  eventId: string;
  /**
   * Report each poll upward, so AI-dependent controls elsewhere on the page can
   * say whether they're usable yet WITHOUT starting a second poller against the
   * same endpoint. One fetch, one source of truth about readiness.
   */
  onStatus?: (status: Status | null) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [clearing, setClearing] = useState(false);

  /**
   * The live upload session in THIS tab, when there is one.
   *
   * The server's `uploading` count is pending image rows, which during a browser
   * upload is the PRESIGN-AHEAD WINDOW — rows minted for the next chunk, not the
   * work remaining. It hovers around fifty and ticks DOWN as each chunk drains,
   * so Justin watched "85 photos still uploading" count toward zero with 728
   * files still to go (2026-08-11). Only the client knows how many files were
   * dropped, so when a local session exists it is the authority; the server
   * number is the fallback for a reload or another device, where we honestly
   * cannot state a total.
   */
  const localUpload = useEventUploadProgress(eventId);

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
        onStatus?.(data);
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
    // onStatus is a stable callback from the page; re-subscribing on identity
    // change would restart the poll loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Stay up while there are ghosts to clear, even if indexing has finished —
  // otherwise the one control that resolves them disappears. An import in
  // flight also keeps it up even at total === 0, which is the first minute of a
  // pull into a brand-new event: the moment there is most to explain.
  if (!status) return null;
  // A local upload keeps this up even before any row is complete — the first
  // minute of a big drop is when there is most to explain.
  if (status.total === 0 && !status.importing && !localUpload.active) return null;
  if (status.complete && status.stalled === 0 && !localUpload.active) return null;

  const imp = status.importing;
  // While importing, the bar tracks the IMPORT, not indexing — that is the work
  // actually happening, and it has a real denominator.
  // The bar tracks whatever work is actually happening, in priority order:
  // a live upload, then an import, then indexing. Each has a real denominator.
  const pct = localUpload.active
    ? localUpload.total > 0
      ? Math.min(
          1,
          (localUpload.uploaded + localUpload.settled + localUpload.failed) /
            localUpload.total
        )
      : 0
    : imp
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
          {localUpload.active ? (
            <>
              <span className="font-medium">
                Uploading {localUpload.uploaded.toLocaleString()} of{" "}
                {localUpload.total.toLocaleString()}
              </span>
              <span className="text-stone-400">
                {localUpload.settled > 0 &&
                  ` · ${localUpload.settled.toLocaleString()} already here`}
                {localUpload.failed > 0 &&
                  ` · ${localUpload.failed.toLocaleString()} failed`}
                {" — AI processing starts once they land"}
              </span>
            </>
          ) : imp ? (
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
              {/* No local session — a reload, or another device. We know rows are
                  outstanding but NOT how many files were chosen, so this claims
                  no total rather than presenting the pending window as one. */}
              <span className="font-medium">
                {status.uploading.toLocaleString()} photo
                {status.uploading === 1 ? "" : "s"} still finishing
              </span>
              <span className="text-stone-400">
                — AI processing starts once they land
              </span>
            </>
          ) : status.indexed === 0 ? (
            <>
              <span className="font-medium">Queued for AI processing</span>
              {/* Say when it starts AND roughly how long it runs. "Queued" with
                  no scale is what sent Justin looking for another way to do the
                  job while 1,142 photos sat 31 minutes from ready. The forecast
                  is labelled as one ("about"), and a measured figure replaces it
                  as soon as the first batch lands. */}
              <span className="text-stone-400">
                — starts about 2 minutes after the last photo lands
                {status.forecastMinutes !== null &&
                  `, then about ${status.forecastMinutes} minute${status.forecastMinutes === 1 ? "" : "s"} for ${status.total.toLocaleString()} photos`}
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
