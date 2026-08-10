import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * POST /api/events/[eventId]/people/resolve
 *
 * Applies one People-view suggestion (photographer-clicked, never automatic):
 *  - {action:"fix-label", imageId, personId} — the mislabel fix: sets the
 *    image's parsed_name to the person's name. Display + stacks re-derive
 *    from parsed_name; original_filename is deliberately untouched (it feeds
 *    duplicate detection and download names).
 *  - {action:"merge", fromId, intoId} — reassigns every face and folds the
 *    smaller person into the larger; a name is never lost.
 *  - {action:"dismiss", key} — persists the dismissal in event settings.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      action: "fix-label" | "merge" | "dismiss";
      imageId?: string;
      personId?: string;
      fromId?: string;
      intoId?: string;
      key?: string;
    };

    if (body.action === "fix-label") {
      const { imageId, personId } = body;
      if (!imageId || !personId) {
        return NextResponse.json({ error: "imageId and personId required" }, { status: 400 });
      }
      const { data: person } = await supabase
        .from("persons")
        .select("id, name")
        .eq("id", personId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (!person?.name) {
        return NextResponse.json({ error: "Person not found or unnamed" }, { status: 404 });
      }
      const { error } = await supabase
        .from("images")
        .update({ parsed_name: person.name })
        .eq("id", imageId)
        .eq("event_id", eventId);
      if (error) throw error;
      return NextResponse.json({ ok: true, parsedName: person.name });
    }

    if (body.action === "merge") {
      const { fromId, intoId } = body;
      if (!fromId || !intoId || fromId === intoId) {
        return NextResponse.json({ error: "fromId and intoId required" }, { status: 400 });
      }
      const { data: pair } = await supabase
        .from("persons")
        .select("id, name, face_count, representative_face_id")
        .eq("event_id", eventId)
        .in("id", [fromId, intoId]);
      const from = pair?.find((p) => p.id === fromId);
      const into = pair?.find((p) => p.id === intoId);
      if (!from || !into) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      const { error: moveErr } = await supabase
        .from("faces")
        .update({ person_id: intoId })
        .eq("person_id", fromId);
      if (moveErr) throw moveErr;
      const { error: updErr } = await supabase
        .from("persons")
        .update({
          face_count: from.face_count + into.face_count,
          // A name is never lost in a merge.
          ...(into.name ? {} : from.name ? { name: from.name } : {}),
        })
        .eq("id", intoId);
      if (updErr) throw updErr;
      const { error: delErr } = await supabase.from("persons").delete().eq("id", fromId);
      if (delErr) throw delErr;
      return NextResponse.json({ ok: true });
    }

    if (body.action === "dismiss") {
      if (!body.key) {
        return NextResponse.json({ error: "key required" }, { status: 400 });
      }
      const settings = (event.settings ?? {}) as Record<string, unknown> & {
        people?: { dismissedSuggestions?: string[] };
      };
      const dismissed = new Set(settings.people?.dismissedSuggestions ?? []);
      dismissed.add(body.key);
      const { error } = await supabase
        .from("events")
        .update({
          settings: {
            ...settings,
            people: { ...(settings.people ?? {}), dismissedSuggestions: [...dismissed] },
          },
        })
        .eq("id", eventId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    await reportSystemError("people.resolve", error, { eventId });
    return NextResponse.json({ error: "Failed to apply" }, { status: 500 });
  }
}
