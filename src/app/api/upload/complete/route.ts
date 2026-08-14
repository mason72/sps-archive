import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { generateThumbnails } from "@/lib/thumbnails/generate";
import { syncSitePublication } from "@/lib/site/membership";
import { inngest } from "@/lib/inngest/client";
import { reportSystemError } from "@/lib/monitoring/report";

// Large originals (>4MB direct uploads) are downloaded here for thumbnailing;
// give sharp room and a node runtime.
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2. Records EXIF/dimensions, ensures
 * a thumbnail exists, and marks the image "complete".
 *
 * Two upload paths converge here:
 *  - Proxy uploads (≤4MB) already generated thumbnails inline in
 *    /api/upload/[imageId], so thumbnail_generated is already true and we skip
 *    the work below.
 *  - Direct uploads (>4MB, browser→R2) never touched the server, so no
 *    thumbnail exists yet. We generate it here from the R2 original (download +
 *    sharp). Since display now gates on thumbnail_generated, a direct upload
 *    would otherwise be invisible in the gallery.
 *
 * Thumbnail generation here is best-effort: if it fails the original is safe,
 * the editor grid self-heals on view (/api/images/[id]/regenerate-thumbnail),
 * and /api/admin/batch-thumbnails backfills out of band.
 */
export async function POST(request: NextRequest) {
  let imageIdForReport: string | undefined;
  try {
    // getAuthUser hands back the SERVICE client (bypasses RLS), so the image
    // lookup below MUST carry the ownership join — without both, this route
    // was an unauthenticated write endpoint (same hole as lessons #2/#14).
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { imageId, width, height, exif } = body as {
      imageId: string;
      width?: number;
      height?: number;
      exif?: {
        takenAt?: string;
        cameraMake?: string;
        cameraModel?: string;
        lens?: string;
        focalLength?: number;
        aperture?: number;
        shutterSpeed?: string;
        iso?: number;
        gpsLat?: number;
        gpsLng?: number;
      };
    };

    if (!imageId) {
      return NextResponse.json(
        { error: "imageId is required" },
        { status: 400 }
      );
    }
    imageIdForReport = imageId;

    // Look up the row so we know whether a thumbnail already exists (proxy path)
    // or still needs generating (direct >4MB path), and where the original is.
    // The events!inner join is the ownership check — see auth note above.
    const { data: image, error: fetchError } = await supabase
      .from("images")
      .select("r2_key, event_id, filename, thumbnail_generated, media_type, events!event_id!inner(user_id)")
      .eq("id", imageId)
      .eq("events.user_id", user!.id)
      .single();

    if (fetchError || !image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Update image with EXIF data and mark as complete
    const updateData: Record<string, unknown> = {
      processing_status: "complete",
    };

    if (width) updateData.width = width;
    if (height) updateData.height = height;

    /**
     * Camera metadata is written SEPARATELY from the display fields.
     *
     * These used to share one update, which means a single value Postgres
     * would not take failed the whole write and stranded the row at `pending`
     * with no thumbnail — a ghost tile whose bytes are safely in R2 and which
     * nothing points at. That is not hypothetical: a GPS DMS tuple against the
     * double-precision `gps_lat` column did exactly this to 69 photographs
     * during the Perkin Elmer ingest (2026-08-13).
     *
     * EXIF is a decoration on a photograph that is already uploaded and
     * already complete. It must never be able to break it — the same rule the
     * dashboard follows when an enrichment leg fails.
     */
    const exifData: Record<string, unknown> = {};
    if (exif) {
      if (exif.takenAt) exifData.taken_at = exif.takenAt;
      if (exif.cameraMake) exifData.camera_make = exif.cameraMake;
      if (exif.cameraModel) exifData.camera_model = exif.cameraModel;
      if (exif.lens) exifData.lens = exif.lens;
      if (exif.focalLength) exifData.focal_length = exif.focalLength;
      if (exif.aperture) exifData.aperture = exif.aperture;
      if (exif.shutterSpeed) exifData.shutter_speed = exif.shutterSpeed;
      if (exif.iso) exifData.iso = exif.iso;
      if (exif.gpsLat != null) exifData.gps_lat = exif.gpsLat;
      if (exif.gpsLng != null) exifData.gps_lng = exif.gpsLng;
    }

    /** Best-effort, reported, never fatal. The photo is already complete. */
    const storeExif = async () => {
      if (!Object.keys(exifData).length) return;
      const { error: exifErr } = await supabase
        .from("images")
        .update(exifData)
        .eq("id", imageId);
      if (exifErr) {
        const { reportSystemError } = await import("@/lib/monitoring/report");
        await reportSystemError("upload.complete.exif", exifErr, {
          imageId,
          note: "photo is complete and visible; camera metadata not stored",
        });
      }
    };

    // Videos: the binary is safely in R2 (that's "complete" — display never
    // gates on processing_status), but posters/metadata come from the ffmpeg
    // pipeline, which runs async via Inngest (a 500MB probe + remux has no
    // place inside an upload request). It sets thumbnail_generated and syncs
    // site publication when it finishes.
    if (image.media_type === "video") {
      const { error: updateError } = await supabase
        .from("images")
        .update(updateData)
        .eq("id", imageId);
      if (updateError) throw updateError;
      await storeExif();

      try {
        await inngest.send({
          name: "video/uploaded",
          data: { imageId, eventId: image.event_id, r2Key: image.r2_key },
        });
      } catch (sendErr) {
        // The retry path: /api/images/[id]/regenerate-thumbnail re-queues
        // this same event when the grid meets a posterless video.
        console.error(`Video pipeline dispatch failed for ${imageId}:`, sendErr);
        await reportSystemError("upload.video-dispatch", sendErr, { imageId });
      }

      return NextResponse.json({ success: true, imageId });
    }

    // Give this event's photos face-based focal points. Debounced 5 minutes
    // per event inside the job, so a long upload session triggers ONE sweep
    // after it settles rather than one per photo. Fire-and-forget: an upload
    // must never fail because a nicety didn't dispatch.
    inngest
      .send({ name: "focal/auto.suggest", data: { eventId: image.event_id } })
      .catch((err) => console.error("auto-focal dispatch failed:", err));

    // AI indexing rides the same settlement pattern (15m debounce per event,
    // and the job re-checks for pending uploads before running). Also
    // fire-and-forget — indexing must never touch the upload path.
    inngest
      .send({ name: "ai/index.requested", data: { eventId: image.event_id } })
      .catch((err) => console.error("ai-index dispatch failed:", err));

    // Direct (>4MB) uploads never hit the server, so they have no thumbnail yet.
    // Generate it here from the R2 original — display gates on thumbnail_generated,
    // so without this a large upload would be invisible in the gallery. Proxy
    // uploads (≤4MB) already set thumbnail_generated, so we skip them.
    // Best-effort: the original is safe regardless, and the grid self-heals.
    if (!image.thumbnail_generated && image.r2_key) {
      try {
        const result = await generateThumbnails(
          image.r2_key,
          image.event_id,
          image.filename
        );
        updateData.thumbnail_generated = true;
        updateData.thumb_bytes = result.thumbBytes;
        // Backfill real pixel dimensions if the client didn't supply them.
        if (!width && result.width) updateData.width = result.width;
        if (!height && result.height) updateData.height = result.height;
        if (result.dominantColor) updateData.dominant_color = result.dominantColor;
      } catch (thumbErr) {
        console.error(`Thumbnail generation failed for ${imageId}:`, thumbErr);
        await reportSystemError("upload.thumbnail-complete", thumbErr, {
          imageId,
          eventId: image.event_id,
          r2Key: image.r2_key,
        });
      }
    }

    const { error: updateError } = await supabase
      .from("images")
      .update(updateData)
      .eq("id", imageId);

    if (updateError) throw updateError;
    await storeExif();

    // Direct uploads into a website section (TDP Website gallery) publish once
    // their thumbnails exist — that's now. No-op otherwise; non-fatal because
    // any later membership change re-syncs.
    if (updateData.thumbnail_generated) {
      try {
        await syncSitePublication(supabase, [imageId]);
      } catch (syncErr) {
        console.error(`Site publication sync failed for ${imageId}:`, syncErr);
      }
    }

    return NextResponse.json({ success: true, imageId });
  } catch (error) {
    console.error("Upload complete error:", error);
    await reportSystemError("upload.complete", error, { imageId: imageIdForReport });
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}
