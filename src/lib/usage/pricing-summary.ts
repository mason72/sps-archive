/**
 * Weekly pricing summary (Phase 3) — the internal shadow invoice.
 *
 * For every account: trailing-30-day measured cost, storage stock, the
 * cheapest plan tier whose storage limit covers them (stripe/config.ts —
 * finally earning its keep), and the implied monthly margin. Emailed to
 * ADMIN_ALERT_EMAIL only; tester-facing versions are deliberately deferred
 * until the platform earns them (Mason, 2026-08-10).
 *
 * Numbers come from getUsageOverview — the SAME code path as /ops, so the
 * email can never disagree with the dashboard.
 */

import type { createServiceClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/stripe/config";
import { renderEmailShell } from "@/lib/email/shell";
import { getUsageOverview, type UserUsageSummary } from "./summary";
import { PLATFORM_OVERHEAD_MONTHLY } from "./costs";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Cheapest plan whose storage limit covers the user's stock. */
export function tierFor(storageBytes: number): {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number | null;
} {
  const order: PlanId[] = ["free", "solo", "pro", "studio", "enterprise"];
  for (const id of order) {
    if (storageBytes <= PLANS[id].storageLimitGB * 1e9) {
      return { id, name: PLANS[id].name, monthlyPriceUsd: PLANS[id].monthlyPriceUsd };
    }
  }
  return { id: "enterprise", name: "Enterprise", monthlyPriceUsd: null };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function row(u: UserUsageSummary): string {
  const tier = tierFor(u.storage.totalBytes);
  // Flow cost measured over 30 days ≈ a month; storage is already $/month.
  const monthlyCost = u.flowCost + u.storageCostMonthly;
  const margin =
    tier.monthlyPriceUsd == null ? null : tier.monthlyPriceUsd - monthlyCost;
  const marginCell =
    margin == null
      ? "custom"
      : `<span style="color:${margin >= 0 ? "#047857" : "#b91c1c"}">${money(margin)}</span>`;
  return `<tr>
<td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;">${u.email}</td>
<td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right;">${(u.storage.totalBytes / 1e9).toFixed(1)} GB</td>
<td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right;">${money(monthlyCost)}</td>
<td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;">${tier.name}${tier.monthlyPriceUsd != null ? ` (${money(tier.monthlyPriceUsd)})` : ""}</td>
<td style="padding:6px 10px;border-bottom:1px solid #e7e5e4;text-align:right;">${marginCell}</td>
</tr>`;
}

export async function sendPricingSummary(
  supabase: SupabaseDB
): Promise<{ sent: boolean; users: number }> {
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!resendKey || !to) return { sent: false, users: 0 };

  const windowStart = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const overview = await getUsageOverview(supabase, windowStart);

  const overhead = PLATFORM_OVERHEAD_MONTHLY.reduce((s, o) => s + o.monthly, 0);
  const totalCost =
    overview.totalFlowCost + overview.totalStorageCostMonthly + overhead;

  const body = `<p style="font-size:18px;font-weight:600;margin:0 0 4px;">Weekly pricing summary</p>
<p style="color:#78716c;margin:0 0 16px;">Trailing 30 days of measured usage, mapped onto the published tiers. Same numbers as /ops.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;">
<tr style="text-align:left;color:#a8a29e;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;">
<th style="padding:6px 10px;">Account</th><th style="padding:6px 10px;text-align:right;">Storage</th><th style="padding:6px 10px;text-align:right;">Cost/mo</th><th style="padding:6px 10px;">Tier fit</th><th style="padding:6px 10px;text-align:right;">Margin</th>
</tr>
${overview.users.map(row).join("\n")}
</table>
<p style="margin:16px 0 0;color:#57534e;">Platform total: <strong>${money(totalCost)}/mo</strong> (flows ${money(overview.totalFlowCost)} + storage ${money(overview.totalStorageCostMonthly)} + overhead ${money(overhead)}).</p>
<p style="color:#a8a29e;font-size:12px;">Margin = tier list price − measured cost. Tier fit is storage-based; overhead is a configured estimate.</p>`;

  const html = renderEmailShell({ body, fromName: "Pixeltrunk Ops" });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Pixeltrunk Ops <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
      to: [to],
      subject: `Pixeltrunk pricing summary — ${overview.users.length} accounts, ${money(totalCost)}/mo`,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return { sent: true, users: overview.users.length };
}
