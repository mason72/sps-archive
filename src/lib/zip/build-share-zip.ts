import archiver from "archiver";
import { createServiceClient } from "@/lib/supabase/server";
import { uploadStreamToR2 } from "@/lib/r2/client";
import {
  selectDownloadImages,
  scopeFrom,
  ZIP_JOB_TTL_HOURS,
  type DownloadScope,
} from "@/lib/gallery/download-core";
import { appendImagesToArchive, missingFilesManifest } from "./append-images";
import { reportSystemError } from "@/lib/monitoring/report";
import { logActivity } from "@/lib/analytics/log";

/**
 * Build one zip_jobs row: stream the archive straight into R2 (multipart,
 * bounded memory) and mark the job ready. Runs inside the Inngest zip-build
 * function — never in a request lambda, so a slow guest connection can't
 * OOM or time anything out; they download the finished object from R2.
 */
export async function buildShareZip(jobId: string): Promise<{
  status: string;
  imageCount?: number;
  sizeBytes?: number;
}> {
  const supabase = createServiceClient();

  const { data: job } = await supabase
    .from("zip_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (!job) throw new Error(`zip job ${jobId} not found`);
  if (job.status === "ready") {
    return { status: "ready" }; // retried after success — nothing to do
  }

  const { data: share } = await supabase
    .from("shares")
    .select("*")
    .eq("id", job.share_id)
    .single();
  if (!share) throw new Error(`share ${job.share_id} gone for zip job ${jobId}`);

  try {
    // Re-select at build time (authorization already happened at prepare;
    // the image set is re-derived so a between-click gallery edit is honored).
    const scope = scopeFrom(job.scope as DownloadScope);
    const selection = await selectDownloadImages(supabase, share, scope);
    if (!selection.ok) throw new Error(selection.message);

    // image_count is written at build START so the gallery's progress toast
    // can show "N of TOTAL" while building, not only after.
    await supabase
      .from("zip_jobs")
      .update({
        status: "building",
        image_count: selection.images.length,
        images_done: 0,
      })
      .eq("id", jobId);

    const r2Key = `zips/${share.id}/${jobId}.zip`;
    const archive = archiver("zip", { store: true });
    archive.on("error", (err: Error) => {
      console.error(`zip job ${jobId} archive error:`, err);
    });

    // Consumer first: the multipart upload pulls from the archive with real
    // backpressure, which makes the producer's high-water gate effective.
    const uploadDone = uploadStreamToR2(r2Key, archive, "application/zip");

    const failed = await appendImagesToArchive(
      archive,
      selection.images,
      selection.sectionsByImage,
      (done) => {
        // Fire-and-forget progress tick (issued in order; a lost/reordered
        // update self-corrects on the next tick and at completion).
        supabase
          .from("zip_jobs")
          .update({ images_done: done })
          .eq("id", jobId)
          .then(undefined, () => {});
      }
    );
    if (failed.length > 0) {
      archive.append(missingFilesManifest(failed, selection.images.length), {
        name: "_MISSING_FILES.txt",
      });
      void reportSystemError(
        "gallery.zip-job",
        `${failed.length}/${selection.images.length} images failed to fetch`,
        { jobId, shareId: share.id }
      );
    }
    await archive.finalize();
    await uploadDone;

    const sizeBytes = archive.pointer();
    const expiresAt = new Date(
      Date.now() + ZIP_JOB_TTL_HOURS * 3600 * 1000
    ).toISOString();

    await supabase
      .from("zip_jobs")
      .update({
        status: "ready",
        r2_key: r2Key,
        size_bytes: sizeBytes,
        image_count: selection.images.length,
        images_done: selection.images.length,
        ready_at: new Date().toISOString(),
        expires_at: expiresAt,
        error: null,
      })
      .eq("id", jobId);

    if (selection.eventUserId) {
      logActivity({
        userId: selection.eventUserId,
        action: "gallery_download",
        eventId: share.event_id,
        shareId: share.id,
        metadata: {
          imageCount: selection.images.length,
          scope: scope.favorites
            ? "favorites"
            : scope.section
            ? "section"
            : scope.images?.length
            ? "selection"
            : "all",
          via: "zip-job",
        },
      });
    }

    return {
      status: "ready",
      imageCount: selection.images.length,
      sizeBytes,
    };
  } catch (err) {
    await supabase
      .from("zip_jobs")
      .update({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", jobId);
    void reportSystemError("gallery.zip-job", err, {
      jobId,
      shareId: job.share_id,
    });
    throw err;
  }
}
