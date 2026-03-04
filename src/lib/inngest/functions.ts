import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { createProcessingJob, processImage, saveProcessingResults } from "@/lib/ai/process";
import { buildFaceStacks, buildBurstStacks } from "@/lib/ai/stacks";
import { generateAutoSections } from "@/lib/ai/sections";
import { generateThumbnails } from "@/lib/thumbnails/generate";
import { analyzeExistingEvent } from "@/lib/ai/event-analysis";
import { matchEventTemplate } from "@/lib/ai/event-templates";

/**
 * Function 1: Process a single uploaded image.
 *
 * Pipeline: thumbnails → Modal AI → save results → check event completion
 */
export const processUploadedImage = inngest.createFunction(
  {
    id: "process-uploaded-image",
    retries: 3,
    concurrency: { limit: 10 },
    onFailure: async ({ event }) => {
      // Mark image as failed so it doesn't block event completion
      const supabase = createServiceClient();
      await supabase
        .from("images")
        .update({ processing_status: "failed" })
        .eq("id", event.data.event.data.imageId);
    },
  },
  { event: "image/uploaded" },
  async ({ event, step }) => {
    const { imageId, eventId, r2Key } = event.data;

    // Step 1: Fetch image record for filename
    const imageRecord = await step.run("fetch-image-record", async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("images")
        .select("original_filename, processing_status")
        .eq("id", imageId)
        .single();

      if (error) throw error;
      return data;
    });

    // Step 2: Generate thumbnails (3 sizes via sharp)
    await step.run("generate-thumbnails", async () => {
      await generateThumbnails(r2Key, eventId, imageRecord.original_filename);
    });

    // Step 3: Run AI processing via Modal (CLIP + ArcFace + aesthetic)
    const aiResult = await step.run("ai-process", async () => {
      const job = await createProcessingJob(imageId, r2Key, eventId);
      return processImage(job);
    });

    // Step 4: Save AI results to Supabase
    await step.run("save-results", async () => {
      await saveProcessingResults(aiResult);
    });

    // Step 5: Check if all images for this event are done
    await step.run("check-event-completion", async () => {
      const supabase = createServiceClient();

      const { count } = await supabase
        .from("images")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId)
        .in("processing_status", ["pending", "processing"]);

      if (count === 0) {
        // All images done — trigger stack building
        await inngest.send({
          name: "event/processing.complete",
          data: { eventId },
        });
      }
    });

    return { imageId, status: "complete" };
  }
);

/**
 * Function 2: Build stacks and sections after all images in an event are processed.
 */
export const buildEventStacks = inngest.createFunction(
  {
    id: "build-event-stacks",
    retries: 2,
  },
  { event: "event/processing.complete" },
  async ({ event, step }) => {
    const { eventId } = event.data;

    await step.run("build-face-stacks", async () => {
      await buildFaceStacks(eventId);
    });

    await step.run("build-burst-stacks", async () => {
      await buildBurstStacks(eventId);
    });

    await step.run("generate-sections", async () => {
      await generateAutoSections(eventId);
    });

    // Trigger AI event analysis after stacks and sections are built
    await step.run("trigger-event-analysis", async () => {
      await inngest.send({
        name: "event/analyze",
        data: { eventId, autoApply: true },
      });
    });

    return { eventId, status: "stacks-and-sections-built" };
  }
);

/**
 * Function 3: Process an imported event from SPS.
 *
 * Fans out individual image processing for each pending image.
 */
export const processImportedEvent = inngest.createFunction(
  {
    id: "process-imported-event",
    retries: 2,
  },
  { event: "event/imported" },
  async ({ event, step }) => {
    const { eventId } = event.data;

    // Get all pending images for this event
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

    // Fan out: send an image/uploaded event for each image
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

        // Inngest supports batch sending
        await inngest.send(events);
      });
    }

    return { eventId, imageCount: pendingImages.length };
  }
);

/**
 * Function 4: Analyze an event's images to detect type, suggest config, and auto-organize.
 *
 * Triggered after all images are processed, or manually by the user.
 * If autoApply is true, updates the event with detected settings.
 */
export const analyzeEvent = inngest.createFunction(
  {
    id: "analyze-event",
    retries: 2,
  },
  { event: "event/analyze" },
  async ({ event, step }) => {
    const { eventId, autoApply } = event.data;

    // Step 1: Run AI analysis on the event's processed images
    const analysis = await step.run("analyze-event-images", async () => {
      return analyzeExistingEvent(eventId);
    });

    // Step 2: Match to an event template if one exists
    const template = await step.run("match-template", async () => {
      return matchEventTemplate(
        analysis.detectedEventType,
        event.data.eventId
      );
    });

    // Step 3: Auto-apply detected settings if requested
    if (autoApply) {
      await step.run("apply-event-settings", async () => {
        const supabase = createServiceClient();

        const updates: Record<string, unknown> = {
          event_type: analysis.detectedEventType,
        };

        // Apply template sections if found
        if (template) {
          updates.settings = {
            ai_detected_type: analysis.detectedEventType,
            ai_confidence: analysis.typeConfidence,
            template_id: template.id,
          };
        } else {
          updates.settings = {
            ai_detected_type: analysis.detectedEventType,
            ai_confidence: analysis.typeConfidence,
          };
        }

        await supabase.from("events").update(updates).eq("id", eventId);

        // Create template sections if a template was matched
        if (template?.sections) {
          const sectionInserts = template.sections.map(
            (s: { name: string; sortOrder: number }, idx: number) => ({
              event_id: eventId,
              name: s.name,
              sort_order: s.sortOrder ?? idx,
              is_auto: false,
            })
          );
          await supabase.from("sections").insert(sectionInserts);
        }
      });
    }

    // Step 4: Notify that analysis is complete
    await step.run("notify-analysis-complete", async () => {
      await inngest.send({
        name: "event/analysis.complete",
        data: {
          eventId,
          detectedEventType: analysis.detectedEventType,
          suggestedName: analysis.suggestedName,
          shouldSplit: analysis.shouldSplit,
        },
      });
    });

    return {
      eventId,
      analysis: {
        detectedEventType: analysis.detectedEventType,
        typeConfidence: analysis.typeConfidence,
        suggestedName: analysis.suggestedName,
        shouldSplit: analysis.shouldSplit,
        timeGaps: analysis.timeGaps.length,
        suggestedEventCount: analysis.suggestedEvents.length,
      },
    };
  }
);
