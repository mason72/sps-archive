import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Rebuild one photographer's /people snapshot (src/lib/people/index-cache.ts).
 *
 * ONE run per photographer at a time, and bursts collapse. That is what makes
 * the snapshot trustworthy: a run that starts after a write reads that write,
 * and no two builds for the same person can finish out of order. The first
 * draft rebuilt inside the request with `after()`, where "Not a person" then
 * Undo inside 26 seconds shared one build that had read the exclusion, and the
 * restored person stayed off the wall for ten minutes (caught in review,
 * 2026-09-11).
 */
export const peopleIndexRefresh = inngest.createFunction(
  {
    id: "people-index-refresh",
    retries: 1,
    concurrency: { key: "event.data.userId", limit: 1 },
    // A run of confirms, or exclude-then-undo, becomes one build.
    debounce: { key: "event.data.userId", period: "10s", timeout: "2m" },
  },
  { event: "people/index-refresh.requested" },
  async ({ event, step }) =>
    step.run("rebuild", async () => {
      const { rebuildPeopleIndexSnapshot } = await import("@/lib/people/index-cache");
      try {
        return await rebuildPeopleIndexSnapshot(createServiceClient(), event.data.userId);
      } catch (err) {
        const { reportSystemError } = await import("@/lib/monitoring/report");
        await reportSystemError("people-index-refresh", err, { userId: event.data.userId });
        throw err;
      }
    })
);
