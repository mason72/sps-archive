import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedUploadUrl, getPresignedDownloadUrl } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};
const MAX_SIZE = 5 * 1024 * 1024; // 5MB — it's a logo, not a photo

/**
 * POST /api/events/[eventId]/cover-logo
 *
 * Presigned PUT for the per-event CLIENT logo used by mosaic/solid covers
 * (distinct from the photographer's branding logo). Deliberately NOT the
 * photo upload path: no images row, no thumbnails, no reconciler — a logo is
 * a branding asset, not a gallery photo. Fixed-ish key (one logo per event,
 * new extension replaces in place) so there's nothing to garbage-collect.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  let eventIdForReport: string | undefined;
  try {
    const { eventId } = await params;
    eventIdForReport = eventId;
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // getAuthUser returns the SERVICE client (RLS bypassed) — ownership
    // filter is mandatory (lessons #2/#14).
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .single();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { fileType, fileSize } = await request.json();
    const ext = ALLOWED_TYPES[fileType as string];
    if (!ext) {
      return NextResponse.json(
        { error: "Logo must be PNG, WebP, JPEG, or SVG" },
        { status: 400 }
      );
    }
    if (typeof fileSize !== "number" || fileSize <= 0 || fileSize > MAX_SIZE) {
      return NextResponse.json({ error: "Logo must be under 5MB" }, { status: 400 });
    }

    const logoKey = `events/${eventId}/branding/cover-logo.${ext}`;
    const uploadUrl = await getPresignedUploadUrl(logoKey, fileType);
    return NextResponse.json({ uploadUrl, logoKey });
  } catch (error) {
    await reportSystemError("cover-logo.presign", error, {
      eventId: eventIdForReport,
    });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * GET /api/events/[eventId]/cover-logo?key=…
 *
 * Presigned view URL for a previously saved cover logo (settings hold only
 * the R2 key). The prefix check pins the key to THIS event's branding folder
 * — without it this would presign arbitrary bucket keys for any signed-in
 * user (the IDOR class from lessons #2/#14, via query param instead of id).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  let eventIdForReport: string | undefined;
  try {
    const { eventId } = await params;
    eventIdForReport = eventId;
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .single();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const key = request.nextUrl.searchParams.get("key") ?? "";
    if (!key.startsWith(`events/${eventId}/branding/cover-logo.`)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const url = await getPresignedDownloadUrl(key, 3600);
    return NextResponse.json({ url });
  } catch (error) {
    await reportSystemError("cover-logo.view", error, {
      eventId: eventIdForReport,
    });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
