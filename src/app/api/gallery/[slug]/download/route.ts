import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import {
  gallerySessionCookieName,
  verifyGallerySession,
} from "@/lib/shares/session";
import { galleryPinCookieName, verifyGalleryPin } from "@/lib/shares/pin-session";
import archiver from "archiver";
import { logActivity } from "@/lib/analytics/log";

// Force the Node runtime — archiver needs streams + Buffer.
export const runtime = "nodejs";

/**
 * Disambiguate duplicate filenames inside a ZIP. Some events have the
 * same camera file numbers across batches; without this both arrive as
 * "IMG_4532.jpg" and the second one silently overwrites the first.
 */
function uniqueFilename(name: string, seen: Set<string>): string {
  if (!seen.has(name)) {
    seen.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? "" : name.slice(dot);
  let i = 2;
  while (seen.has(`${stem} (${i})${ext}`)) i++;
  const candidate = `${stem} (${i})${ext}`;
  seen.add(candidate);
  return candidate;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const supabase = createServiceClient();

  // 1. Resolve share
  const { data: share, error } = await supabase
    .from("shares")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (error || !share) {
    return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
  }

  // Check expiration
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired" }, { status: 410 });
  }

  // Check download allowed
  if (!share.allow_download) {
    return NextResponse.json(
      { error: "Downloads not allowed" },
      { status: 403 }
    );
  }

  // Password protection — verify HMAC-signed session cookie
  if (share.password_hash) {
    const cookie = request.cookies.get(gallerySessionCookieName(slug));
    if (!verifyGallerySession(cookie?.value, slug, share.id)) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
  }

  // PIN protection for bulk download — read from cookie set by verify-pin.
  // Previously the PIN arrived as ?pin=1234 in the URL, which leaks into
  // browser history, server access logs, and the Referer header.
  if (share.require_pin_bulk && share.download_pin) {
    const pinCookie = request.cookies.get(galleryPinCookieName(slug));
    if (!verifyGalleryPin(pinCookie?.value, slug, share.id)) {
      return NextResponse.json(
        { error: "PIN required" },
        { status: 403 }
      );
    }
  }

  // 2. Fetch images, scoped to the share type. Previously the download
  // returned the full event for section/person shares.
  const allowedImageIds = await resolveAllowedImageIds(supabase, share);
  if (allowedImageIds !== null && allowedImageIds.length === 0) {
    return NextResponse.json({ error: "No images available" }, { status: 404 });
  }

  let imagesQuery = supabase
    .from("images")
    .select("id, r2_key, original_filename")
    .eq("event_id", share.event_id)
    .neq("processing_status", "failed");

  if (allowedImageIds !== null) {
    imagesQuery = imagesQuery.in("id", allowedImageIds);
  }

  const { data: images } = await imagesQuery.order("created_at", {
    ascending: true,
  });

  if (!images || images.length === 0) {
    return NextResponse.json(
      { error: "No images available" },
      { status: 404 }
    );
  }

  // 3. Fetch event name for ZIP filename
  const { data: event } = await supabase
    .from("events")
    .select("name, user_id")
    .eq("id", share.event_id)
    .single();

  const zipFilename = `${(event?.name || "gallery")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")}.zip`;

  // 4. Stream ZIP. We append the raw R2 fetch body as a Node stream so
  // archiver can drain it without ever buffering a full image in memory
  // (the previous .arrayBuffer() pattern peaked at the size of the
  // current photo per iteration and OOM'd on very large originals).
  const archive = archiver("zip", { zlib: { level: 1 } });

  archive.on("warning", (err: Error) => {
    // ENOENT etc. — log but don't abort. We'd rather ship a partial
    // archive than hand the client nothing.
    console.warn("Archive warning:", err);
  });
  archive.on("error", (err: Error) => {
    console.error("Archive error:", err);
  });

  // Disambiguate filename collisions (cameras reset their counter; two
  // batches in one event can both produce IMG_4532.jpg).
  const seen = new Set<string>();

  // Fetch + append sequentially. Parallel egress hammers R2 and can
  // re-order frames in the archive output.
  (async () => {
    try {
      for (const img of images) {
        const url = await getPresignedDownloadUrl(img.r2_key, 3600);
        if (!url) continue;

        const response = await fetch(url);
        if (!response.ok || !response.body) {
          console.warn(
            `[zip] skipping ${img.id}: R2 fetch status ${response.status}`
          );
          continue;
        }

        const name = uniqueFilename(img.original_filename, seen);
        const nodeStream = Readable.fromWeb(
          response.body as Parameters<typeof Readable.fromWeb>[0]
        );
        archive.append(nodeStream, { name });
      }
      await archive.finalize();
    } catch (err) {
      console.error("ZIP streaming error:", err);
      archive.abort();
    }
  })();

  // Log gallery download (fire and forget)
  if (event?.user_id) {
    logActivity({
      userId: event.user_id,
      action: "gallery_download",
      eventId: share.event_id,
      shareId: share.id,
      metadata: { imageCount: images.length },
    });
  }

  // archiver is itself a Node Readable; hand it directly to the Response.
  // Cast is necessary because the Web ReadableStream / Node Readable
  // duck-typing isn't tight enough for TS but works at runtime.
  return new Response(archive as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipFilename}"`,
    },
  });
}

interface ShareSummary {
  event_id: string;
  share_type: string | null;
  image_ids: string[] | null;
  section_id: string | null;
  person_id: string | null;
}

/** Mirrors the resolver in api/gallery/[slug]/route.ts. Returns null = "all". */
async function resolveAllowedImageIds(
  supabase: ReturnType<typeof createServiceClient>,
  share: ShareSummary
): Promise<string[] | null> {
  switch (share.share_type) {
    case "full":
    case null:
    case undefined:
      return null;
    case "selection":
      return share.image_ids ?? [];
    case "section": {
      if (!share.section_id) return [];
      const { data } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", share.section_id);
      return (data ?? []).map((r) => r.image_id);
    }
    case "person": {
      if (!share.person_id) return [];
      const { data } = await supabase
        .from("faces")
        .select("image_id")
        .eq("person_id", share.person_id);
      return Array.from(new Set((data ?? []).map((r) => r.image_id)));
    }
    default:
      return [];
  }
}
