import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { normalizeCoverSettings, coverNeedsRaster } from "@/types/event-settings";
import { coverRasterKey } from "@/lib/cover/pool";
import { getObjectMetadata } from "@/lib/r2/client";

/**
 * GET /api/events/[eventId]/share-readiness
 *
 * Returns gallery readiness data for the pre-flight share checklist.
 * Runs all queries in parallel for fast response.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Verify event ownership
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, user_id, settings")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    if (event.user_id !== user!.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Run all readiness queries in parallel
    const [imagesResult, processingResult, profileResult, sharesResult] =
      await Promise.all([
        // Total image count
        supabase
          .from("images")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId),
        // Images not yet displayable = those still missing a thumbnail. (NOT
        // processing_status<>'complete' — that counts photos whose hidden AI
        // step failed, which are perfectly shareable, and would raise a false
        // "still processing" warning in the share checklist.)
        supabase
          .from("images")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .or("thumbnail_generated.is.null,thumbnail_generated.eq.false"),
        // Photographer profile / branding
        supabase
          .from("user_profiles")
          .select("business_name, logo_url, branding")
          .eq("user_id", user!.id)
          .single(),
        // Active shares on this event
        supabase
          .from("shares")
          .select("id, password_hash, expires_at")
          .eq("event_id", eventId)
          .eq("is_active", true),
      ]);

    // A mosaic/solid cover only exists in the email once the Inngest job has
    // COMPOSED it (pool.ts is the raster's one reader/enqueuer). Until then
    // the hero route serves a fallback frame — which reads as "my cover is
    // missing" in the composer preview (Mason hit exactly this on a fresh
    // import, 2026-08-28). Report the window so the preview can say so
    // honestly instead of silently substituting a different image.
    const cover = normalizeCoverSettings(
      ((event.settings ?? {}) as Record<string, unknown>).cover
    );
    let coverComposing = false;
    if (cover.enabled && coverNeedsRaster(cover)) {
      const meta = await getObjectMetadata(coverRasterKey(eventId)).catch(() => null);
      coverComposing = meta === null;
    }

    return NextResponse.json({
      imageCount: imagesResult.count ?? 0,
      processingRemaining: processingResult.count ?? 0,
      coverComposing,
      hasBranding: !!(
        profileResult.data?.logo_url || profileResult.data?.business_name
      ),
      hasActiveShares: (sharesResult.data?.length ?? 0) > 0,
      hasPassword: sharesResult.data?.some((s) => s.password_hash) ?? false,
      hasExpiration: sharesResult.data?.some((s) => s.expires_at) ?? false,
    });
  } catch (error) {
    console.error("Share readiness error:", error);
    return NextResponse.json(
      { error: "Failed to check share readiness" },
      { status: 500 }
    );
  }
}
