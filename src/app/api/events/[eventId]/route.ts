import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

/**
 * GET /api/events/[eventId]
 *
 * Returns a single event with all related data:
 * - Event metadata
 * - Images (with presigned thumbnail URLs)
 * - Stacks (with nested images and person names)
 * - Sections (with image counts)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // 1. Fetch event
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    // 2. Fetch all images for this event (complete + processing)
    const { data: rawImages, error: imagesError } = await supabase
      .from("images")
      .select(
        "id, r2_key, original_filename, aesthetic_score, sharpness_score, stack_id, stack_rank, parsed_name, processing_status, width, height, created_at, taken_at"
      )
      .eq("event_id", eventId)
      .neq("processing_status", "error")
      .order("created_at", { ascending: true });

    if (imagesError) throw imagesError;

    // 3. Generate presigned download URLs for all images (batched)
    // thumbnailUrl = thumb-md (400px) for grid, originalUrl = full-res for lightbox
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const thumbKey = getThumbnailKey(img.r2_key);
        const [thumbnailUrl, originalUrl] = await Promise.all([
          getPresignedDownloadUrl(thumbKey, 14400),
          getPresignedDownloadUrl(img.r2_key, 14400),
        ]);
        return {
          id: img.id,
          r2Key: img.r2_key,
          thumbnailUrl,
          originalUrl,
          originalFilename: img.original_filename,
          aestheticScore: img.aesthetic_score,
          sharpnessScore: img.sharpness_score,
          stackId: img.stack_id,
          stackRank: img.stack_rank,
          parsedName: img.parsed_name,
          processingStatus: img.processing_status,
          width: img.width,
          height: img.height,
          createdAt: img.created_at,
          takenAt: img.taken_at,
        };
      })
    );

    // 4. Fetch stacks with person names
    const { data: rawStacks, error: stacksError } = await supabase
      .from("stacks")
      .select("id, stack_type, cover_image_id, image_count, person_id")
      .eq("event_id", eventId);

    if (stacksError) throw stacksError;

    // Look up person names for face stacks
    const personIds = (rawStacks || [])
      .map((s) => s.person_id)
      .filter(Boolean) as string[];

    let personMap: Record<string, string | null> = {};
    if (personIds.length > 0) {
      const { data: persons } = await supabase
        .from("persons")
        .select("id, name")
        .in("id", personIds);

      personMap = (persons || []).reduce(
        (acc, p) => ({ ...acc, [p.id]: p.name }),
        {} as Record<string, string | null>
      );
    }

    // Nest images within their stacks
    const stacks = (rawStacks || []).map((stack) => ({
      id: stack.id,
      stackType: stack.stack_type,
      imageCount: stack.image_count,
      personName: stack.person_id ? personMap[stack.person_id] || null : null,
      images: images
        .filter((img) => img.stackId === stack.id)
        .sort((a, b) => (a.stackRank ?? 999) - (b.stackRank ?? 999)),
    }));

    // 5. Fetch sections with image counts
    const { data: rawSections, error: sectionsError } = await supabase
      .from("sections")
      .select("id, name, is_auto, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    if (sectionsError) throw sectionsError;

    // Get image counts per section
    const sections = await Promise.all(
      (rawSections || []).map(async (section) => {
        const { count } = await supabase
          .from("section_images")
          .select("*", { count: "exact", head: true })
          .eq("section_id", section.id);

        return {
          id: section.id,
          name: section.name,
          isAuto: section.is_auto,
          sortOrder: section.sort_order,
          imageCount: count || 0,
        };
      })
    );

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        event_type: event.event_type,
        event_date: event.event_date,
        description: event.description,
        settings: event.settings || {},
        created_at: event.created_at,
      },
      images,
      stacks,
      sections,
    });
  } catch (error) {
    console.error("Get event error:", error);
    return NextResponse.json(
      { error: "Failed to load event" },
      { status: 500 }
    );
  }
}

/** PATCH /api/events/[eventId] — Update event settings */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;
    const body = await request.json();

    // Build update object
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.eventDate !== undefined) updates.event_date = body.eventDate;
    if (body.eventType !== undefined) updates.event_type = body.eventType;

    // Settings: deep merge with existing
    if (body.settings !== undefined) {
      const { data: existing } = await supabase
        .from("events")
        .select("settings")
        .eq("id", eventId)
        .single();

      const currentSettings =
        (existing?.settings as Record<string, unknown>) || {};
      updates.settings = { ...currentSettings, ...body.settings };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("events")
      .update(updates)
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ event: data });
  } catch (error) {
    console.error("Update event error:", error);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

/** DELETE /api/events/[eventId] — Delete an event and all its data */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

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

    // Delete event (cascades to images, stacks, sections, shares, favorites)
    const { error } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId)
      .eq("user_id", user!.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
