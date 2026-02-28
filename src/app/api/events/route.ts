import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import type { Json } from "@/lib/supabase/database.types";

/** GET /api/events — List all events for the authenticated user */
export async function GET(request: NextRequest) {
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) {
    console.error("GET /api/events: auth failed, returning 401");
    return authError;
  }

  console.log("GET /api/events: user =", user!.id, user!.email);

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const { data, error, count } = await supabase
    .from("events")
    .select("*, images!images_event_id_fkey(count)", { count: "exact" })
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("GET /api/events: query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log("GET /api/events: returning", data?.length, "events out of", count);

  return NextResponse.json({
    events: data,
    total: count,
    limit,
    offset,
  });
}

/** POST /api/events — Create a new event */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { name, description, eventDate, eventType, settings, sections } = body as {
      name: string;
      description?: string;
      eventDate?: string;
      eventType?: string;
      settings?: Record<string, unknown>;
      sections?: { name: string; description?: string; sortOrder: number }[];
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      + "-" + Date.now().toString(36);

    const { data, error } = await supabase
      .from("events")
      .insert({
        name,
        slug,
        description: description || null,
        event_date: eventDate || null,
        event_type: eventType || null,
        settings: (settings || {}) as Json,
        user_id: user!.id,
      })
      .select()
      .single();

    if (error) throw error;

    // Create sections from template if provided
    if (sections && sections.length > 0 && data) {
      const sectionInserts = sections.map((s) => ({
        event_id: data.id,
        name: s.name,
        description: s.description || null,
        sort_order: s.sortOrder,
        is_auto: false,
      }));

      await supabase.from("sections").insert(sectionInserts);
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error) {
    console.error("Create event error:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
