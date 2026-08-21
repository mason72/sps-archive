import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import archiver from "archiver";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/analytics/log";
import { clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  authorizeShareDownload,
  selectDownloadImages,
  scopeFrom,
  SYNC_MAX_COUNT,
  SYNC_MAX_BYTES,
} from "@/lib/gallery/download-core";
import {
  appendImagesToArchive,
  missingFilesManifest,
} from "@/lib/zip/append-images";

/**
 * GET /api/gallery/[slug]/download — synchronous streaming ZIP for SMALL
 * downloads only (≤ SYNC_MAX_COUNT images and ≤ SYNC_MAX_BYTES).
 *
 * Anything larger is refused with 413 { useJob: true }: the platform's
 * response transport buffers producer-vs-client speed differences in lambda
 * memory without backpressure, and a 4GB gallery OOM'd the instance live
 * (2026-07-02). Under the cap, even a fully-buffered ZIP fits comfortably in
 * function memory. Large downloads go through /download/prepare → background
 * build → presigned R2 URL. Clients normally never see the 413 — the prepare
 * endpoint routes them before they get here.
 *
 * Scope params: ?favorites=true | ?section=<id> | ?images=<id,...>&name=<label>
 * PIN shares: ?dt=<token from verify-pin> (or legacy ?pin=).
 */
export const maxDuration = 800;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServiceClient();
  const sp = request.nextUrl.searchParams;

  const scope = scopeFrom({
    favorites: sp.get("favorites"),
    section: sp.get("section"),
    images: sp.get("images"),
    name: sp.get("name"),
  });
  const auth = await authorizeShareDownload(supabase, slug, {
    cookieShareId: request.cookies.get(`gallery_auth_${slug}`)?.value ?? null,
    downloadToken: sp.get("dt"),
    pin: sp.get("pin"),
    ip: clientIp(request),
    scope,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { share } = auth;


  const selection = await selectDownloadImages(supabase, share, scope);
  if (!selection.ok) {
    return NextResponse.json(
      { error: selection.message },
      { status: selection.status }
    );
  }
  const { images, sectionsByImage, zipFilename, eventUserId } = selection;

  if (
    images.length > SYNC_MAX_COUNT ||
    selection.totalBytes > SYNC_MAX_BYTES
  ) {
    return NextResponse.json(
      {
        error: "This download is too large to stream directly",
        useJob: true,
      },
      { status: 413 }
    );
  }

  // Stream the ZIP. store:true — photos are already compressed; deflate just
  // burns CPU for ~0% size win. Readable.toWeb gives backpressure from the
  // response consumer (within the platform's limits — hence the size gate).
  const archive = archiver("zip", { store: true });
  archive.on("error", (err: Error) => {
    console.error("Archive error:", err);
  });

  // Producer runs detached so the response can start immediately.
  (async () => {
    try {
      const failed = await appendImagesToArchive(
        archive,
        images,
        sectionsByImage
      );
      if (archive.destroyed) return; // client went away mid-stream

      // Surface any drops: a manifest inside the ZIP + an admin alarm. The
      // client gets a complete-as-possible, VALID archive either way.
      if (failed.length > 0) {
        archive.append(missingFilesManifest(failed, images.length), {
          name: "_MISSING_FILES.txt",
        });
        void reportSystemError(
          "gallery.download",
          `${failed.length}/${images.length} images failed to fetch`,
          { slug, shareId: share.id }
        );
      }

      await archive.finalize();
    } catch (err) {
      // A destroyed archive is a client-side cancel, not a system failure —
      // don't page the admin for someone closing their laptop mid-download.
      if (archive.destroyed) {
        console.warn("ZIP stream closed early (client canceled)");
        return;
      }
      console.error("ZIP streaming error:", err);
      void reportSystemError("gallery.download", err, {
        slug,
        shareId: share.id,
      });
      // Finalize (not abort) so the client still receives a valid ZIP of
      // whatever was appended before the error, rather than a corrupt stream.
      try {
        await archive.finalize();
      } catch {
        archive.abort();
      }
    }
  })();

  // Log gallery download (fire and forget)
  if (eventUserId) {
    logActivity({
      userId: eventUserId,
      action: "gallery_download",
      eventId: share.event_id,
      shareId: share.id,
      metadata: {
        imageCount: images.length,
        scope: scope.favorites
          ? "favorites"
          : scope.section
          ? "section"
          : scope.images?.length
          ? "selection"
          : "all",
      },
    });
  }

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}
