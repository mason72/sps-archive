import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { ownsCrew } from "@/lib/crew-faces/store";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/crew/[crewId]/photos — every archive photo this crew member is IN,
 * grouped by event: the crew spotlight's data.
 *
 * Crew have no filename identities (Mason: "why aren't people like Joey or
 * Justin here? They have far more images than me" — their names appear in
 * ZERO filenames), so their photos are reachable only through crew_persons
 * links: the union of their linked clusters' images. Every tray confirm
 * grows this directly.
 *
 * Intel-gated like every crew route — which galleries a crew member appears
 * in is crew data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ crewId: string }> }
) {
  const { crewId } = await params;
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    if (!(await ownsCrew(supabase, user!.id, crewId))) {
      return NextResponse.json({ error: "Not on your roster." }, { status: 404 });
    }

    const { data: crew } = await supabase
      .from("crew")
      .select("display_name")
      .eq("id", crewId)
      .maybeSingle();

    // Their linked clusters (the identity), each carrying its event.
    const { data: links, error: linkErr } = await supabase
      .from("crew_persons")
      // persons→events is a single FK (event_id) — no hint needed; the
      // ambiguity trap is images↔events, which this path never traverses.
      .select("person_id, persons!inner(id, event_id, events!inner(id, name, event_date, user_id))")
      .eq("user_id", user!.id)
      .eq("crew_id", crewId);
    if (linkErr) throw linkErr;

    type EventInfo = { id: string; name: string; event_date: string | null };
    const clusterEvent = new Map<string, EventInfo>();
    for (const l of links ?? []) {
      const person = l.persons as unknown as {
        id: string;
        events: EventInfo & { user_id: string };
      };
      if (person.events.user_id !== user!.id) continue;
      clusterEvent.set(l.person_id, {
        id: person.events.id,
        name: person.events.name,
        event_date: person.events.event_date,
      });
    }

    // Image ids per cluster — their faces know which frames they're in.
    type Img = { id: string; filename: string; r2Key: string; score: number };
    const byEvent = new Map<string, { event: EventInfo; clusterId: string; images: Map<string, Img> }>();
    for (const [personId, event] of clusterEvent) {
      const group =
        byEvent.get(event.id) ??
        { event, clusterId: personId, images: new Map<string, Img>() };
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("faces")
          .select("image_id, images!inner(id, original_filename, r2_key, aesthetic_score, processing_status)")
          .eq("person_id", personId)
          .order("id")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const f of data ?? []) {
          const img = f.images as unknown as {
            id: string;
            original_filename: string;
            r2_key: string;
            aesthetic_score: number | null;
            processing_status: string;
          };
          if (img.processing_status !== "complete") continue;
          group.images.set(img.id, {
            id: img.id,
            filename: img.original_filename,
            r2Key: img.r2_key,
            score: img.aesthetic_score ?? 0,
          });
        }
        if (!data || data.length < 1000) break;
      }
      byEvent.set(event.id, group);
    }

    // Newest shoot first; best frames first inside each. Payload cap per
    // event, with the TRUE count stated — a silent cap reads as "that's all
    // there is" (the no-silent-caps rule).
    const PER_EVENT_CAP = 80;
    const events = await Promise.all(
      [...byEvent.values()]
        .sort((a, b) => (b.event.event_date ?? "").localeCompare(a.event.event_date ?? ""))
        .map(async (g) => {
          const all = [...g.images.values()].sort((a, b) => b.score - a.score);
          const shown = all.slice(0, PER_EVENT_CAP);
          return {
            eventId: g.event.id,
            eventName: g.event.name,
            eventDate: g.event.event_date,
            clusterId: g.clusterId,
            imageCount: all.length,
            images: await Promise.all(
              shown.map(async (i) => ({
                id: i.id,
                filename: i.filename,
                thumbnailUrl: await getPresignedDownloadUrl(getThumbnailKey(i.r2Key), 14400),
              }))
            ),
          };
        })
    );

    return NextResponse.json({
      name: crew?.display_name ?? "",
      imageCount: events.reduce((n, e) => n + e.imageCount, 0),
      events,
    });
  } catch (err) {
    await reportSystemError("crew.photos", err, { crewId });
    return NextResponse.json({ error: "Could not load their photos" }, { status: 500 });
  }
}
