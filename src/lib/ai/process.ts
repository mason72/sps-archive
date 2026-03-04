import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import type { ProcessingJob, ImageProcessingResult } from "./types";

const MODAL_API_URL = process.env.MODAL_API_URL || "https://your-modal-app--process-image.modal.run";
const MODAL_ANALYZE_URL = process.env.MODAL_ANALYZE_URL || "https://your-modal-app--analyze-event-sample.modal.run";

/**
 * Trigger AI processing for a single image.
 * Calls Modal serverless function which runs CLIP + ArcFace + aesthetic scoring.
 */
export async function processImage(job: ProcessingJob): Promise<ImageProcessingResult> {
  const response = await fetch(MODAL_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_id: job.imageId,
      image_url: job.downloadUrl,
      event_id: job.eventId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Modal processing failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

/**
 * Save AI processing results back to Supabase.
 */
export async function saveProcessingResults(result: ImageProcessingResult) {
  const supabase = createServiceClient();

  // Update image with CLIP embedding and scores
  const { error: imageError } = await supabase
    .from("images")
    .update({
      clip_embedding: JSON.stringify(result.clip.embedding),
      scene_tags: result.clip.sceneTags,
      aesthetic_score: result.aesthetic.aestheticScore,
      sharpness_score: result.aesthetic.sharpnessScore,
      processing_status: "complete",
    })
    .eq("id", result.imageId);

  if (imageError) throw imageError;

  // Insert detected faces
  if (result.faces.faces.length > 0) {
    const faceRows = result.faces.faces.map((face) => ({
      image_id: result.imageId,
      bbox_x: face.bbox.x,
      bbox_y: face.bbox.y,
      bbox_w: face.bbox.w,
      bbox_h: face.bbox.h,
      embedding: JSON.stringify(face.embedding),
    }));

    const { error: facesError } = await supabase.from("faces").insert(faceRows);
    if (facesError) throw facesError;
  }
}

/** Result from event sample analysis via Modal */
export interface EventSampleAnalysis {
  eventId: string;
  sceneDistribution: Record<string, number>;
  sampleSize: number;
  errors: number;
}

/**
 * Run quick event-level analysis on a sample of images via Modal.
 * Used for early event type detection during upload (before full processing).
 */
export async function analyzeEventSample(
  imageUrls: string[],
  eventId: string
): Promise<EventSampleAnalysis> {
  const response = await fetch(MODAL_ANALYZE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_urls: imageUrls,
      event_id: eventId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Modal event analysis failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

/**
 * Create a processing job for an image.
 */
export async function createProcessingJob(
  imageId: string,
  r2Key: string,
  eventId: string
): Promise<ProcessingJob> {
  const downloadUrl = await getPresignedDownloadUrl(r2Key, 3600);

  return {
    imageId,
    r2Key,
    eventId,
    downloadUrl,
  };
}
