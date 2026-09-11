import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { requestPeopleIndexRefresh } from "@/lib/people/index-cache";

export const runtime = "nodejs";

/**
 * "These two shoots are the same person" — for a name the /people wall split
 * by faces (src/lib/people/face-split.ts).
 *
 * POST   { baseKey, eventA, eventB }  — record the link; the next rebuild joins them
 * DELETE ?baseKey=&eventA=&eventB=    — undo it
 *
 * Anchored to EVENTS under the NAME key (migration 080), never to card keys,
 * which move as photos land. Both events must belong to the caller: this route
 * holds the service client, so that check is the boundary.
 */
const NAME_KEY = /^[a-z]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parse(baseKey: unknown, eventA: unknown, eventB: unknown) {
  if (typeof baseKey !== "string" || !NAME_KEY.test(baseKey)) return null;
  if (typeof eventA !== "string" || !UUID.test(eventA)) return null;
  if (typeof eventB !== "string" || !UUID.test(eventB)) return null;
  if (eventA === eventB) return null;
  const [a, b] = eventA < eventB ? [eventA, eventB] : [eventB, eventA];
  return { nameKey: baseKey, a, b };
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const link = parse(body.baseKey, body.eventA, body.eventB);
    if (!link) return NextResponse.json({ error: "baseKey, eventA and eventB are required" }, { status: 400 });

    const { data: owned, error: evErr } = await supabase
      .from("events")
      .select("id")
      .eq("user_id", user!.id)
      .in("id", [link.a, link.b]);
    if (evErr) throw evErr;
    if ((owned ?? []).length !== 2) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error } = await supabase.from("person_split_links").upsert(
      { user_id: user!.id, name_key: link.nameKey, event_a: link.a, event_b: link.b },
      { onConflict: "user_id,name_key,event_a,event_b", ignoreDuplicates: true }
    );
    if (error) throw error;

    await requestPeopleIndexRefresh(user!.id);
    return NextResponse.json({ ok: true, ...link });
  } catch (err) {
    await reportSystemError("people.split-links.create", err);
    return NextResponse.json({ error: "Failed to join" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const q = request.nextUrl.searchParams;
    const link = parse(q.get("baseKey"), q.get("eventA"), q.get("eventB"));
    if (!link) return NextResponse.json({ error: "baseKey, eventA and eventB are required" }, { status: 400 });

    const { error } = await supabase
      .from("person_split_links")
      .delete()
      .eq("user_id", user!.id)
      .eq("name_key", link.nameKey)
      .eq("event_a", link.a)
      .eq("event_b", link.b);
    if (error) throw error;

    await requestPeopleIndexRefresh(user!.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("people.split-links.delete", err);
    return NextResponse.json({ error: "Failed to separate" }, { status: 500 });
  }
}
