"use client";

import { notFound } from "next/navigation";
import {
  SpsMissingPanel,
  type SpsMissingPhoto,
} from "@/components/events/SpsMissingPanel";

/**
 * /dev/sps-missing — visual fixture for what an SPS import left behind.
 *
 * From fixed data, because the states are rare by design: a finished import
 * with photos missing existed exactly twice in production when this was built
 * (2026-10-04), and "SPS no longer lists it" had
 * never happened at all.
 *
 * Dev-gated like every /dev page: NODE_ENV, never VERCEL_ENV (which fails
 * open off-Vercel).
 */
// Invented names in the real filename shape. Guests' names do not belong in
// a fixture.
const FIVE: SpsMissingPhoto[] = [
  "avery stone_26-09-30_Summit_0141.jpg",
  "mORGAN reyes_26-09-30_Summit_1021.jpg",
  "mORGAN reyes_26-09-30_Summit_1024.jpg",
  "Jordan Pike_26-10-01_Summit_1304.jpg",
  "sam okafor_26-10-01_Summit_2123.jpg",
].map((filename, i) => ({
  spsImageId: `five-${i}`,
  filename,
  reason: "Failed during the import",
}));

const MANY: SpsMissingPhoto[] = Array.from({ length: 31 }, (_, i) => ({
  spsImageId: `many-${i}`,
  filename: `Guest Name_26-10-01_Event_${String(1000 + i)}.jpg`,
  reason: "canceling statement due to statement timeout (code 57014)",
}));

const FIXTURES: {
  label: string;
  missing: SpsMissingPhoto[] | null;
  status: string;
  retrying?: boolean;
}[] = [
  { label: "Five missing", missing: FIVE, status: "completed" },
  { label: "One missing", missing: FIVE.slice(0, 1), status: "completed" },
  { label: "Retry just pressed", missing: FIVE, status: "completed", retrying: true },
  { label: "Retry running", missing: FIVE, status: "running" },
  { label: "Retry stopped part-way (no button: it resumes from the list)", missing: FIVE, status: "cancelled" },
  {
    label: "The retry could not run",
    missing: FIVE.slice(0, 2).map((m) => ({
      ...m,
      reason: "The retry could not run: Could not reach SPS: The operation was aborted due to timeout",
    })),
    status: "completed",
  },
  {
    label: "One gone from SPS, one still fetchable",
    missing: [
      FIVE[0],
      { ...FIVE[1], reason: "No longer on SimplePhotoShare", gone: true },
    ],
    status: "completed",
  },
  {
    label: "Only gone ones left (no button)",
    missing: [{ ...FIVE[1], reason: "No longer on SimplePhotoShare", gone: true }],
    status: "completed",
  },
  { label: "Thirty-one missing, long reasons", missing: MANY, status: "completed" },
  { label: "Checked, nothing missing", missing: [], status: "completed" },
  { label: "Never checked (renders nothing)", missing: null, status: "completed" },
];

export default function SpsMissingFixture() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="font-editorial text-3xl text-stone-900">SPS import: what did not come over</h1>
      <p className="mt-2 text-sm text-stone-500">
        The panel on /events/import, from fixed data.
      </p>
      <div className="mt-10 space-y-10">
        {FIXTURES.map((f) => (
          <section key={f.label}>
            <p className="label-caps mb-3 text-stone-300">{f.label}</p>
            <SpsMissingPanel
              missing={f.missing}
              status={f.status}
              retrying={!!f.retrying}
              onRetry={() => {}}
            />
          </section>
        ))}
      </div>
    </main>
  );
}
