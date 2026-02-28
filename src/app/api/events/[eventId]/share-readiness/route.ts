import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

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
      .select("id, user_id")
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
        // Images still processing
        supabase
          .from("images")
          .select("id", { count: "exact", head: true })
          .eq("event_id", eventId)
          .neq("processing_status", "complete"),
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

    return NextResponse.json({
      imageCount: imagesResult.count ?? 0,
      processingRemaining: processingResult.count ?? 0,
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
