/**
 * Ops crons (Phase 3): the automation layer over usage metering. Kept out of
 * functions.ts, which is content-pipeline territory and long enough already.
 *
 * Both carry a manual event trigger alongside the cron so a real run can be
 * fired on demand (first-run verification, post-incident checks) — the
 * reconciler's pattern.
 */
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { runDailyAnomalyCheck } from "@/lib/usage/anomaly";
import { sendPricingSummary } from "@/lib/usage/pricing-summary";

/** Daily 8:07am PT (15:07 UTC): yesterday vs 2× max(7d avg, baseline). */
export const usageAnomalyDaily = inngest.createFunction(
  { id: "usage-anomaly-daily", retries: 1 },
  [{ cron: "7 15 * * *" }, { event: "ops/anomaly.run" }],
  async ({ step }) => {
    return step.run("check", async () => {
      const supabase = createServiceClient();
      const result = await runDailyAnomalyCheck(supabase);
      return {
        checked: result.checked,
        flagged: result.flagged.map((f) => f.email),
        config: result.config,
      };
    });
  }
);

/** Mondays 8:11am PT (15:11 UTC): the internal shadow-invoice email. */
export const pricingSummaryWeekly = inngest.createFunction(
  { id: "pricing-summary-weekly", retries: 1 },
  [{ cron: "11 15 * * 1" }, { event: "ops/pricing-summary.run" }],
  async ({ step }) => {
    return step.run("send", async () => {
      const supabase = createServiceClient();
      return sendPricingSummary(supabase);
    });
  }
);
