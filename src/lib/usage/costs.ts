/**
 * Unit costs — THE single home for every price used in cost math.
 *
 * SPSv2's ops app duplicated its cost constants across two files and they
 * drifted; per the one-exported-home rule, nothing else in this codebase may
 * define a $/unit number. The ops dashboard, the weekly pricing summary, and
 * the anomaly cron all import from here.
 *
 * Sources (checked 2026-08-10):
 *  - Modal (modal.com/pricing): T4 GPU $0.000164/s; CPU $0.0000131/core/s;
 *    memory $0.00000222/GiB/s. Starter plan includes $30/mo free credits —
 *    treat that as an overhead offset on the dashboard, not a per-user
 *    discount.
 *  - Cloudflare R2: $0.015/GB-month storage. Egress is FREE (R2's whole
 *    pitch), so downloads cost storage + ops only, which is why there is no
 *    egress meter.
 *  - Resend: $20/mo covers 50k emails (~$0.0004 each); priced conservatively.
 */

import type { UsageKind } from "./record";

/** $/GB-month for R2 storage — the stock cost, applied to getUserStorage(). */
export const R2_STORAGE_GB_MONTH = 0.015;

/**
 * $ per `unit` for each flow kind. Modal lanes are priced per wall-clock
 * second as measured around our fetch — that includes network + cold start,
 * which is roughly what Modal bills (container time), so it errs honest-high.
 */
export const KIND_UNIT_COST: Record<UsageKind, number> = {
  // T4 container (index_images + embed_selfie live on the same T4 class).
  ai_index: 0.000164,
  ai_embed_selfie: 0.000164,
  // CPU fn, 6 GiB (text tower): ~1 core + memory.
  ai_embed_text: 0.0000131 + 6 * 0.00000222,
  // CPU fn, 2 GiB (ffmpeg).
  video_process: 0.0000131 + 2 * 0.00000222,
  // Vercel/Inngest compute overhead — tracked as activity, costed in the
  // fixed-overhead line on the dashboard rather than per unit.
  zip_build: 0,
  cover_raster: 0,
  email_send: 0.001,
};

/**
 * Thumbnails generated before metering (thumb_bytes NULL) are estimated as a
 * fraction of the original: 200/400/800px mozjpeg variants of a typical
 * multi-MB original sum to roughly 2–4% of it. Recalibrate from measured rows
 * once enough accumulate (query: sum(thumb_bytes)::float / sum(file_size)
 * where thumb_bytes is not null).
 */
export const ESTIMATED_THUMB_RATIO = 0.03;

/**
 * Fixed monthly platform overhead — costs that exist regardless of usage,
 * shown as their own line on /ops so the total is honest. These are
 * CONFIGURED ESTIMATES, not billed amounts — correct them as real invoices
 * arrive. The Modal $30/mo free credit is modeled as a negative line: while
 * measured Modal usage stays under it, AI compute is effectively free.
 */
export const PLATFORM_OVERHEAD_MONTHLY: { label: string; monthly: number }[] = [
  { label: "Vercel Pro", monthly: 20 },
  { label: "Supabase Pro", monthly: 25 },
  { label: "Modal free credit offset", monthly: -30 },
];

/** Cost in dollars for one usage_events row's quantity. */
export function costOf(kind: UsageKind, quantity: number): number {
  return KIND_UNIT_COST[kind] * quantity;
}

/** Monthly cost in dollars of holding `bytes` in R2. */
export function storageCostPerMonth(bytes: number): number {
  return (bytes / 1e9) * R2_STORAGE_GB_MONTH;
}
