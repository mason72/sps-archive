/**
 * Daily cost-anomaly check (Phase 3): flag any user whose YESTERDAY metered
 * cost exceeded multiplier × max(their trailing-7-day average, the configured
 * baseline). The baseline floor keeps onboarding testers — whose own average
 * is near zero — from paging on their first real day of use; a genuinely
 * runaway account still trips it. Knobs live in ops_config key "anomaly".
 *
 * Flags go out as ONE reportSystemError (context "usage.anomaly") carrying
 * every flagged user, so the hourly email throttle can't swallow the second
 * user behind the first.
 */

import type { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { costOf } from "./costs";
import type { UsageKind } from "./record";

type SupabaseDB = ReturnType<typeof createServiceClient>;

interface AnomalyConfig {
  baselineDailyCost: number;
  multiplier: number;
}

/**
 * baselineDailyCost is a FLOOR on the threshold, so the alert can never fire
 * below multiplier x baseline — $10/day here.
 *
 * Raised from $1 to $5 on 2026-08-30, after a $2.34 day paged for being 9x a
 * $0.26 trailing average. It was honest work: 18,736 photos uploaded and
 * indexed, no re-indexing. The archive idles most days, so a $1 floor made
 * every real shoot day a page, and an alert that fires on a busy Tuesday is one
 * you learn to ignore before the day it is right.
 *
 * Measured against the whole ledger: the busiest days on record are $2.34,
 * $2.19, $1.74, $1.62, $1.42. Nothing has ever reached $5, and $10 is ~80,000
 * photos in a day — reachable by a runaway loop, not by shooting. Once the
 * trailing average passes $5 the floor stops binding and the threshold tracks
 * the average again, so this needs no upkeep as volume grows.
 */
const DEFAULTS: AnomalyConfig = { baselineDailyCost: 5.0, multiplier: 2 };

export interface AnomalyFlag {
  userId: string;
  email: string;
  yesterdayCost: number;
  sevenDayAvg: number;
  threshold: number;
}

export async function runDailyAnomalyCheck(supabase: SupabaseDB): Promise<{
  checked: number;
  flagged: AnomalyFlag[];
  config: AnomalyConfig;
}> {
  const { data: configRow } = await supabase
    .from("ops_config")
    .select("value")
    .eq("key", "anomaly")
    .maybeSingle();
  const config: AnomalyConfig = {
    ...DEFAULTS,
    ...((configRow?.value as Partial<AnomalyConfig>) ?? {}),
  };

  // UTC day boundaries: yesterday plus the seven days before it.
  const dayMs = 24 * 3600 * 1000;
  const todayStart = new Date(new Date().toISOString().slice(0, 10));
  const yesterdayStart = new Date(todayStart.getTime() - dayMs);
  const windowStart = new Date(todayStart.getTime() - 8 * dayMs);

  const { data: rows, error } = await supabase
    .from("usage_events")
    .select("user_id, kind, quantity, created_at")
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", todayStart.toISOString())
    .limit(100_000);
  if (error) throw error;

  // Per user: yesterday's cost and the prior-7-day daily average.
  const yesterday = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const r of rows ?? []) {
    const cost = costOf(r.kind as UsageKind, Number(r.quantity));
    const at = new Date(r.created_at);
    if (at >= yesterdayStart) {
      yesterday.set(r.user_id, (yesterday.get(r.user_id) ?? 0) + cost);
    } else {
      prior.set(r.user_id, (prior.get(r.user_id) ?? 0) + cost);
    }
  }

  const flagged: AnomalyFlag[] = [];
  for (const [userId, yCost] of yesterday) {
    const avg = (prior.get(userId) ?? 0) / 7;
    const threshold =
      config.multiplier * Math.max(avg, config.baselineDailyCost);
    if (yCost > threshold) {
      const { data: u } = await supabase.auth.admin.getUserById(userId);
      flagged.push({
        userId,
        email: u?.user?.email ?? userId,
        yesterdayCost: yCost,
        sevenDayAvg: avg,
        threshold,
      });
    }
  }

  if (flagged.length) {
    await reportSystemError(
      "usage.anomaly",
      `${flagged.length} account(s) exceeded the daily cost threshold`,
      {
        flagged: flagged.map((f) => ({
          email: f.email,
          yesterday: `$${f.yesterdayCost.toFixed(2)}`,
          sevenDayAvg: `$${f.sevenDayAvg.toFixed(2)}`,
          threshold: `$${f.threshold.toFixed(2)}`,
        })),
        config,
      }
    );
  }

  return { checked: yesterday.size, flagged, config };
}
