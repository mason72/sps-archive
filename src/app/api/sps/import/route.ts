import { NextRequest, NextResponse } from "next/server";
import { authenticateSPSRequest } from "@/lib/sps-integration/auth";
import { importFromSPS } from "@/lib/sps-integration/import";
import type { SPSEventImport } from "@/lib/sps-integration/types";

/**
 * Cap per request to keep one import from fanning out unbounded work onto
 * Modal / Inngest. Five thousand images is roughly a large wedding shoot.
 */
const MAX_IMAGES_PER_IMPORT = 5000;

/**
 * R2 keys must look like `events/{uuid}/originals/{filename.ext}`. This is a
 * shape check — not full ownership verification (which would require an
 * authenticated callback into SPS to confirm the user owns the source
 * event). It blocks crude attempts to claim keys outside the expected
 * layout (e.g., other tenants' branding/, watermarks/, or arbitrary paths).
 */
const R2_KEY_PATTERN =
  /^events\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/originals\/[A-Za-z0-9._-]+$/i;

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

    if (data.images.length > MAX_IMAGES_PER_IMPORT) {
      return NextResponse.json(
        {
          error: `Too many images (${data.images.length}); maximum per import is ${MAX_IMAGES_PER_IMPORT}`,
        },
        { status: 413 }
      );
    }

    // Validate each image has required fields and a well-formed R2 key.
    // The R2 bucket is shared with SPS, so a malformed/unrelated r2Key here
    // would let the caller mint Archive metadata pointing at another tenant's
    // original. The pattern check + shared SPS auth narrows the attack
    // surface; full ownership verification requires an SPS callback (out of
    // scope for Phase 0).
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
      if (!R2_KEY_PATTERN.test(img.r2Key)) {
        return NextResponse.json(
          {
            error: `Image at index ${i} has an unexpected r2Key shape; expected events/<uuid>/originals/<filename>`,
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
