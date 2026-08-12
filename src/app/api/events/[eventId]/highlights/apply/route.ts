import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { invalidateDirectionCache } from "@/lib/highlights/direction";
import { MAX_HIGHLIGHTS } from "@/lib/highlights/limits";

/**
 * POST /api/events/[eventId]/highlights/apply
 *
 * The ONE write path for an accepted Highlights set. Replaces the section's
 * membership with the accepted picks, in the order they were reviewed.
 *
 * Replacement, not append: the review screen already showed exactly what the
 * section will contain, so anything else would contradict the preview the
 * photographer just approved. The section is `is_auto: false`, so nothing
 * automatic ever reaches it — only this route, only on an explicit accept.
 *
 * Accepting also invalidates the cached direction: these picks are training
 * data for the next event, which is the whole "learns your eye" premise.
 *
 * Body: { picks: { momentId: string, imageId: string }[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: event, error: evErr } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      picks?: { momentId?: string; imageId?: string }[];
    };
    const imageIds = (body.picks ?? [])
      .map((p) => p?.imageId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (!imageIds.length) {
      return NextResponse.json({ error: "No picks supplied" }, { status: 400 });
    }
    if (imageIds.length > MAX_HIGHLIGHTS) {
      return NextResponse.json(
        { error: `At most ${MAX_HIGHLIGHTS} highlights` },
        { status: 400 }
      );
    }

    // Every accepted image must belong to THIS event. Without this an id from
    // another photographer's event would be written into the section.
    const { data: owned, error: ownErr } = await supabase
      .from("images")
      .select("id")
      .eq("event_id", eventId)
      .in("id", imageIds);
    if (ownErr) throw ownErr;
    const ownedIds = new Set((owned ?? []).map((r) => r.id as string));
    const accepted = imageIds.filter((id) => ownedIds.has(id));
    if (accepted.length !== imageIds.length) {
      return NextResponse.json(
        { error: "Some picks are not part of this event" },
        { status: 400 }
      );
    }

    const { data: section, error: secErr } = await supabase
      .from("sections")
      .select("id, locked")
      .eq("event_id", eventId)
      .eq("name", "Highlights")
      .maybeSingle();
    if (secErr) throw secErr;
    if (!section) {
      return NextResponse.json(
        { error: "This event has no Highlights section" },
        { status: 404 }
      );
    }
    if (section.locked) {
      return NextResponse.json(
        { error: "Highlights is locked" },
        { status: 409 }
      );
    }

    const { error: delErr } = await supabase
      .from("section_images")
      .delete()
      .eq("section_id", section.id);
    if (delErr) throw delErr;

    const rows = accepted.map((imageId, i) => ({
      section_id: section.id,
      image_id: imageId,
      sort_order: i + 1,
    }));
    const { error: insErr } = await supabase.from("section_images").insert(rows);
    if (insErr) throw insErr;

    invalidateDirectionCache(user.id);

    return NextResponse.json({ applied: rows.length, sectionId: section.id });
  } catch (err) {
    await reportSystemError("highlights-apply", err, { eventId });
    return NextResponse.json(
      { error: "Could not save highlights" },
      { status: 500 }
    );
  }
}
