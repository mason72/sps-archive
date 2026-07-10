import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { enrichEvents } from "@/lib/events/enrich";
import { INTAKE_SECTION_NAME, CURATED_SECTION_NAME } from "@/lib/sections/intake";
import type { Json } from "@/lib/supabase/database.types";

/** GET /api/events — List all events for the authenticated user */
export async function GET(request: NextRequest) {
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const { data, error, count } = await supabase
    .from("events")
    .select("*, images!images_event_id_fkey(count)", { count: "exact" })
    .eq("user_id", user!.id)
    // Pinned galleries (e.g. TDP workspaces) stay above the chronological list
    .order("pinned_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("GET /api/events: query error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Enrich cover thumbnails + share slugs with a FIXED number of batched
  // queries (the old per-event fan-out was an N+1 — ~3 queries per event — that
  // made the dashboard crawl for photographers with many events).
  const events = data || [];
  const enrichment = await enrichEvents(supabase, events);
  const enriched = events.map((event) => ({
    ...event,
    ...(enrichment.get(event.id) ?? {
      coverThumbnailUrl: null,
      activeShareSlug: null,
    }),
  }));

  return NextResponse.json({
    events: enriched,
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

    // Create sections from template if provided, otherwise seed a default
    // "Highlights" section. NOTE: never name a real section "All Photos" —
    // "All Photos" is a derived view (the union of all sections), not a row.
    if (sections && sections.length > 0 && data) {
      const sectionInserts = sections.map((s) => ({
        event_id: data.id,
        name: s.name,
        description: s.description || null,
        sort_order: s.sortOrder,
        is_auto: false,
      }));

      await supabase.from("sections").insert(sectionInserts);
    } else if (data) {
      // Seed two sections: "Unsorted" (the intake — where big dumps land so
      // they never touch Highlights) at the top, then "Highlights" (reserved
      // for the curated/exported best-of). "Sort into sections" later consumes
      // Unsorted. Never name a real section "All Photos" (a derived view).
      await supabase.from("sections").insert([
        { event_id: data.id, name: INTAKE_SECTION_NAME, sort_order: 0, is_auto: false },
        { event_id: data.id, name: CURATED_SECTION_NAME, sort_order: 1, is_auto: false },
      ]);
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
