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

/**
 * Daily 3:41am PT (10:41 UTC): move originals untouched for 30 days to R2
 * Infrequent Access (src/lib/r2/tiering.ts). Walks the bucket in bounded
 * slices from a cursor in ops_config, so one lap of the archive can span a
 * few runs. Off unless R2_IA_TIERING_ENABLED is "true".
 *
 * Born 2026-10-20: the bill crossed its $75 alert once the Pixieset migration
 * landed (~4.3 TB of originals), and Infrequent Access saves ~$21/month on
 * files that are almost never read.
 */
// A slice stops STARTING pages after 5 minutes (a full page of copies takes
// ~3 min at the measured ~5 copies/s) and stops starting COPIES at 580 s; a
// copy in flight is capped at 150 s, so a step ends by ~735 s, under the
// route's 800 s even when R2 turns slow mid-page. 150 slices is more than one
// lap (~4,500 pages, ~1.3 s each).
const IA_SLICE_BUDGET_MS = 5 * 60 * 1000;
const IA_SLICE_HARD_MS = 580 * 1000;
const IA_MAX_SLICES = 150;

export const r2InfrequentAccess = inngest.createFunction(
  {
    id: "r2-infrequent-access",
    // A listing can fail on a transient DNS/network blip (seen 2026-10-20 on
    // the dry run); the cursor is saved per page, so a retried step resumes.
    retries: 3,
    concurrency: { limit: 1 },
    // A run that dies after its retry must not fail silently.
    onFailure: async ({ error }) => {
      await reportSystemError("r2.ia-tiering-crashed", error, {});
    },
  },
  [{ cron: "41 10 * * *" }, { event: "ops/r2-ia.run" }],
  async ({ step }) => {
    const { isIaTieringEnabled } = await import("@/lib/r2/tiering");
    if (!isIaTieringEnabled()) return { skipped: 'R2_IA_TIERING_ENABLED is not "true"' };

    const { runIaSlice } = await import("@/lib/r2/tiering-run");
    const totals = { slices: 0, pages: 0, moved: 0, movedGB: 0, failed: 0, wrapped: false, stalled: false };
    const failures: { key: string; error: string }[] = [];
    for (let i = 0; i < IA_MAX_SLICES; i++) {
      const r = await step.run(`walk-${i}`, async () => {
        const res = await runIaSlice(createServiceClient(), IA_SLICE_BUDGET_MS, IA_SLICE_HARD_MS);
        // Inngest stores step output: keep it small.
        return { ...res, failed: res.failed.slice(0, 20), failedCount: res.failed.length };
      });
      totals.slices += 1;
      totals.pages += r.pages;
      totals.moved += r.moved;
      totals.movedGB = Math.round((totals.movedGB + r.movedBytes / 1e9) * 100) / 100;
      totals.failed += r.failedCount;
      if (failures.length < 20) failures.push(...r.failed);
      if (r.wrapped || r.stalled) {
        totals.wrapped = r.wrapped;
        totals.stalled = r.stalled;
        break;
      }
    }

    if (totals.failed > 0 || totals.stalled) {
      await step.run("report", () =>
        reportSystemError(
          "r2.ia-tiering",
          new Error(
            totals.stalled
              ? "R2 Infrequent Access walk stalled: every copy in a page failed (5 or more)"
              : `R2 Infrequent Access: ${totals.failed} copies failed (they stay on the normal tier and retry next lap)`
          ),
          { totals, sample: failures.slice(0, 10) }
        )
      );
    }
    return totals;
  }
);
