/**
 * Delayed cleanup after a Scout clip attempt that did not finish.
 *
 * The silent-copy pipeline holds upload URLs for `mutePutTtlSeconds` and can
 * keep running after our request gave up on it (its own limit is 600 s), so a
 * late PUT can land AFTER the request rolled back. This waits past those URLs'
 * lifetime and then deletes every key the attempt could have written
 * (`clipKeys`: staged copy, original, posters), unless a row now uses the
 * original key, in which case it touches nothing.
 *
 * Sent by the store BEFORE its own rollback, so even a request killed mid-
 * rollback is cleaned up. The R2 lifecycle rule on `staging/` is the backstop
 * if this never runs.
 */
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteFromR2 } from "@/lib/r2/client";
import { clipKeys } from "@/lib/scout-integration/clip-keys";

export const scoutClipCleanup = inngest.createFunction(
  { id: "scout-clip-cleanup", retries: 3 },
  { event: "scout/clip.cleanup" },
  async ({ event, step }) => {
    const { eventId, imageId, sleepSeconds } = event.data;
    const keys = clipKeys(eventId, imageId); // throws on anything but two uuids
    const wait = Math.min(Math.max(Math.ceil(sleepSeconds), 60), 3_600);
    await step.sleep("wait-past-upload-urls", `${wait}s`);

    return step.run("delete-attempt-keys", async () => {
      const db = createServiceClient();
      const { data, error } = await db.from("images").select("id").eq("r2_key", keys.r2Key).limit(1);
      if (error) throw error; // retried: never delete on an unanswered question
      if (data?.length) return { skipped: "a row uses this clip", r2Key: keys.r2Key };
      const all = [keys.stagedKey, keys.r2Key, ...keys.posterKeys];
      const failed: string[] = [];
      for (const k of all) {
        try {
          await deleteFromR2(k);
        } catch {
          failed.push(k);
        }
      }
      if (failed.length) throw new Error(`R2 delete failed for ${failed.length} key(s): ${failed.join(", ")}`);
      return { deleted: all.length };
    });
  }
);
