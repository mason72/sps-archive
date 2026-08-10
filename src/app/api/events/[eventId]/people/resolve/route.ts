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
      action: "fix-label" | "merge" | "dismiss" | "refine-name" | "propose-split" | "split";
      imageIds?: string[];
      personId?: string;
      fromId?: string;
      intoId?: string;
      key?: string;
      fullName?: string;
      manual?: boolean;
      groups?: { name?: string | null; faceIds: string[] }[];
    };

    /** Person's faces (embedding + image), paged; shared by both split actions. */
    async function loadPersonFaces(personId: string) {
      const out: {
        id: string;
        imageId: string;
        embedding: number[];
        quality: number;
        filename: string;
      }[] = [];
      for (let page = 0; ; page++) {
        const { data: rows, error } = await supabase
          .from("faces")
          .select("id, image_id, embedding, quality, images!inner(original_filename)")
          .eq("person_id", personId)
          .not("embedding", "is", null)
          .order("id", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const row of rows ?? []) {
          out.push({
            id: row.id,
            imageId: row.image_id,
            embedding: JSON.parse(row.embedding as unknown as string),
            quality: row.quality,
            filename: (row.images as unknown as { original_filename: string })
              .original_filename,
          });
        }
        if (!rows || rows.length < 1000) break;
      }
      return out;
    }

    if (body.action === "propose-split") {
      if (!body.personId) {
        return NextResponse.json({ error: "personId required" }, { status: 400 });
      }
      const { data: person } = await supabase
        .from("persons")
        .select("id, name")
        .eq("id", body.personId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const { proposeSplit } = await import("@/lib/faces/split");
      const { extractPersonName } = await import("@/lib/gallery/stacks");
      const { isPersonLike } = await import("@/lib/sections/auto-plan");

      const faces = await loadPersonFaces(body.personId);
      const filenameOf = new Map(faces.map((f) => [f.imageId, f.filename]));
      const proposal = proposeSplit(faces, filenameOf, extractPersonName, isPersonLike);
      if (!proposal) {
        // Manual split (opened from the person modal, no suggestion card):
        // the photographer knows better than the algorithm — hand them all
        // the faces in one column and let them click photos across.
        if (body.manual) {
          return NextResponse.json({
            proposal: {
              basis: "manual",
              groups: [
                {
                  seedName: person.name,
                  faces: faces.map((f) => ({ faceId: f.id, imageId: f.imageId })),
                },
                { seedName: null, faces: [] },
              ],
            },
          });
        }
        return NextResponse.json({
          proposal: null,
          message: "These faces don't separate cleanly — this looks like one person.",
        });
      }
      const imageOfFace = new Map(faces.map((f) => [f.id, f.imageId]));
      return NextResponse.json({
        proposal: {
          basis: proposal.basis,
          groups: proposal.groups.map((g) => ({
            seedName: g.seedName,
            faces: g.faceIds.map((id) => ({ faceId: id, imageId: imageOfFace.get(id)! })),
          })),
        },
      });
    }

    if (body.action === "split") {
      const { personId, groups } = body;
      if (!personId || !groups || groups.length !== 2) {
        return NextResponse.json(
          { error: "personId and exactly two groups required" },
          { status: 400 }
        );
      }
      if (!groups[0].faceIds.length || !groups[1].faceIds.length) {
        return NextResponse.json({ error: "Both groups need faces" }, { status: 400 });
      }
      const { data: person } = await supabase
        .from("persons")
        .select("id, name")
        .eq("id", personId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });

      // Every face must belong to this person; the two groups must not overlap.
      const faces = await loadPersonFaces(personId);
      const owned = new Set(faces.map((f) => f.id));
      const a = groups[0].faceIds.filter((id) => owned.has(id));
      const bSet = new Set(groups[1].faceIds.filter((id) => owned.has(id)));
      const b = [...bSet].filter((id) => !a.includes(id));
      if (!a.length || !b.length) {
        return NextResponse.json({ error: "Groups don't match this person" }, { status: 400 });
      }

      const nameA = groups[0].name?.trim().slice(0, 120) || null;
      const nameB = groups[1].name?.trim().slice(0, 120) || null;

      // Group A keeps the original person id (names/links survive).
      const { data: created, error: newErr } = await supabase
        .from("persons")
        .insert({ event_id: eventId, name: nameB })
        .select("id")
        .single();
      if (newErr || !created) throw newErr || new Error("person insert failed");
      const { error: moveErr } = await supabase
        .from("faces")
        .update({ person_id: created.id })
        .in("id", b);
      if (moveErr) throw moveErr;

      // Refresh both: name (A may have been corrected), counts, representative.
      const qualityOf = new Map(faces.map((f) => [f.id, f.quality]));
      const repOf = (ids: string[]) =>
        [...ids].sort((x, y) => (qualityOf.get(y) ?? 0) - (qualityOf.get(x) ?? 0))[0];
      const { error: updA } = await supabase
        .from("persons")
        .update({
          ...(nameA ? { name: nameA } : {}),
          face_count: a.length,
          representative_face_id: repOf(a),
        })
        .eq("id", personId);
      if (updA) throw updA;
      const { error: updB } = await supabase
        .from("persons")
        .update({ face_count: b.length, representative_face_id: repOf(b) })
        .eq("id", created.id);
      if (updB) throw updB;

      return NextResponse.json({
        ok: true,
        keptPersonId: personId,
        newPersonId: created.id,
        counts: [a.length, b.length],
      });
    }

    if (body.action === "fix-label") {
      const { imageIds, personId } = body;
      if (!imageIds?.length || !personId) {
        return NextResponse.json({ error: "imageIds and personId required" }, { status: 400 });
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
        .in("id", imageIds)
        .eq("event_id", eventId);
      if (error) throw error;
      return NextResponse.json({ ok: true, parsedName: person.name, fixed: imageIds.length });
    }

    if (body.action === "refine-name") {
      // Adopt the fuller name from the files (names get truncated, not
      // invented). Person rename only — no image writes.
      const { personId, fullName } = body;
      const name = fullName?.trim().slice(0, 120);
      if (!personId || !name) {
        return NextResponse.json({ error: "personId and fullName required" }, { status: 400 });
      }
      const { data: person } = await supabase
        .from("persons")
        .select("id")
        .eq("id", personId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (!person) {
        return NextResponse.json({ error: "Person not found" }, { status: 404 });
      }
      const { error } = await supabase.from("persons").update({ name }).eq("id", personId);
      if (error) throw error;
      return NextResponse.json({ ok: true, name });
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
