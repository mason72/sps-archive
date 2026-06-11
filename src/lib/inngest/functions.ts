import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { generateThumbnails } from "@/lib/thumbnails/generate";
import { syncSitePublication } from "@/lib/site/membership";
import { processVideoViaModal } from "@/lib/video/process";

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
        .select("original_filename, media_type")
        .eq("id", imageId)
        .single();
      if (error) throw error;
      return data;
    });

    // Videos need the ffmpeg poster pipeline, not sharp — hand off. (Browser
    // uploads dispatch video/uploaded directly; this catches SPS imports.)
    if (imageRecord.media_type === "video") {
      await step.sendEvent("forward-to-video-pipeline", {
        name: "video/uploaded",
        data: { imageId, eventId, r2Key },
      });
      return { imageId, status: "forwarded-to-video-pipeline" };
    }

    await step.run("generate-thumbnail", async () => {
      await generateThumbnails(r2Key, eventId, imageRecord.original_filename);

      const supabase = createServiceClient();
      await supabase
        .from("images")
        .update({ thumbnail_generated: true, processing_status: "complete" })
        .eq("id", imageId);
    });

    // Images imported straight into a website section (TDP Website gallery)
    // publish once thumbnails exist. No-op for everything else.
    await step.run("sync-site-publication", async () => {
      const supabase = createServiceClient();
      await syncSitePublication(supabase, [imageId]);
    });

    return { imageId, status: "complete" };
  }
);

/**
 * Function 2: Prepare an uploaded video for display.
 *
 * The video counterpart of processUploadedImage: the Modal ffmpeg pipeline
 * probes the file (duration, dimensions, audio, codec validation) and writes
 * the poster into the normal thumbnails/{variant}/ scheme, so
 * thumbnail_generated keeps gating display and site publication.
 *
 * An unsupported codec is a CLEAN rejection, not a retryable failure: the row
 * is marked failed with a human-readable processing_error the editor can
 * surface, and the binary stays safe in R2.
 */
export const processUploadedVideo = inngest.createFunction(
  {
    id: "process-uploaded-video",
    retries: 3,
    // Each run holds a Modal container busy for the length of a download +
    // remux; keep the fan-in narrow so a batch drop doesn't stampede.
    concurrency: { limit: 2 },
  },
  { event: "video/uploaded" },
  async ({ event, step }) => {
    const { imageId, r2Key } = event.data;

    const probe = await step.run("probe-and-poster", async () => {
      return processVideoViaModal(r2Key);
    });

    if (!probe.ok) {
      await step.run("mark-unsupported", async () => {
        const supabase = createServiceClient();
        await supabase
          .from("images")
          .update({
            processing_status: "failed",
            processing_error: probe.error ?? "Unsupported video",
          })
          .eq("id", imageId);
      });
      // Retrying won't change the codec — stop here, visibly.
      throw new NonRetriableError(probe.error ?? "Unsupported video");
    }

    await step.run("store-video-metadata", async () => {
      const supabase = createServiceClient();
      const { error } = await supabase
        .from("images")
        .update({
          duration_seconds: probe.durationSeconds,
          has_audio: probe.hasAudio,
          width: probe.width,
          height: probe.height,
          thumbnail_generated: true,
          processing_status: "complete",
          processing_error: null,
        })
        .eq("id", imageId);
      if (error) throw error;
    });

    // Videos uploaded straight into a website section publish once their
    // posters exist — that's now. No-op for everything else.
    await step.run("sync-site-publication", async () => {
      const supabase = createServiceClient();
      await syncSitePublication(supabase, [imageId]);
    });

    return { imageId, status: "complete" };
  }
);

/**
 * Function 3: Process an imported event from SPS.
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
