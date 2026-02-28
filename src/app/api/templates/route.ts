import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import type { Json } from "@/lib/supabase/database.types";

/** GET /api/templates — List all templates for the authenticated user */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data, error } = await supabase
      .from("event_templates")
      .select("*")
      .eq("user_id", user!.id)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ templates: data });
  } catch (error) {
    console.error("List templates error:", error);
    return NextResponse.json(
      { error: "Failed to list templates" },
      { status: 500 }
    );
  }
}

/** POST /api/templates — Create a new template (from scratch or from an existing event) */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { name, description, eventType, settings, sections, fromEventId } =
      body as {
        name: string;
        description?: string;
        eventType?: string;
        settings?: Record<string, Json>;
        sections?: { name: string; description?: string; sortOrder: number }[];
        fromEventId?: string;
      };

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    let templateSettings: Json = (settings as Json) || {};
    let templateSections: Json = (sections as Json) || [];
    let templateEventType = eventType || null;

    // Copy configuration from an existing event
    if (fromEventId) {
      const { data: event } = await supabase
        .from("events")
        .select("event_type, settings")
        .eq("id", fromEventId)
        .eq("user_id", user!.id)
        .single();

      if (!event) {
        return NextResponse.json(
          { error: "Source event not found" },
          { status: 404 }
        );
      }

      templateSettings = (event.settings as Json) || {};
      templateEventType = event.event_type || null;

      // Fetch sections from the source event
      const { data: eventSections } = await supabase
        .from("sections")
        .select("name, description, sort_order")
        .eq("event_id", fromEventId)
        .order("sort_order", { ascending: true });

      if (eventSections && eventSections.length > 0) {
        templateSections = eventSections.map((s) => ({
          name: s.name,
          description: s.description ?? undefined,
          sortOrder: s.sort_order,
        })) as unknown as Json;
      }
    }

    const { data, error } = await supabase
      .from("event_templates")
      .insert({
        user_id: user!.id,
        name,
        description: description || null,
        event_type: templateEventType,
        settings: templateSettings,
        sections: templateSections,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: data }, { status: 201 });
  } catch (error) {
    console.error("Create template error:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}
