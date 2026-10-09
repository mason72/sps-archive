import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { uploadToR2, deleteFromR2 } from "@/lib/r2/client";
import { CLIENT_LOGO_KEY_PREFIX, readRecapSettings } from "@/lib/recap/payload";
import type { Json } from "@/lib/supabase/database.types";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/**
 * PUT    /api/events/[eventId]/recap/logo   (body: the image; header: its type)
 * DELETE /api/events/[eventId]/recap/logo
 *
 * The client's logo for the recap page and the paste-ready cards. Stored under
 * the event in the PRIVATE bucket and presigned on read, like the
 * photographer's own logo. The recap shows an "Add your logo" slot until one
 * exists: a sponsor's mark appears only because the photographer or the
 * client put it there, never because the archive guessed.
 *
 * Owner-only; the service client needs the ownership filter (GOTCHAS).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { eventId } = await params;

    const contentType = request.headers.get("content-type") || "";
    const ext = ALLOWED_TYPES[contentType];
    if (!ext) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPEG, SVG, WebP." },
        { status: 400 }
      );
    }
    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 2MB." }, { status: 400 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const current = readRecapSettings(event.settings);
    const key = `${CLIENT_LOGO_KEY_PREFIX}${eventId}/client-logo-${Date.now()}.${ext}`;
    await uploadToR2(key, buffer, contentType);

    const settings = (event.settings ?? {}) as Record<string, unknown>;
    const recap = ((settings.recap ?? {}) as Record<string, unknown>);
    const { error: updateError } = await supabase
      .from("events")
      .update({ settings: { ...settings, recap: { ...recap, clientLogoKey: key } } as unknown as Json })
      .eq("id", eventId)
      .eq("user_id", user!.id);
    if (updateError) {
      try { await deleteFromR2(key); } catch { /* best effort */ }
      return NextResponse.json({ error: "Failed to save logo" }, { status: 500 });
    }

    if (current.clientLogoKey) {
      try { await deleteFromR2(current.clientLogoKey); } catch { /* old file, non-critical */ }
    }
    return NextResponse.json({ logoKey: key });
  } catch (error) {
    console.error("Recap logo upload error:", error);
    return NextResponse.json({ error: "Failed to upload logo" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { eventId } = await params;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const current = readRecapSettings(event.settings);
    const settings = (event.settings ?? {}) as Record<string, unknown>;
    const recap = { ...((settings.recap ?? {}) as Record<string, unknown>) };
    delete recap.clientLogoKey;
    const { error: updateError } = await supabase
      .from("events")
      .update({ settings: { ...settings, recap } as unknown as Json })
      .eq("id", eventId)
      .eq("user_id", user!.id);
    if (updateError) return NextResponse.json({ error: "Failed to remove logo" }, { status: 500 });

    if (current.clientLogoKey) {
      try { await deleteFromR2(current.clientLogoKey); } catch { /* best effort */ }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Recap logo delete error:", error);
    return NextResponse.json({ error: "Failed to remove logo" }, { status: 500 });
  }
}
