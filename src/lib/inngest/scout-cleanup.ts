/**
 * The cleanup behind every Scout clip attempt.
 *
 * Scheduled by the store BEFORE it calls the silent-copy pipeline, for every
 * attempt, success included: the pipeline holds upload URLs for
 * `mutePutTtlSeconds` and can keep running after our request gave up on it
 * (its own limit is 600 s), so a late PUT can land after anything the request
 * itself did. This waits past those URLs' lifetime, then:
 *   - ALWAYS deletes the staged copy (`scout-staging/<event>/<image>.mp4`):
 *     after a success it is a leftover, after a failure it is the evidence;
 *   - deletes the original and posters ONLY when no row uses the original.
 * Keys come from `clipKeys` (the two uuids), never from the event payload.
 * A run that exhausts its retries is reported (`scout.clip-cleanup-failed`),
 * never silent. The R2 lifecycle rule on `scout-staging/` (a release step) is
 * the backstop if this never runs.
 */
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteFromR2 } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";
import { clipKeys } from "@/lib/scout-integration/clip-keys";

async function deleteAll(keys: string[]): Promise<void> {
  const failed: string[] = [];
  for (const k of keys) {
    try {
      await deleteFromR2(k);
    } catch {
      failed.push(k);
    }
  }
  if (failed.length) throw new Error(`R2 delete failed for ${failed.length} key(s): ${failed.join(", ")}`);
}

export const scoutClipCleanup = inngest.createFunction(
  {
    id: "scout-clip-cleanup",
    retries: 3,
    onFailure: async ({ error, event }) => {
      await reportSystemError("scout.clip-cleanup-failed", error, {
        data: (event as { data?: { event?: { data?: unknown } } }).data?.event?.data ?? null,
      });
    },
  },
  { event: "scout/clip.cleanup" },
  async ({ event, step }) => {
    const { eventId, imageId, sleepSeconds } = event.data;
    const keys = clipKeys(eventId, imageId); // throws on anything but two uuids
    const wait = Math.min(Math.max(Math.ceil(sleepSeconds), 60), 3_600);
    await step.sleep("wait-past-upload-urls", `${wait}s`);

    await step.run("delete-staged-copy", () => deleteAll([keys.stagedKey]));

    return step.run("delete-unfiled-clip", async () => {
      const db = createServiceClient();
      const { data, error } = await db.from("images").select("id").eq("r2_key", keys.r2Key).limit(1);
      if (error) throw error; // retried: never delete on an unanswered question
      if (data?.length) return { stagedDeleted: true, kept: "a row uses this clip", r2Key: keys.r2Key };
      await deleteAll([keys.r2Key, ...keys.posterKeys]);
      return { stagedDeleted: true, deleted: 1 + keys.posterKeys.length };
    });
  }
);
