import type { createServiceClient } from "@/lib/supabase/server";
import {
  SUPABASE_COMPUTE_TIERS,
  SUPABASE_DISK_GB_MONTH,
  SUPABASE_INCLUDED_COMPUTE_CREDIT,
  VECTOR_INDEX_RAM_BUDGET,
} from "./costs";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * What the database costs, and how much room is left before it costs more.
 *
 * /ops metered Modal and R2 from the start but never the database, which is
 * precisely why its trajectory went unnoticed until it was worked out by hand
 * on 2026-08-12 — at which point it was heading for $410/month within four
 * years of ordinary shooting. A cost with no gauge is a cost nobody is
 * watching.
 *
 * The headline number is the VECTOR INDEX, not the database size. Search walks
 * that index in memory, memory is sold as instance tiers, and everything else
 * pages off disk for a fraction of a cent per GB.
 */

export interface DatabaseFootprint {
  dbBytes: number;
  vectorIndexBytes: number;
  otherIndexBytes: number;
  tableBytes: number;
  photosIndexed: number;
  facesIndexed: number;
  photosLast30d: number;
  photosLast90d: number;

  /** Vector-index bytes per indexed photo — measured, not assumed. */
  indexBytesPerPhoto: number;
  /** Smallest tier whose RAM comfortably holds the vector index today. */
  tier: { name: string; ramGb: number; monthly: number };
  /** The next tier up, or null when already at the largest modelled. */
  nextTier: { name: string; ramGb: number; monthly: number } | null;
  /**
   * How many MORE photos fit before the vector index outgrows this tier.
   *
   * Deliberately expressed in photos rather than months. A countdown needs a
   * growth RATE, and the measured rate is unreliable — a single migration or
   * backfill (the SPS pull, an Island re-upload) dwarfs a month of real
   * shooting and would make the forecast lie. Headroom needs only bytes per
   * photo, which is measured directly. Null when already past the budget.
   */
  photoHeadroom: number | null;
  /** Monthly disk cost of the database at its current size. */
  diskMonthly: number;
  /**
   * Tier price MINUS the compute credit already included in the Pro plan, which
   * the overhead line bills separately. Counting the full tier on top of that
   * line would charge the first $10 twice.
   */
  computeMonthlyNet: number;
}

function tierFor(vectorIndexBytes: number) {
  const neededGb = vectorIndexBytes / 1e9 / VECTOR_INDEX_RAM_BUDGET;
  const idx = SUPABASE_COMPUTE_TIERS.findIndex((t) => t.ramGb >= neededGb);
  const i = idx === -1 ? SUPABASE_COMPUTE_TIERS.length - 1 : idx;
  return {
    tier: SUPABASE_COMPUTE_TIERS[i],
    nextTier: SUPABASE_COMPUTE_TIERS[i + 1] ?? null,
  };
}

export async function getDatabaseFootprint(
  supabase: SupabaseClient
): Promise<DatabaseFootprint | null> {
  const { data, error } = await supabase.rpc("database_footprint");
  // A Supabase error is a return value, not a throw. Returning null here lets
  // the page render the rest of /ops without this panel, rather than taking the
  // whole dashboard down for a gauge — the same rule the events list learned.
  if (error || !data || (data as unknown[]).length === 0) return null;

  const r = (data as Array<Record<string, number | string>>)[0];
  const n = (k: string) => Number(r[k] ?? 0);

  const vectorIndexBytes = n("vector_index_bytes");
  const photosIndexed = n("photos_indexed");
  const indexBytesPerPhoto = photosIndexed > 0 ? vectorIndexBytes / photosIndexed : 0;
  const { tier, nextTier } = tierFor(vectorIndexBytes);

  const budgetBytes = tier.ramGb * 1e9 * VECTOR_INDEX_RAM_BUDGET;
  const photoHeadroom =
    indexBytesPerPhoto > 0
      ? Math.max(0, Math.floor((budgetBytes - vectorIndexBytes) / indexBytesPerPhoto))
      : null;

  const dbBytes = n("db_bytes");

  return {
    dbBytes,
    vectorIndexBytes,
    otherIndexBytes: n("other_index_bytes"),
    tableBytes: n("table_bytes"),
    photosIndexed,
    facesIndexed: n("faces_indexed"),
    photosLast30d: n("photos_last_30d"),
    photosLast90d: n("photos_last_90d"),
    indexBytesPerPhoto,
    tier,
    nextTier,
    photoHeadroom,
    diskMonthly: (dbBytes / 1e9) * SUPABASE_DISK_GB_MONTH,
    computeMonthlyNet: Math.max(0, tier.monthly - SUPABASE_INCLUDED_COMPUTE_CREDIT),
  };
}
