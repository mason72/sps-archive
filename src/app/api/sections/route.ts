import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { JOB_KEY_PREFIX, jobSlugFromName } from "@/lib/site/jobs";

/**
 * GET /api/sections?eventId=xxx
 * List all sections for an event, ordered by sort_order.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const eventId = request.nextUrl.searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

    // Verify event ownership
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: sections, error } = await supabase
      .from("sections")
      .select("id, name, description, is_auto, sort_order, filter_query")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    // Get image counts per section
    const enriched = await Promise.all(
      (sections || []).map(async (section) => {
        const { count } = await supabase
          .from("section_images")
          .select("*", { count: "exact", head: true })
          .eq("section_id", section.id);

        return {
          id: section.id,
          name: section.name,
          description: section.description,
          isAuto: section.is_auto,
          sortOrder: section.sort_order,
          filterQuery: section.filter_query,
          imageCount: count || 0,
        };
      })
    );

    return NextResponse.json({ sections: enriched });
  } catch (error) {
    console.error("List sections error:", error);
    return NextResponse.json({ error: "Failed to list sections" }, { status: 500 });
  }
}

/**
 * POST /api/sections
 * Create a new manual section for an event.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, name, description } = body as {
      eventId: string;
      name: string;
      description?: string;
    };

    if (!eventId || !name) {
      return NextResponse.json(
        { error: "eventId and name are required" },
        { status: 400 }
      );
    }

    // Verify event ownership
    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // In the TDP Work gallery every section IS a job: stamp a frozen
    // site_scene_key ("job/<slug>", derived from the name once, unique-
    // suffixed on collision). The job/ namespace is what plugs the section
    // into the public lane — publication, revalidate webhook, focal tool.
    let siteSceneKey: string | null = null;
    const isWorkGallery =
      (event.settings as Record<string, unknown> | null)?.work === true;
    if (isWorkGallery) {
      const base = jobSlugFromName(name);
      const { data: taken } = await supabase
        .from("sections")
        .select("site_scene_key")
        .like("site_scene_key", `${JOB_KEY_PREFIX}${base}%`);
      const existing = new Set((taken ?? []).map((s) => s.site_scene_key));
      let slug = base;
      for (let n = 2; existing.has(`${JOB_KEY_PREFIX}${slug}`); n++) {
        slug = `${base}-${n}`;
      }
      siteSceneKey = `${JOB_KEY_PREFIX}${slug}`;
    }

    // Append the new section at the END (max existing sort_order + 1) so the
    // order stays stable — creating a section never reshuffles existing ones,
    // and it shows up where the user expects: at the bottom of the list.
    const { data: lastSection } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSortOrder = (lastSection?.sort_order ?? -1) + 1;

    const { data: section, error } = await supabase
      .from("sections")
      .insert({
        event_id: eventId,
        name,
        description: description || null,
        is_auto: false,
        sort_order: nextSortOrder,
        site_scene_key: siteSceneKey,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      section: {
        id: section.id,
        name: section.name,
        description: section.description,
        isAuto: section.is_auto,
        sortOrder: section.sort_order,
        imageCount: 0,
        siteSceneKey: section.site_scene_key ?? null,
        jobMeta: section.job_meta ?? null,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Create section error:", error);
    return NextResponse.json({ error: "Failed to create section" }, { status: 500 });
  }
}
