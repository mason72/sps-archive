import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { analyzeExistingEvent } from "@/lib/ai/event-analysis";
import { inngest } from "@/lib/inngest/client";

/**
 * POST /api/events/[eventId]/analyze
 *
 * Run AI analysis on an event's processed images.
 * Returns detected event type, suggested name, time gaps, and split suggestions.
 *
 * Query params:
 *   ?apply=true — auto-apply detected settings to the event
 *   ?async=true — run analysis in background via Inngest (returns immediately)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;
    const { searchParams } = new URL(request.url);
    const autoApply = searchParams.get("apply") === "true";
    const runAsync = searchParams.get("async") === "true";

    // Verify ownership
    const { data: event } = await supabase
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Async mode: trigger via Inngest and return immediately
    if (runAsync) {
      await inngest.send({
        name: "event/analyze",
        data: { eventId, autoApply },
      });

      return NextResponse.json({
        status: "queued",
        message: "Event analysis has been queued for processing",
      });
    }

    // Sync mode: run analysis immediately and return results
    const analysis = await analyzeExistingEvent(eventId);

    // Auto-apply settings if requested
    if (autoApply) {
      const updates: Record<string, unknown> = {
        event_type: analysis.detectedEventType,
      };

      const { data: existing } = await supabase
        .from("events")
        .select("settings")
        .eq("id", eventId)
        .single();

      const currentSettings =
        (existing?.settings as Record<string, unknown>) || {};
      updates.settings = {
        ...currentSettings,
        ai_detected_type: analysis.detectedEventType,
        ai_confidence: analysis.typeConfidence,
      };

      await supabase.from("events").update(updates).eq("id", eventId);
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Analyze event error:", error);
    return NextResponse.json(
      { error: "Failed to analyze event" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/events/[eventId]/analyze
 *
 * Get the last AI analysis results stored in event settings.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    const { data: event, error } = await supabase
      .from("events")
      .select("settings, event_type")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (error || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const settings = (event.settings ?? {}) as Record<string, unknown>;

    return NextResponse.json({
      eventType: event.event_type,
      aiDetectedType: settings.ai_detected_type || null,
      aiConfidence: settings.ai_confidence || null,
      templateId: settings.template_id || null,
    });
  } catch (error) {
    console.error("Get analysis error:", error);
    return NextResponse.json(
      { error: "Failed to get analysis" },
      { status: 500 }
    );
  }
}
