import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { buildPersonDetail } from "@/lib/people/index-people";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/people/detail?name=Jeff%20Roark
 *
 * Every photo of one person across the whole archive — the payload behind the
 * spotlight on /people. Lives at /detail rather than /[key] because
 * /api/people/[personId] is already the cluster-rename route, and a name key
 * arriving where a UUID is expected is the kind of collision that only shows
 * up in production.
 *
 * Internal, owner-scoped: `buildPersonDetail` filters events by user_id, which
 * is the boundary — getAuthUser hands back the SERVICE client.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { user, supabase, error } = await getAuthUser();
  if (error) return error;

  const name = request.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }

  // A card split by faces (face-split.ts) opens only its own events, under its
  // own card key. The ids can only NARROW the caller's events — the ownership
  // filter inside buildPersonDetail runs first.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const eventIds = (request.nextUrl.searchParams.get("events") ?? "")
    .split(",")
    .filter((id) => UUID.test(id))
    .slice(0, 100);
  // An events list that parses to nothing is a broken request, not a request
  // for everyone of that name — answering it unscoped would gather every Alex.
  if (request.nextUrl.searchParams.has("events") && eventIds.length === 0) {
    return NextResponse.json({ error: "events must be event ids" }, { status: 400 });
  }
  const cardKey = request.nextUrl.searchParams.get("key") ?? "";
  const key = /^[a-z]+(~[0-9a-f-]{36})?$/.test(cardKey) ? cardKey : undefined;

  try {
    const person = await buildPersonDetail(
      supabase,
      user!.id,
      name,
      eventIds.length ? { eventIds, key } : undefined
    );
    if (!person) {
      return NextResponse.json({ error: "No photos for that name" }, { status: 404 });
    }

    const events = await Promise.all(
      person.events.map(async (e) => ({
        eventId: e.eventId,
        eventName: e.eventName,
        eventDate: e.eventDate,
        imageCount: e.images.length,
        images: await Promise.all(
          e.images.map(async (img) => ({
            id: img.id,
            filename: img.filename,
            thumbnailUrl: await getPresignedDownloadUrl(
              getThumbnailKey(img.r2Key),
              14400
            ),
          }))
        ),
      }))
    );

    // The "same person" joins a human made on this split card, so each can be
    // separated again after the undo toast is gone. Only links whose both
    // shoots are on this card — anything else belongs to another card.
    let links: { eventA: string; eventB: string; label: string }[] = [];
    if (eventIds.length && key) {
      const nameOf = new Map(person.events.map((e) => [e.eventId, e.eventName]));
      const { data: rows, error: linkErr } = await supabase
        .from("person_split_links")
        .select("event_a, event_b")
        .eq("user_id", user!.id)
        .eq("name_key", key.split("~")[0]);
      if (linkErr) throw linkErr;
      links = (rows ?? [])
        .filter((r) => nameOf.has(r.event_a) && nameOf.has(r.event_b))
        .map((r) => ({
          eventA: r.event_a,
          eventB: r.event_b,
          label: `${nameOf.get(r.event_a)} + ${nameOf.get(r.event_b)}`,
        }));
    }

    return NextResponse.json({
      key: person.key,
      name: person.name,
      imageCount: person.imageCount,
      events,
      links,
    });
  } catch (err) {
    await reportSystemError("people.detail", err, { userId: user!.id, name });
    return NextResponse.json(
      { error: "Couldn't load that person" },
      { status: 500 }
    );
  }
}
