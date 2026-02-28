import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { uploadToR2 } from "@/lib/r2/client";

// Allow large file uploads (up to 100MB)
export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes

/**
 * PUT /api/upload/[imageId]
 *
 * Receives raw file binary and proxies it to R2.
 * Avoids CORS issues with direct browser-to-R2 uploads.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;

    // Look up the image record to get the r2_key
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("id, r2_key, mime_type")
      .eq("id", imageId)
      .single();

    if (imageError || !image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Read the file body
    const body = await request.arrayBuffer();
    const contentType =
      request.headers.get("content-type") || image.mime_type || "image/jpeg";

    // Upload to R2
    await uploadToR2(image.r2_key, Buffer.from(body), contentType);

    return NextResponse.json({ success: true, imageId });
  } catch (error) {
    console.error("File upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
