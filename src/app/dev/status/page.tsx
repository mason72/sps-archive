import { notFound } from "next/navigation";
import { GalleryStatusBadge } from "@/components/events/GalleryStatusBadge";
import { isAiReady, type EventStatus } from "@/lib/events/status";

export const dynamic = "force-dynamic";

/**
 * /dev/status — visual fixture for the archive card's status badge.
 *
 * Every readiness state side by side, from fixed numbers rather than live
 * data, because some states are rare by design: a gallery with photos AI
 * indexing gave up on (migration 082) did not exist in production when its
 * badge wording was written, so there was nothing real to look at.
 *
 * Dev-gated like every /dev page: NODE_ENV, never VERCEL_ENV (which fails
 * open off-Vercel).
 */
const FIXTURES: { label: string; total: number; indexed: number; uploading?: number; gaveUp?: number }[] = [
  { label: "Uploading", total: 400, indexed: 0, uploading: 38 },
  { label: "Queued", total: 1142, indexed: 0 },
  { label: "Processing", total: 1142, indexed: 612 },
  { label: "Processing, 2 given up so far", total: 1142, indexed: 612, gaveUp: 2 },
  { label: "First batch failed outright", total: 500, indexed: 0, gaveUp: 100 },
  { label: "Finished, 3 given up", total: 5787, indexed: 5784, gaveUp: 3 },
  { label: "Finished, 1 given up", total: 212, indexed: 211, gaveUp: 1 },
  { label: "Finished cleanly (nothing to show)", total: 500, indexed: 500 },
];

export default function StatusFixture() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-editorial text-3xl text-stone-900">Status badge</h1>
      <p className="mt-2 text-sm text-stone-500">
        Readiness states from fixed numbers. Hover a label for its tooltip.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {FIXTURES.map((f) => {
          const readiness = {
            total: f.total,
            indexed: f.indexed,
            uploading: f.uploading ?? 0,
            gaveUp: f.gaveUp ?? 0,
            rows: f.total,
            ready: false,
          };
          readiness.ready = isAiReady(readiness);
          const status: EventStatus = {
            delivery: { stage: "opened", expired: false, lastViewedAt: new Date().toISOString(), viewCount: 4 },
            readiness,
          };
          return (
            <div key={f.label} className="border border-stone-200 bg-white p-4">
              <p className="text-[11px] uppercase tracking-[0.1em] text-stone-400">{f.label}</p>
              <p className="mt-1 font-editorial text-lg text-stone-900">Gallery name</p>
              <GalleryStatusBadge status={status} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
