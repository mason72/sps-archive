import { NextRequest, NextResponse } from "next/server";
import { authenticateSPSRequest } from "@/lib/sps-integration/auth";
import { importFromSPS } from "@/lib/sps-integration/import";
import type { SPSEventImport } from "@/lib/sps-integration/types";

/**
 * POST /api/sps/import
 *
 * Receives an event + image metadata from SimplePhotoShare.
 * Creates Archive records (zero-copy — same R2 bucket) and
 * triggers the AI processing pipeline via Inngest.
 *
 * Auth: Supabase JWT (Authorization: Bearer) or API key (X-SPS-Key)
 *
 * Request body: SPSEventImport
 * Response: { eventId: string, message: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Parse body first (needed for userId extraction in API key auth)
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // Authenticate
    const auth = await authenticateSPSRequest(request, body.userId);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    // Validate required fields
    const data = body as SPSEventImport & { userId?: string };
    if (!data.spsEventId || !data.name || !data.images?.length) {
      return NextResponse.json(
        {
          error: "Missing required fields: spsEventId, name, and images[] are required",
          received: {
            spsEventId: !!data.spsEventId,
            name: !!data.name,
            imageCount: data.images?.length || 0,
          },
        },
        { status: 400 }
      );
    }

    // Validate each image has required fields
    for (let i = 0; i < data.images.length; i++) {
      const img = data.images[i];
      if (!img.spsImageId || !img.r2Key || !img.originalFilename || !img.mimeType) {
        return NextResponse.json(
          {
            error: `Image at index ${i} missing required fields (spsImageId, r2Key, originalFilename, mimeType)`,
          },
          { status: 400 }
        );
      }
    }

    // Import the event
    const result = await importFromSPS(data, auth.userId);

    return NextResponse.json({
      eventId: result.eventId,
      imageCount: data.images.length,
      message: `Event imported successfully. ${data.images.length} images queued for AI processing.`,
    });
  } catch (error) {
    console.error("SPS import error:", error);

    const message =
      error instanceof Error ? error.message : "Import failed";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
