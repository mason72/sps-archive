/**
 * The archive's stats row (photos · events · gallery views · favorites), cached
 * per account in `dashboard_stats_cache` (migration 103).
 *
 * Measured 2026-11-24: computing it live is 31 PostgREST requests for the
 * 1,473-gallery account (15 photo-count chunks, 16 favorite-count chunks),
 * ~2.5 s on a quiet database, and the first thing to fail when the database is
 * busy (one chunk answered a bare HTTP 500). The numbers move slowly, so:
 *
 * - fresh row (under STATS_FRESH_MS): served as is;
 * - stale row: served as is, and recomputed after the response;
 * - no usable row (first visit, or invalidateDashboardStats after a gallery was
 *   created, duplicated or deleted): computed now, stored, and served.
 *
 * Photos landing by upload or import do not invalidate: the stats catch up
 * within STATS_FRESH_MS plus one stale load. An account with no photos stores
 * the empty marker, so it is counted live (cheaply) every time (see
 * computeAndStore).
 *
 * The cache is an OPTIMIZATION. A failed read or write is reported and the
 * request falls back to a live count; it must never fail the row it speeds up.
 * Stored writes are ordered by when the computation STARTED (see
 * store_dashboard_stats), so overlapping recomputes cannot go backwards.
 */
import { after } from "next/server";

import type { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { countAcross, readAllRows } from "@/lib/supabase/paged";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface DashboardStats {
  totalEvents: number;
  totalImages: number;
  totalViews: number;
  totalFavorites: number;
}

/** A row older than this is served once more and recomputed after the response. */
export const STATS_FRESH_MS = 5 * 60 * 1000;

export type CacheState = "fresh" | "stale" | "miss";

/** What a stored row is worth right now. Pure, so the rule is tested by itself. */
export function cacheState(computedAt: string | null, now: number, force: boolean): CacheState {
  if (force || !computedAt) return "miss";
  const at = Date.parse(computedAt);
  // An unreadable timestamp is a row we cannot vouch for, not a fresh one.
  if (!Number.isFinite(at)) return "miss";
  return now - at < STATS_FRESH_MS ? "fresh" : "stale";
}

/** Reads a stored row's stats, or null when any of the four numbers is missing. */
export function parseStoredStats(raw: unknown): DashboardStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const keys = ["totalEvents", "totalImages", "totalViews", "totalFavorites"] as const;
  if (!keys.every((k) => Number.isInteger(r[k]) && (r[k] as number) >= 0)) return null;
  return {
    totalEvents: r.totalEvents as number,
    totalImages: r.totalImages as number,
    totalViews: r.totalViews as number,
    totalFavorites: r.totalFavorites as number,
  };
}

/** The live count: every photo, share view and favorite across the account. */
export async function computeDashboardStats(
  supabase: SupabaseDB,
  userId: string
): Promise<DashboardStats> {
  // Paged, or the count tops out at 1,000.
  const userEvents = await readAllRows(() =>
    supabase.from("events").select("id").eq("user_id", userId)
  );
  const eventIds = userEvents.map((e) => e.id);
  const totalEvents = eventIds.length;
  if (totalEvents === 0) {
    return { totalEvents: 0, totalImages: 0, totalViews: 0, totalFavorites: 0 };
  }

  const [totalImages, shares] = await Promise.all([
    countAcross(eventIds, "images", (chunk) =>
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .in("event_id", chunk)
        // Photos, not cover uploads (client logos; lesson 184).
        .eq("is_cover_upload", false)
    ),
    // Shares carry no user_id — ownership is transitive through the event, so
    // it has to be an inner join. Filtering on a column that doesn't exist
    // reads as an empty result set, which is how this silently served 0 views
    // for months. Paged: the busiest account has 1,516 shares, and a bare
    // select stops at 1,000 with no error.
    readAllRows(() =>
      supabase
        .from("shares")
        .select("id, view_count, events!inner(user_id)")
        .eq("events.user_id", userId)
    ),
  ]);

  const totalViews = shares.reduce((sum, s) => sum + (s.view_count || 0), 0);
  const totalFavorites =
    shares.length > 0
      ? await countAcross(
          shares.map((s) => s.id),
          "favorites",
          (chunk) =>
            supabase
              .from("favorites")
              .select("id", { count: "exact", head: true })
              .in("share_id", chunk)
        )
      : 0;

  return { totalEvents, totalImages, totalViews, totalFavorites };
}

/**
 * Computes, then stores under the time the computation started, read from the
 * DATABASE's clock before anything else is read (migration 103 says why a
 * server's clock is not good enough). Without a stamp it still answers, and
 * stores nothing.
 */
async function computeAndStore(supabase: SupabaseDB, userId: string): Promise<DashboardStatsRead> {
  const clock = await supabase.rpc("dashboard_stats_clock");
  if (clock.error) await reportSystemError("dashboard.stats-cache.clock", clock.error, { userId });
  const startedAt = clock.error ? null : clock.data;

  const stats = await computeDashboardStats(supabase, userId);
  const computedAt = new Date(startedAt ?? Date.now()).toISOString();
  if (!startedAt) return { ...stats, computedAt };

  // An empty archive stores the empty marker, never its zeros: zeros would hide
  // the stats row for minutes after a first upload, and SKIPPING the write
  // would leave an older non-zero row standing forever (a row is only ever
  // replaced by a write).
  const { error } = await supabase.rpc("store_dashboard_stats", {
    p_user_id: userId,
    p_stats: stats.totalImages === 0 ? {} : { ...stats },
    p_computed_at: startedAt,
  });
  if (error) await reportSystemError("dashboard.stats-cache.write", error, { userId });
  return { ...stats, computedAt };
}

/**
 * Mark an account's stats as needing a recount: call after a write that
 * changes the gallery count (create, duplicate, delete, SPS import), whichever
 * screen made it. It stores an EMPTY row stamped by the database rather than
 * deleting the row, so the ordering in store_dashboard_stats also refuses a
 * background recount that started before the write and would otherwise land
 * the old numbers back. Photos added by uploads and imports are left to the
 * STATS_FRESH_MS window. Best-effort: the write it follows has already succeeded.
 */
export async function invalidateDashboardStats(supabase: SupabaseDB, userId: string): Promise<void> {
  const { error } = await supabase.rpc("invalidate_dashboard_stats", { p_user_id: userId });
  if (error) await reportSystemError("dashboard.stats-cache.invalidate", error, { userId });
}

export interface DashboardStatsRead extends DashboardStats {
  /** When the served numbers were counted (ISO). */
  computedAt: string;
}

export async function getDashboardStats(
  supabase: SupabaseDB,
  userId: string,
  { force = false }: { force?: boolean } = {}
): Promise<DashboardStatsRead> {
  let stored: { stats: DashboardStats; computedAt: string } | null = null;
  if (!force) {
    const { data, error } = await supabase
      .from("dashboard_stats_cache")
      .select("stats, computed_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      await reportSystemError("dashboard.stats-cache.read", error, { userId });
    } else if (data) {
      const stats = parseStoredStats(data.stats);
      // Postgres writes "+00:00" where the fresh path writes "Z"; one format out.
      const at = Date.parse(data.computed_at);
      if (stats && Number.isFinite(at)) stored = { stats, computedAt: new Date(at).toISOString() };
    }
  }

  const state = cacheState(stored?.computedAt ?? null, Date.now(), force);
  if (stored && state !== "miss") {
    if (state === "stale") {
      // After the response, so the stale row is not held up by the recount.
      after(async () => {
        try {
          await computeAndStore(supabase, userId);
        } catch (err) {
          await reportSystemError("dashboard.stats-cache.refresh", err, { userId });
        }
      });
    }
    return { ...stored.stats, computedAt: stored.computedAt };
  }

  return computeAndStore(supabase, userId);
}
