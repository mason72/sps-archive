import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { requestPeopleIndexRefresh } from "@/lib/people/index-cache";
import { decideOne, teachEvent } from "@/lib/people/identity-decide";
import { repFaceCrop } from "@/lib/people/identity-cards";

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
          const r = await decideOne(supabase, user!.id, id, action, { teach: false, decidedBy: "human" });
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
      // A confirm puts group shots on a card — the wall's snapshot is stale.
      if ((counts.confirmed ?? 0) > 0) await requestPeopleIndexRefresh(user!.id);
      return NextResponse.json({ bulk: true, requested: ids.length, counts, failed });
    }

    // ---- single ----
    if (!body.id) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
    const result = await decideOne(supabase, user!.id, body.id, action, { teach: true, decidedBy: "human" });
    if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.status === "already_decided") return NextResponse.json({ error: "Already decided" }, { status: 409 });
    if (result.status === "gone") return NextResponse.json({ error: "Cluster is gone" }, { status: 410 });
    if (result.status === "confirmed") await requestPeopleIndexRefresh(user!.id);
    return NextResponse.json(result);
  } catch (error) {
    await reportSystemError("people.identity-suggestions.decide", error);
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}
