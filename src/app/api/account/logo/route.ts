import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { uploadToR2, deleteFromR2 } from "@/lib/r2/client";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

/**
 * PUT /api/account/logo
 * Upload a logo image for the user's branding.
 * Stores the R2 key (not presigned URL) in user_profiles.logo_url.
 * The account GET route generates fresh presigned URLs on demand.
 */
export async function PUT(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const contentType = request.headers.get("content-type") || "";

    // Validate content type
    const ext = ALLOWED_TYPES[contentType];
    if (!ext) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: PNG, JPEG, SVG, WebP." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await request.arrayBuffer());

    // Validate size (2MB max)
    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum 2MB." },
        { status: 400 }
      );
    }

    // Delete old logo from R2 if it exists
    const { data: existing } = await supabase
      .from("user_profiles")
      .select("logo_url")
      .eq("user_id", user!.id)
      .single();

    if (existing?.logo_url && existing.logo_url.startsWith("branding/")) {
      try {
        await deleteFromR2(existing.logo_url);
      } catch {
        // Non-critical — old file cleanup failed, continue
      }
    }

    const key = `branding/${user!.id}/logo-${Date.now()}.${ext}`;
    await uploadToR2(key, buffer, contentType);

    // Store the R2 key (not a presigned URL)
    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ logo_url: key, updated_at: new Date().toISOString() })
      .eq("user_id", user!.id);

    if (updateError) {
      // Clean up the uploaded file since DB update failed
      try { await deleteFromR2(key); } catch { /* best effort */ }
      return NextResponse.json(
        { error: "Failed to save logo" },
        { status: 500 }
      );
    }

    return NextResponse.json({ logoKey: key });
  } catch (error) {
    console.error("Logo upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload logo" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/account/logo
 * Remove the user's logo from R2 and database.
 */
export async function DELETE() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // Get current logo key to delete from R2
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("logo_url")
      .eq("user_id", user!.id)
      .single();

    if (profile?.logo_url && profile.logo_url.startsWith("branding/")) {
      try {
        await deleteFromR2(profile.logo_url);
      } catch {
        // Non-critical — R2 cleanup failed, still remove from DB
      }
    }

    const { error: updateError } = await supabase
      .from("user_profiles")
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq("user_id", user!.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to remove logo" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logo delete error:", error);
    return NextResponse.json(
      { error: "Failed to remove logo" },
      { status: 500 }
    );
  }
}
