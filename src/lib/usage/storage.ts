/**
 * Per-user storage rollup — the STOCK side of cost tracking.
 *
 * Computed live from images/zip_jobs via the get_user_storage() SQL function
 * (migration 040) so deletions are honest: a usage ledger would keep counting
 * bytes that no longer exist. This is the ONE home for "how much R2 does this
 * user occupy" — the ops dashboard and the weekly pricing summary both import
 * it (both-sides-of-a-delta rule: one function defines membership).
 */

import type { createServiceClient } from "@/lib/supabase/server";
import { ESTIMATED_THUMB_RATIO } from "./costs";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface UserStorage {
  /** Original binaries (images.file_size). */
  originalBytes: number;
  /** Measured thumbnail bytes plus the estimate for unmeasured rows. */
  thumbBytes: number;
  /** Of thumbBytes, how much is estimate rather than measurement. */
  estimatedThumbBytes: number;
  /** Live (non-expired) ZIP artifacts parked in R2. */
  zipBytes: number;
  totalBytes: number;
}

export async function getUserStorage(
  supabase: SupabaseDB,
  userId: string
): Promise<UserStorage> {
  const { data, error } = await supabase.rpc("get_user_storage", {
    p_user_id: userId,
  });
  if (error) throw error;

  const row = data?.[0];
  const originalBytes = Number(row?.original_bytes ?? 0);
  const measuredThumbBytes = Number(row?.thumb_bytes ?? 0);
  const estimatedThumbBytes = Math.round(
    Number(row?.unmeasured_original_bytes ?? 0) * ESTIMATED_THUMB_RATIO
  );
  const zipBytes = Number(row?.zip_bytes ?? 0);
  const thumbBytes = measuredThumbBytes + estimatedThumbBytes;

  return {
    originalBytes,
    thumbBytes,
    estimatedThumbBytes,
    zipBytes,
    totalBytes: originalBytes + thumbBytes + zipBytes,
  };
}
