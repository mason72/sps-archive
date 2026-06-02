import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { generateThumbnails } from "@/lib/thumbnails/generate";

/**
 * AI PROCESSING IS DISABLED.
 *
 * The Modal AI pipeline (CLIP embeddings, ArcFace faces, aesthetic scoring)
 * and auto-section generation are shelved. They were not only unused (AI
 * features are hidden in the UI) but actively harmful: a failing Modal step
 * marked fully-uploaded photos as "failed" — hiding them and whole sections
 * from client galleries — and the auto-section generator rewrote manually
 * organized section membership in the background.
 *
 * What remains is the only thing display actually needs: thumbnail generation.
 */

/**
 * Function 1: Prepare an uploaded/imported image for display.
 *
 * Generates the thumbnail and marks the image complete. No Modal, no AI.
 *
 * Normal browser uploads never reach here — the proxy upload route
 * (/api/upload/[imageId]) generates thumbnails inline from the upload buffer,
 * and /api/upload/complete marks the row complete. This path exists for SPS
 * zero-copy imports, where the binary already lives in R2 (no upload buffer)
 * and the thumbnail still has to be produced server-side.
 */
export const processUploadedImage = inngest.createFunction(
  {
    id: "process-uploaded-image",
    retries: 3,
    concurrency: { limit: 5 },
  },
  { event: "image/uploaded" },
  async ({ event, step }) => {
    const { imageId, eventId, r2Key } = event.data;

    const imageRecord = await step.run("fetch-image-record", async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("images")
        .select("original_filename")
        .eq("id", imageId)
        .single();
      if (error) throw error;
      return data;
    });

    await step.run("generate-thumbnail", async () => {
      await generateThumbnails(r2Key, eventId, imageRecord.original_filename);

      const supabase = createServiceClient();
      await supabase
        .from("images")
        .update({ thumbnail_generated: true, processing_status: "complete" })
        .eq("id", imageId);
    });

    return { imageId, status: "complete" };
  }
);

/**
 * Function 2: Process an imported event from SPS.
 *
 * Fans out a thumbnail job for each imported image (binaries are already in
 * R2 via zero-copy import; they just need thumbnails + a complete status).
 */
export const processImportedEvent = inngest.createFunction(
  {
    id: "process-imported-event",
    retries: 2,
  },
  { event: "event/imported" },
  async ({ event, step }) => {
    const { eventId } = event.data;

    const pendingImages = await step.run("get-pending-images", async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("images")
        .select("id, r2_key")
        .eq("event_id", eventId)
        .eq("processing_status", "pending");

      if (error) throw error;
      return data || [];
    });

    if (pendingImages.length > 0) {
      await step.run("fan-out-processing", async () => {
        const events = pendingImages.map((img) => ({
          name: "image/uploaded" as const,
          data: {
            imageId: img.id,
            eventId,
            r2Key: img.r2_key,
          },
        }));

        await inngest.send(events);
      });
    }

    return { eventId, imageCount: pendingImages.length };
  }
);
