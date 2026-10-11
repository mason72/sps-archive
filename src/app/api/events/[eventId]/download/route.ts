import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import archiver from "archiver";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  selectOwnerImages,
  SYNC_MAX_COUNT,
  SYNC_MAX_BYTES,
} from "@/lib/gallery/download-core";
import {
  appendImagesToArchive,
  missingFilesManifest,
} from "@/lib/zip/append-images";

/**
 * GET /api/events/[eventId]/download?images=<id,…>&name=<label>[&check=1]
 *
 * The editor's "Download" for a selection, as ONE ZIP — the same archive the
 * weblink streams for a guest's picks (Justin, 2026-10-11: the editor fired a
 * file per photo, the weblink made a ZIP). Owner-authed: `getAuthUser` plus
 * the `events.user_id` filter inside `selectOwnerImages`.
 *
 * Same ceiling as the gallery route (SYNC_MAX_COUNT / SYNC_MAX_BYTES): under
 * it the lambda streams; over it this answers 413 and says so, because the
 * background builder is keyed to a SHARE (`zip_jobs.share_id`) and the whole
 * gallery already has a ZIP on the share page. `check=1` answers the same
 * decision as JSON without streaming, so the editor can show the limit as a
 * toast instead of navigating into an error body.
 */
export const maxDuration = 800;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { eventId } = await params;
  const sp = request.nextUrl.searchParams;
  const ids = (sp.get("images") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const label = sp.get("name");

  const selection = await selectOwnerImages(supabase, user.id, eventId, ids, label);
  if (!selection.ok) {
    return NextResponse.json({ error: selection.message }, { status: selection.status });
  }
  const { images, zipFilename, totalBytes } = selection;

  const tooLarge = images.length > SYNC_MAX_COUNT || totalBytes > SYNC_MAX_BYTES;
  if (sp.get("check")) {
    return NextResponse.json({
      ok: !tooLarge,
      imageCount: images.length,
      totalBytes,
      maxCount: SYNC_MAX_COUNT,
      maxBytes: SYNC_MAX_BYTES,
      zipFilename,
    });
  }
  if (tooLarge) {
    return NextResponse.json(
      {
        error: `Pick up to ${SYNC_MAX_COUNT} photos (${Math.round(SYNC_MAX_BYTES / 1024 / 1024)} MB) per ZIP`,
      },
      { status: 413 }
    );
  }

  // Mirrors the gallery route: store (photos are already compressed), a
  // detached producer, a manifest for anything R2 would not hand over.
  const archive = archiver("zip", { store: true });
  archive.on("error", (err: Error) => {
    console.error("Archive error:", err);
  });

  (async () => {
    try {
      const failed = await appendImagesToArchive(archive, images, new Map());
      if (archive.destroyed) return;
      if (failed.length > 0) {
        archive.append(missingFilesManifest(failed, images.length), {
          name: "_MISSING_FILES.txt",
        });
        void reportSystemError(
          "editor.download",
          `${failed.length}/${images.length} images failed to fetch`,
          { eventId, userId: user.id }
        );
      }
      await archive.finalize();
    } catch (err) {
      if (archive.destroyed) {
        console.warn("ZIP stream closed early (client canceled)");
        return;
      }
      console.error("ZIP streaming error:", err);
      void reportSystemError("editor.download", err, { eventId, userId: user.id });
      try {
        await archive.finalize();
      } catch {
        archive.abort();
      }
    }
  })();

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}
