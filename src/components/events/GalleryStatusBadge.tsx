"use client";

import { AlertTriangle } from "lucide-react";
import {
  DELIVERY_LABEL,
  type DeliveryStage,
  type EventStatus,
} from "@/lib/events/status";

/**
 * The two status signals on an archive card, kept visually distinct because
 * they answer different questions:
 *
 *   • the DELIVERY pill — where this gallery is in the ladder
 *   • the READINESS pie — whether the pipeline has caught up
 *
 * The pie deliberately mirrors the upload indicator: a ring that fills as work
 * completes and then disappears. Same motif, same meaning ("something is still
 * happening"), so it needs no legend the second time you see it.
 */

/** Muted by default; only the states that want your attention carry color. */
const STAGE_STYLE: Record<DeliveryStage, string> = {
  draft: "border-stone-200 text-stone-400",
  // The one that catches forgotten work: live, but nobody has it.
  published: "border-amber-300 text-amber-700",
  sent: "border-stone-300 text-stone-600",
  opened: "border-emerald-300 text-emerald-700",
  downloaded: "border-emerald-500 text-emerald-800",
};

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * What the readiness chip means, in words. Says what is happening, when it
 * runs, and — crucially for Queued — that nothing is wrong and nothing is
 * blocked by it.
 */
function readinessTooltip(r: {
  uploading: number;
  indexed: number;
  total: number;
}): string {
  const n = r.total.toLocaleString();
  if (r.uploading > 0) {
    return `${r.uploading.toLocaleString()} photo${r.uploading === 1 ? "" : "s"} still uploading. AI processing starts once every upload has landed.`;
  }
  if (r.indexed === 0) {
    // "Once uploads settle" is true and unhelpfully vague — settle means the
    // per-event debounce, now 2 minutes. Not saying so sends people back to
    // refresh a page that cannot have changed yet.
    return `Queued — ${n} photos waiting. AI processing starts automatically about 2 minutes after the last photo lands, and runs in the background; nothing is stuck. You can share this gallery now, and search, faces and smart sections switch on when it finishes.`;
  }
  return `${r.indexed.toLocaleString()} of ${n} photos processed. Search, faces and smart sections improve as this fills in.`;
}

/** A ring that fills clockwise — no text, legible at 12px. */
function ReadinessPie({ fraction }: { fraction: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center">
      <svg width="13" height="13" viewBox="0 0 14 14" className="shrink-0">
        <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" className="stroke-stone-200" />
        <circle
          cx="7"
          cy="7"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          className="stroke-emerald-500"
          strokeDasharray={`${c * Math.max(0.04, fraction)} ${c}`}
          transform="rotate(-90 7 7)"
        />
      </svg>
    </span>
  );
}

export function GalleryStatusBadge({ status }: { status: EventStatus | null }) {
  if (!status) return null;
  const { delivery, readiness } = status;

  const pct = readiness.total > 0 ? readiness.indexed / readiness.total : 0;
  // Readiness shows ONLY while there's something to wait for. A permanent
  // green tick on every finished gallery is decoration, not information.
  const showReadiness =
    readiness.uploading > 0 || (readiness.total > 0 && !readiness.ready);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${STAGE_STYLE[delivery.stage]}`}
      >
        {DELIVERY_LABEL[delivery.stage]}
      </span>

      {/* "Opened 3d ago" is the answer to the question photographers actually
          ask — did they look? — so the timestamp rides with the pill. */}
      {delivery.lastViewedAt &&
        (delivery.stage === "opened" || delivery.stage === "downloaded") && (
          <span className="text-[11px] text-stone-400">
            {relativeDay(delivery.lastViewedAt)}
          </span>
        )}

      {delivery.expired && (
        <span
          className="inline-flex items-center gap-1 border border-red-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-red-600"
          title="This share is past its expiry date but still marked active — guests get an error."
        >
          <AlertTriangle className="h-3 w-3" />
          Expired
        </span>
      )}

      {showReadiness && (
        /* "Processing 0%" that never moves is indistinguishable from broken
           (Mason, 2026-08-10: "stuck at 0% gives me anxiety"). Work that hasn't
           STARTED is Queued; only work in flight shows a percentage. The
           tooltip then says what Queued actually means, because a status word
           nobody can interpret just relocates the anxiety. */
        <span
          className="inline-flex cursor-help items-center gap-1.5 text-[11px] text-stone-400"
          title={readinessTooltip(readiness)}
        >
          <ReadinessPie fraction={pct} />
          {readiness.uploading > 0
            ? "Uploading"
            : readiness.indexed === 0
              ? "Queued"
              : `Processing ${Math.round(pct * 100)}%`}
        </span>
      )}
    </div>
  );
}
