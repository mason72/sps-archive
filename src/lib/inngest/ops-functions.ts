/**
 * Ops crons (Phase 3): the automation layer over usage metering. Kept out of
 * functions.ts, which is content-pipeline territory and long enough already.
 *
 * All carry a manual event trigger alongside the cron so a real run can be
 * fired on demand (first-run verification, post-incident checks) — the
 * reconciler's pattern.
 */
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { runDailyAnomalyCheck } from "@/lib/usage/anomaly";
import { sendPricingSummary } from "@/lib/usage/pricing-summary";
import { runCapacityCheck } from "@/lib/monitoring/capacity";
import { reportSystemError } from "@/lib/monitoring/report";

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

/**
 * Hourly at :23: is the database still big enough, and is the AI lane keeping
 * up? Emails one plain-language alert with the action attached, at most once a
 * day per finding unless it gets worse (src/lib/monitoring/capacity.ts).
 *
 * Born 2026-10-04 (lesson 175): the archive outgrew a 1 GB database and the
 * only signal was 93 identical "statement timeout" emails. This reads the
 * cause instead.
 */
export const capacityCheck = inngest.createFunction(
  { id: "capacity-check", retries: 1 },
  [{ cron: "23 * * * *" }, { event: "ops/capacity.run" }],
  async ({ step }) => {
    return step.run("check", async () => {
      try {
        const { isAiIndexingEnabled } = await import("@/lib/ai-index/index-event");
        const result = await runCapacityCheck(createServiceClient(), {
          aiEnabled: isAiIndexingEnabled(),
        });
        return {
          findings: result.findings.map((f) => `${f.severity}: ${f.key}`),
          alerted: result.alerted,
          emailed: result.emailed,
          errors: result.snapshot.errors,
        };
      } catch (err) {
        // A watchdog that dies quietly is the failure it exists to prevent.
        await reportSystemError("capacity.check-crashed", err, {});
        throw err;
      }
    });
  }
);
