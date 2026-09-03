import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The naming engine's review queue.
 *
 * GET  — pending suggestions, payoff-first (biggest clusters at the top),
 *        each carrying BOTH face crops: the anonymous cluster's representative
 *        and the matched reference's. The decision is made on faces.
 * POST — { id, action: "confirm" | "reject" }. Confirm is the ONLY place the
 *        engine's output reaches persons.name — a human wrote it, so the
 *        consensus namer will never overwrite it. Reject records the name in
 *        persons.rejected_names, so the engine can never re-ask (the same
 *        durability contract as clearing a name by hand).
 */

interface FaceCropPayload {
  thumbnailUrl: string;
  bbox: { x: number; y: number; w: number; h: number };
  imageWidth: number | null;
  imageHeight: number | null;
}

async function repFaceCrop(
  supabase: Awaited<ReturnType<typeof getAuthUser>>["supabase"],
  personId: string | null
): Promise<FaceCropPayload | null> {
  if (!personId) return null;
  const { data: person } = await supabase
    .from("persons")
    .select("representative_face_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person?.representative_face_id) return null;
  const { data: face } = await supabase
    .from("faces")
    .select("bbox_x, bbox_y, bbox_w, bbox_h, images!inner(r2_key, width, height)")
    .eq("id", person.representative_face_id)
    .maybeSingle();
  if (!face) return null;
  const img = face.images as unknown as {
    r2_key: string;
    width: number | null;
    height: number | null;
  };
  return {
    thumbnailUrl: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key), 14400),
    bbox: { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h },
    imageWidth: img.width,
    imageHeight: img.height,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 8), 24);
    const { data: rows, error } = await supabase
      .from("person_identity_suggestions")
      .select(
        // persons is embedded TWICE from this table (person_id and
        // matched_person_id both point at it) — the hint is mandatory or
        // PostgREST refuses the path outright (the lesson-86 ambiguity).
        "id, person_id, event_id, kind, crew_id, suggested_name, matched_person_id, confidence, photo_count, events!inner(name), persons!person_identity_suggestions_person_id_fkey(name)"
      )
      .eq("user_id", user!.id)
      .eq("status", "pending")
      // LEAST confident first. Sorting by cluster size put 192 near-certain
      // cards (0.929+) ahead of the six that actually need a human, so the only
      // judgements worth a person's attention sat at the bottom of a 202-card
      // wall. Size correlates with nothing the reviewer is deciding. `id` breaks
      // ties so paging stays deterministic (lesson 88).
      .order("confidence", { ascending: true })
      .order("id")
      .limit(limit);
    if (error) throw error;

    // Crew cards front the crew's own reference avatar — their identity lives
    // in crew_faces, never in persons.name.
    const crewIds = [...new Set((rows ?? []).map((r) => r.crew_id).filter((v): v is string => !!v))];
    let crewAvatarByCrewId: Record<string, { url: string; bbox: { x: number; y: number; w: number; h: number } | null; imageWidth: number | null; imageHeight: number | null } | null> = {};
    if (crewIds.length > 0) {
      const { crewAvatars } = await import("@/lib/crew-faces/store");
      crewAvatarByCrewId = await crewAvatars(supabase, user!.id, crewIds);
    }

    const { count: pendingTotal } = await supabase
      .from("person_identity_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .eq("status", "pending");

    /** How many of those are near-certain. Drives the one-click clear-the-tail
     *  action; kept server-side so the client never has to hold every id. */
    const { count: sureTotal } = await supabase
      .from("person_identity_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .eq("status", "pending")
      .gte("confidence", SURE_CONFIDENCE);

    const suggestions = await Promise.all(
      (rows ?? []).map(async (r) => {
        const crewView = r.crew_id ? crewAvatarByCrewId[r.crew_id] : null;
        return {
          id: r.id,
          personId: r.person_id,
          eventId: r.event_id,
          eventName: (r.events as unknown as { name: string }).name,
          kind: (r.kind ?? "guest") as "guest" | "crew",
          /** The junk label a crew confirm will clear — shown so the card
           *  explains what it fixes ("currently filed as 'Marriott Green'"). */
          currentName: (r.persons as unknown as { name: string | null } | null)?.name ?? null,
          suggestedName: r.suggested_name,
          confidence: r.confidence,
          photoCount: r.photo_count,
          clusterFace: await repFaceCrop(supabase, r.person_id),
          referenceFace:
            r.kind === "crew"
              ? crewView && crewView.bbox
                ? {
                    thumbnailUrl: crewView.url,
                    bbox: crewView.bbox,
                    imageWidth: crewView.imageWidth,
                    imageHeight: crewView.imageHeight,
                  }
                : null
              : await repFaceCrop(supabase, r.matched_person_id),
        };
      })
    );

    return NextResponse.json({ suggestions, pendingTotal: pendingTotal ?? 0, sureTotal: sureTotal ?? 0 });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.list", error);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}

type Decision = { status: string; name?: string | null; crew?: boolean; existingName?: string | null; error?: string };
// eventId rides along so the bulk caller can teach once per event.

/**
 * One suggestion, decided. Extracted so the bulk path CANNOT drift from the
 * single path — a second implementation of "confirm" would be a second place
 * for the crew-vs-guest rule to be got wrong, and that rule (crew identity is a
 * LINK, never persons.name) is the one that must never bend.
 *
 * `teach` is deferred by the bulk caller: refresh_person_reference_centroids is
 * per EVENT, so running it once per suggestion would repeat the same expensive
 * rebuild 192 times and blow the statement budget (lesson 93). Bulk runs it once
 * per distinct event after the writes land.
 */
async function decideOne(
  supabase: Awaited<ReturnType<typeof getAuthUser>>["supabase"],
  userId: string,
  id: string,
  action: "confirm" | "reject",
  opts: { teach: boolean }
): Promise<Decision & { eventId?: string | null }> {
  const { data: suggestion } = await supabase
    .from("person_identity_suggestions")
    .select("id, user_id, person_id, event_id, kind, crew_id, suggested_name, status")
    .eq("id", id)
    .maybeSingle();
  if (!suggestion || suggestion.user_id !== userId) return { status: "not_found", error: "Not found" };
  if (suggestion.status !== "pending") return { status: "already_decided", error: "Already decided" };

  const { data: person } = await supabase
    .from("persons")
    .select("id, name, rejected_names")
    .eq("id", suggestion.person_id)
    .maybeSingle();
  if (!person) return { status: "gone", error: "Cluster is gone" };

  // Crew confirm is a LINK, never a name — crew names must not touch
  // persons.name (guest identity space; the standing crew-faces invariant).
  // confirmCrewPerson also teaches: the cluster's representative face joins
  // the crew's reference set.
  if (action === "confirm" && suggestion.kind === "crew" && suggestion.crew_id) {
    const { confirmCrewPerson } = await import("@/lib/crew-faces/match");
    const linked = await confirmCrewPerson(supabase, {
      userId,
      crewId: suggestion.crew_id,
      personId: suggestion.person_id,
    });
    if (!linked.ok) throw new Error(linked.error ?? "Crew link failed");
    // A junk label on a crew cluster dies WITH the confirm: the name came
    // from random filenames ("Marriott Green" on Christie's faces), and
    // clearing it into rejected_names means the consensus namer can never
    // re-apply it. Crew identity lives in the link, never in persons.name.
    if (person.name) {
      const rejected = new Set(person.rejected_names ?? []);
      rejected.add(person.name);
      const { error: clearErr } = await supabase
        .from("persons")
        .update({ name: null, rejected_names: [...rejected] })
        .eq("id", suggestion.person_id);
      if (clearErr) throw clearErr;
    }
    const { error: statusErr } = await supabase
      .from("person_identity_suggestions")
      .update({ status: "confirmed", decided_at: new Date().toISOString() })
      .eq("id", suggestion.id);
    if (statusErr) throw statusErr;
    return { status: "confirmed", crew: true, name: suggestion.suggested_name, eventId: suggestion.event_id };
  }

  if (action === "confirm") {
    // Named some other way in the meantime? The human's earlier act wins —
    // supersede rather than overwrite.
    if (person.name) {
      await supabase
        .from("person_identity_suggestions")
        .update({ status: "superseded", decided_at: new Date().toISOString() })
        .eq("id", suggestion.id);
      return { status: "superseded", existingName: person.name };
    }
    const { error: nameErr } = await supabase
      .from("persons")
      .update({ name: suggestion.suggested_name })
      .eq("id", suggestion.person_id);
    if (nameErr) throw nameErr;
    const { error: statusErr } = await supabase
      .from("person_identity_suggestions")
      .update({ status: "confirmed", decided_at: new Date().toISOString() })
      .eq("id", suggestion.id);
    if (statusErr) throw statusErr;
    if (opts.teach) await teachEvent(supabase, userId, suggestion.event_id, suggestion.id);
    return { status: "confirmed", name: suggestion.suggested_name, eventId: suggestion.event_id };
  }

  // Reject: durable, spelling-proof, and scoped to this cluster.
  const rejected = new Set(person.rejected_names ?? []);
  rejected.add(suggestion.suggested_name);
  const { error: rejErr } = await supabase
    .from("persons")
    .update({ rejected_names: [...rejected] })
    .eq("id", suggestion.person_id);
  if (rejErr) throw rejErr;
  const { error: statusErr } = await supabase
    .from("person_identity_suggestions")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", suggestion.id);
  if (statusErr) throw statusErr;
  return { status: "rejected", eventId: suggestion.event_id };
}

/**
 * Teach-on-confirm: the newly named cluster joins the reference library now,
 * not at the next scan. Best-effort with a REPORT — the confirm stands either
 * way, but a swallowed failure here would silently slow the engine's learning
 * (best-effort means the outcome is optional, never the evidence).
 */
async function teachEvent(
  supabase: Awaited<ReturnType<typeof getAuthUser>>["supabase"],
  userId: string,
  eventId: string | null,
  suggestionId: string
) {
  const { NON_PERSON_GALLERIES } = await import("@/lib/people/index-people");
  const { error } = await supabase.rpc("refresh_person_reference_centroids", {
    p_user_id: userId,
    p_event_id: eventId ?? undefined,
    p_excluded_event_names: [...NON_PERSON_GALLERIES],
  });
  if (error) {
    await reportSystemError("people.identity-suggestions.teach", error, { suggestionId });
  }
}

/** A bulk confirm is still a human applying it — one deliberate act, not an
 *  auto-apply. Capped so a malformed client cannot walk the whole table. */
const MAX_BULK = 500;

/** Near-certain. Measured: true-match median 0.886, impostor max 0.363, floor
 *  0.55. 0.90 sits well clear of the impostor ceiling. */
// NOT exported: a Next.js route module may only export route handlers and a
// fixed set of config names, and an extra export fails the BUILD (not tsc alone).
// The client mirrors this value in IdentitySuggestions.tsx.
const SURE_CONFIDENCE = 0.9;

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json()) as {
      id?: string; ids?: string[]; action?: string; minConfidence?: number; eventId?: string;
    };
    const action = body.action;
    if (action !== "confirm" && action !== "reject") {
      return NextResponse.json({ error: "action must be confirm or reject" }, { status: 400 });
    }

    // ---- bulk ----
    // Two ways in. Explicit `ids` is the auditable form. `minConfidence` exists
    // because the wall only ever holds 8 cards, so "confirm everything the
    // engine is sure about" cannot be expressed as the ids on screen — the
    // server resolves them, scoped to this user's PENDING rows only, capped,
    // and reports exactly what it touched. It is still a human pressing it
    // once; that is the line, not who assembles the list.
    if (Array.isArray(body.ids) || typeof body.minConfidence === "number") {
      let requestedIds = body.ids;
      if (!requestedIds) {
        const floor = body.minConfidence as number;
        if (!(floor >= 0.6 && floor <= 1)) {
          return NextResponse.json({ error: "minConfidence must be between 0.6 and 1" }, { status: 400 });
        }
        let q = supabase
          .from("person_identity_suggestions")
          .select("id")
          .eq("user_id", user!.id)
          .eq("status", "pending")
          .gte("confidence", floor)
          .order("id")
          .limit(MAX_BULK);
        if (body.eventId) q = q.eq("event_id", body.eventId);
        const { data, error } = await q;
        if (error) throw error;
        requestedIds = (data ?? []).map((r) => r.id);
      }
      const ids = [...new Set(requestedIds.filter((x) => typeof x === "string" && x))];
      if (!ids.length) return NextResponse.json({ error: "ids is empty" }, { status: 400 });
      if (ids.length > MAX_BULK) {
        return NextResponse.json({ error: `at most ${MAX_BULK} at a time` }, { status: 400 });
      }
      const counts: Record<string, number> = {};
      const events = new Set<string>();
      let failed = 0;
      for (const id of ids) {
        try {
          const r = await decideOne(supabase, user!.id, id, action, { teach: false });
          counts[r.status] = (counts[r.status] ?? 0) + 1;
          if (r.status === "confirmed" && r.eventId) events.add(r.eventId);
        } catch (err) {
          // One bad row must not abandon the other 191 — the writes already
          // made are real and correct. Report it and keep going.
          failed += 1;
          await reportSystemError("people.identity-suggestions.bulk", err, { suggestionId: id });
        }
      }
      // Teach ONCE per event, after the writes (see decideOne's note).
      for (const eventId of events) await teachEvent(supabase, user!.id, eventId, "bulk");
      return NextResponse.json({ bulk: true, requested: ids.length, counts, failed });
    }

    // ---- single ----
    if (!body.id) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
    const result = await decideOne(supabase, user!.id, body.id, action, { teach: true });
    if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.status === "already_decided") return NextResponse.json({ error: "Already decided" }, { status: 409 });
    if (result.status === "gone") return NextResponse.json({ error: "Cluster is gone" }, { status: 410 });
    return NextResponse.json(result);
  } catch (error) {
    await reportSystemError("people.identity-suggestions.decide", error);
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}
