import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/** GET /api/events — List all events */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const supabase = createServiceClient();

  const { data, error, count } = await supabase
    .from("events")
    .select("*, images(count)", { count: "exact" })
    .order("event_date", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

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
    const body = await request.json();
    const { name, description, eventDate, eventType } = body as {
      name: string;
      description?: string;
      eventDate?: string;
      eventType?: string;
    };

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

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
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (error) {
    console.error("Create event error:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
