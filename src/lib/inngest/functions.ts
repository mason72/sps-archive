import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { generateThumbnails } from "@/lib/thumbnails/generate";
import { syncSitePublication } from "@/lib/site/membership";
import { processVideoViaModal } from "@/lib/video/process";
import { findDigestCandidates, sendShareDigest } from "@/lib/favorites/digest-send";
import { buildShareZip } from "@/lib/zip/build-share-zip";
import { deleteFromR2, objectExistsInR2 } from "@/lib/r2/client";

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
      const thumbs = await generateThumbnails(
        r2Key,
        eventId,
        imageRecord.original_filename
      );

      const supabase = createServiceClient();
      await supabase
        .from("images")
        .update({
          thumbnail_generated: true,
          processing_status: "complete",
          ...(thumbs.dominantColor ? { dominant_color: thumbs.dominantColor } : {}),
        })
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

/**
 * Function 4: Favorites digest cron.
 *
 * Every 30 minutes, find shares whose favoriting has gone quiet for 2h with
 * undigested picks, and email the photographer a summary (preview strip +
 * "View Favorites"). shares.digested_at is the high-watermark: it advances
 * only after a successful send, so failures retry on the next tick, and a
 * client's later session digests again with just the new favorites.
 */
export const favoritesDigest = inngest.createFunction(
  { id: "favorites-digest", retries: 1 },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    const candidates = await step.run("find-candidates", async () => {
      const supabase = createServiceClient();
      return findDigestCandidates(supabase, new Date());
    });

    let sent = 0;
    for (const candidate of candidates) {
      const result = await step.run(`digest-${candidate.shareId}`, async () => {
        const supabase = createServiceClient();
        return sendShareDigest(supabase, candidate, new Date());
      });
      if (result === "sent") sent++;
    }

    return { candidates: candidates.length, sent };
  }
);

/**
 * Build a large gallery ZIP into R2 (see lib/zip/build-share-zip.ts).
 * One step — an archive stream can't checkpoint mid-build. Concurrency 2
 * bounds worst-case memory on the Inngest execution route.
 */
export const zipBuild = inngest.createFunction(
  { id: "zip-build", retries: 1, concurrency: { limit: 2 } },
  { event: "zip/requested" },
  async ({ event, step }) => {
    return step.run("build", async () => {
      try {
        return await buildShareZip(event.data.jobId);
      } catch (err) {
        // Missing job/share rows won't appear on retry — don't waste one.
        if (err instanceof Error && /not found|gone/.test(err.message)) {
          throw new NonRetriableError(err.message);
        }
        throw err;
      }
    });
  }
);

/**
 * Nightly upload reconciler — the safety net under the whole upload pipeline.
 *
 * Uploads can be abandoned mid-session (tab closed, Cancel, saturation): the
 * presign step pre-creates DB rows, so a dropped upload leaves either a GHOST
 * (row with no binary in R2 — renders as a broken tile forever) or an
 * UNFINALIZED row (binary landed but /complete never ran — stuck "pending").
 * The eBay HEADSHOTS incident (2026-07-06) left 413 ghosts + 45 unfinalized
 * rows and nobody knew for three days.
 *
 * Sweep, for every image stuck "pending" for >30 minutes:
 *  - original in R2 → backfill thumbnails if needed, flip to complete
 *  - original in R2, video → re-queue the ffmpeg poster pipeline
 *  - no original and row >24h old → confirmed ghost: delete the row
 *  - no original but <24h old → leave (a retry may still be coming); count it
 * Also backfills thumbnails for "complete" images whose thumbnail generation
 * failed (grid self-heal covers viewed tiles; this covers the rest).
 *
 * Anything done is recorded in system_errors (queryable history) and emailed
 * to the admin with per-gallery ghost filenames, so the photographer can be
 * told exactly what to re-upload.
 */
const RECONCILE_STALE_MINUTES = 30;
const RECONCILE_GHOST_HOURS = 24;
const RECONCILE_BATCH = 400; // rows examined per night
const RECONCILE_THUMB_CAP = 50; // sharp runs per night (heavy)

export const uploadReconciler = inngest.createFunction(
  { id: "upload-reconciler", retries: 1 },
  // Nightly at 2:43am PT, plus an event trigger for on-demand sweeps
  // (first-run backfills, post-incident cleanup).
  [{ cron: "43 9 * * *" }, { event: "reconciler/run" }],
  async ({ step }) => {
    const stats = await step.run("reconcile", async () => {
      const supabase = createServiceClient();
      const staleCutoff = new Date(
        Date.now() - RECONCILE_STALE_MINUTES * 60 * 1000
      ).toISOString();
      const ghostCutoff = new Date(
        Date.now() - RECONCILE_GHOST_HOURS * 60 * 60 * 1000
      ).toISOString();

      // Stuck-pending rows, oldest first.
      const { data: stalePending, error: pendingErr } = await supabase
        .from("images")
        .select(
          "id, r2_key, event_id, filename, original_filename, media_type, thumbnail_generated, width, height, created_at, events!event_id(name)"
        )
        .eq("processing_status", "pending")
        .lt("created_at", staleCutoff)
        .order("created_at", { ascending: true })
        .limit(RECONCILE_BATCH);
      if (pendingErr) throw pendingErr;

      // Complete-but-thumbless images (thumbnail generation failed earlier).
      const { data: thumbless, error: thumblessErr } = await supabase
        .from("images")
        .select(
          "id, r2_key, event_id, filename, original_filename, media_type, thumbnail_generated, width, height, created_at, events!event_id(name)"
        )
        .eq("processing_status", "complete")
        .eq("thumbnail_generated", false)
        .neq("media_type", "video")
        .lt("created_at", staleCutoff)
        .order("created_at", { ascending: true })
        .limit(100);
      if (thumblessErr) throw thumblessErr;

      const result = {
        examined: (stalePending?.length ?? 0) + (thumbless?.length ?? 0),
        finalized: 0,
        thumbsBackfilled: 0,
        videosRequeued: 0,
        ghostsDeleted: 0,
        watching: 0, // missing original but too young to delete
        failures: 0,
        ghostsByEvent: {} as Record<string, string[]>,
      };
      let thumbBudget = RECONCILE_THUMB_CAP;

      type Row = NonNullable<typeof stalePending>[number];
      const heal = async (row: Row, wasPending: boolean) => {
        const exists = await objectExistsInR2(row.r2_key);

        if (!exists) {
          if (row.created_at < ghostCutoff) {
            // Confirmed ghost — delete (cascades clean section links etc.).
            // Guarded so a row that progressed since the read is untouched.
            const { error: delErr } = await supabase
              .from("images")
              .delete()
              .eq("id", row.id)
              .eq("thumbnail_generated", false);
            if (delErr) {
              result.failures++;
              return;
            }
            result.ghostsDeleted++;
            const eventName =
              (row.events as { name?: string } | null)?.name ?? row.event_id;
            (result.ghostsByEvent[eventName] ??= []).push(
              row.original_filename ?? row.filename
            );
          } else {
            result.watching++;
          }
          return;
        }

        if (row.media_type === "video") {
          if (wasPending) {
            await inngest.send({
              name: "video/uploaded",
              data: { imageId: row.id, eventId: row.event_id, r2Key: row.r2_key },
            });
            result.videosRequeued++;
          }
          return;
        }

        try {
          const update: Record<string, unknown> = {
            processing_status: "complete",
          };
          if (!row.thumbnail_generated) {
            if (thumbBudget <= 0) return; // next night picks it up
            thumbBudget--;
            const thumbs = await generateThumbnails(
              row.r2_key,
              row.event_id,
              row.filename
            );
            update.thumbnail_generated = true;
            if (!row.width && thumbs.width) update.width = thumbs.width;
            if (!row.height && thumbs.height) update.height = thumbs.height;
            if (thumbs.dominantColor) update.dominant_color = thumbs.dominantColor;
            result.thumbsBackfilled++;
          } else {
            result.finalized++;
          }
          const { error: upErr } = await supabase
            .from("images")
            .update(update)
            .eq("id", row.id);
          if (upErr) throw upErr;
          await syncSitePublication(supabase, [row.id]);
        } catch (err) {
          console.error(`Reconciler heal failed for ${row.id}:`, err);
          result.failures++;
        }
      };

      // Small-batch concurrency: HEADs are cheap but sharp is not.
      const queue: Array<{ row: Row; wasPending: boolean }> = [
        ...(stalePending ?? []).map((row) => ({ row, wasPending: true })),
        ...(thumbless ?? []).map((row) => ({ row, wasPending: false })),
      ];
      let cursor = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (cursor < queue.length) {
            const item = queue[cursor++];
            await heal(item.row, item.wasPending);
          }
        })
      );

      return result;
    });

    const acted =
      stats.finalized +
        stats.thumbsBackfilled +
        stats.videosRequeued +
        stats.ghostsDeleted +
        stats.failures >
      0;

    if (acted) {
      await step.run("report", async () => {
        const supabase = createServiceClient();
        const summary = `finalized ${stats.finalized}, thumbs ${stats.thumbsBackfilled}, videos re-queued ${stats.videosRequeued}, ghosts deleted ${stats.ghostsDeleted}, watching ${stats.watching}, failures ${stats.failures}`;

        // Queryable history row (notified=true: this step sends its own email).
        await supabase.from("system_errors").insert({
          context: "upload.reconciler",
          message: summary,
          detail: JSON.parse(JSON.stringify(stats)),
          notified: true,
        });

        const adminEmail = process.env.ADMIN_ALERT_EMAIL;
        const resendKey = process.env.RESEND_API_KEY;
        if (!adminEmail || !resendKey) return;

        const ghostLines = Object.entries(stats.ghostsByEvent).flatMap(
          ([eventName, files]) => [
            "",
            `${eventName} — ${files.length} lost upload(s), ask for a re-upload of:`,
            ...files.slice(0, 30).map((f) => `  • ${f}`),
            ...(files.length > 30 ? [`  …and ${files.length - 30} more`] : []),
          ]
        );

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `Pixeltrunk Alerts <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
            to: [adminEmail],
            subject: `[Pixeltrunk] Nightly upload reconciler: ${summary}`,
            text: [
              "The nightly upload reconciler found work to do.",
              "",
              `Examined: ${stats.examined} stale rows`,
              `Finalized (binary fine, status was stuck): ${stats.finalized}`,
              `Thumbnails backfilled: ${stats.thumbsBackfilled}`,
              `Videos re-queued: ${stats.videosRequeued}`,
              `Ghost rows deleted (binary never landed): ${stats.ghostsDeleted}`,
              `Watching (missing binary, <24h old): ${stats.watching}`,
              `Failures (will retry next night): ${stats.failures}`,
              ...ghostLines,
            ].join("\n"),
          }),
        });
      });
    }

    return stats;
  }
);

/**
 * Daily sweep: delete expired built ZIPs from R2 and their job rows, plus
 * stale error/stuck rows. Guests always reach ZIPs through /download/status,
 * which won't serve an expired job — this just reclaims storage.
 */
export const zipCleanup = inngest.createFunction(
  { id: "zip-cleanup", retries: 1 },
  { cron: "17 6 * * *" },
  async ({ step }) => {
    return step.run("sweep", async () => {
      const supabase = createServiceClient();
      const cutoff = new Date().toISOString();
      const { data: expired } = await supabase
        .from("zip_jobs")
        .select("id, r2_key")
        .or(
          `expires_at.lt.${cutoff},and(status.eq.error,created_at.lt.${new Date(
            Date.now() - 24 * 3600 * 1000
          ).toISOString()})`
        )
        .limit(500);
      let deleted = 0;
      for (const row of expired ?? []) {
        try {
          if (row.r2_key) await deleteFromR2(row.r2_key);
          await supabase.from("zip_jobs").delete().eq("id", row.id);
          deleted++;
        } catch (err) {
          console.error(`zip-cleanup: failed for ${row.id}`, err);
        }
      }
      return { deleted };
    });
  }
);

/**
 * Cover raster: compose the mosaic/solid cover JPEG for email/OG serving.
 *
 * Fired on cover-settings saves (events PATCH) and by serve-time staleness
 * probes (resolveCoverRasterUrl). Debounced per event so a photographer
 * dragging sliders (600ms-debounced saves) doesn't queue a composite per
 * tweak — the eBay incident's regen-storm lesson applied to covers.
 */
export const coverRaster = inngest.createFunction(
  {
    id: "cover-raster",
    retries: 2,
    concurrency: { limit: 3 },
    debounce: { key: "event.data.eventId", period: "15s" },
  },
  { event: "cover/raster.generate" },
  async ({ event, step }) => {
    const { composeCoverRaster } = await import("@/lib/cover/raster");
    const key = await step.run("compose", () =>
      composeCoverRaster(event.data.eventId)
    );
    return { eventId: event.data.eventId, key };
  }
);
