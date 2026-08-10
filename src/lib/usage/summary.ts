/**
 * Per-user usage + cost summaries — the ONE compute home for "what does each
 * user cost". The /ops dashboard and the weekly pricing email (Phase 3) both
 * call this, so their numbers can never diverge (both-sides-of-a-delta rule).
 *
 * Flows come from usage_events (measured), storage from getUserStorage()
 * (live stock), prices from costs.ts. Alpha-scale implementation: it loads
 * the window's ledger rows and aggregates in TS — fine for tens of users,
 * revisit with a SQL rollup if the ledger grows past ~100k rows/month.
 */

import type { createServiceClient } from "@/lib/supabase/server";
import { costOf, storageCostPerMonth } from "./costs";
import type { UsageKind } from "./record";
import { getUserStorage, type UserStorage } from "./storage";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface FlowSummary {
  quantity: number;
  unit: string;
  count: number;
  cost: number;
}

export interface UserUsageSummary {
  userId: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  joinedAt: string;
  lastActiveAt: string | null;
  storage: UserStorage;
  /** $/month to hold this user's bytes in R2 at today's stock. */
  storageCostMonthly: number;
  /** Measured flows inside the window, keyed by kind. */
  flows: Partial<Record<UsageKind, FlowSummary>>;
  /** $ of measured flows inside the window. */
  flowCost: number;
}

export interface UsageOverview {
  users: UserUsageSummary[];
  /** Sum of flowCost across users for the window. */
  totalFlowCost: number;
  /** Sum of storageCostMonthly across users. */
  totalStorageCostMonthly: number;
  totalStorageBytes: number;
  /** Daily flow cost for the trailing 30 days (oldest first), zero-filled. */
  dailyFlowCosts: { date: string; cost: number }[];
}

export async function getUsageOverview(
  supabase: SupabaseDB,
  windowStart: Date
): Promise<UsageOverview> {
  // All users (alpha scale — one page is plenty; listUsers caps at 1000).
  const { data: userList, error: usersError } =
    await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;

  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, is_admin");
  if (profilesError) throw profilesError;
  const profileById = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);

  // Trailing-30d ledger covers both the window aggregation and the sparkline.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const ledgerStart = windowStart < thirtyDaysAgo ? windowStart : thirtyDaysAgo;
  const { data: ledger, error: ledgerError } = await supabase
    .from("usage_events")
    .select("user_id, kind, quantity, unit, created_at")
    .gte("created_at", ledgerStart.toISOString())
    .order("created_at", { ascending: true })
    .limit(50_000);
  if (ledgerError) throw ledgerError;
  const rows = ledger ?? [];

  const users: UserUsageSummary[] = [];
  for (const u of userList.users) {
    const profile = profileById.get(u.id);
    const storage = await getUserStorage(supabase, u.id);

    const flows: Partial<Record<UsageKind, FlowSummary>> = {};
    let flowCost = 0;
    let lastActiveAt: string | null = null;
    for (const r of rows) {
      if (r.user_id !== u.id) continue;
      if (new Date(r.created_at) < windowStart) continue;
      const kind = r.kind as UsageKind;
      const entry = (flows[kind] ??= {
        quantity: 0,
        unit: r.unit,
        count: 0,
        cost: 0,
      });
      const qty = Number(r.quantity);
      entry.quantity += qty;
      entry.count += 1;
      const c = costOf(kind, qty);
      entry.cost += c;
      flowCost += c;
      if (!lastActiveAt || r.created_at > lastActiveAt) lastActiveAt = r.created_at;
    }

    users.push({
      userId: u.id,
      email: u.email ?? "(no email)",
      displayName: profile?.display_name ?? null,
      isAdmin: !!profile?.is_admin,
      joinedAt: u.created_at,
      lastActiveAt,
      storage,
      storageCostMonthly: storageCostPerMonth(storage.totalBytes),
      flows,
      flowCost,
    });
  }
  users.sort((a, b) => b.flowCost + b.storageCostMonthly - (a.flowCost + a.storageCostMonthly));

  // Zero-filled trailing-30d daily series (UTC dates).
  const dailyMap = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    dailyMap.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    if (dailyMap.has(day)) {
      dailyMap.set(day, dailyMap.get(day)! + costOf(r.kind as UsageKind, Number(r.quantity)));
    }
  }

  return {
    users,
    totalFlowCost: users.reduce((s, u) => s + u.flowCost, 0),
    totalStorageCostMonthly: users.reduce((s, u) => s + u.storageCostMonthly, 0),
    totalStorageBytes: users.reduce((s, u) => s + u.storage.totalBytes, 0),
    dailyFlowCosts: [...dailyMap.entries()].map(([date, cost]) => ({ date, cost })),
  };
}
