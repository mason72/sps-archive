import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { requestPeopleIndexRefresh } from "@/lib/people/index-cache";
import { repFaceCrop } from "@/lib/people/identity-cards";
import { markAutoReviewed, undoAutoDecision } from "@/lib/people/identity-decide";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The "Auto-matched · Review" strip (2026-10-04).
 *
 * GET  — this user's UNREVIEWED auto decisions, newest first, with both faces
 *        and the total, so the strip can say "and 212 more".
 * POST — { action: "reviewed", ids?: string[] }   one card or (no ids) all
 *        { action: "undo", id }                   take one back: reject +
 *        un-teach, through undoAutoDecision (the only path).
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 12), 48);

    const { data: rows, error } = await supabase
      .from("person_identity_suggestions")
      .select(
        "id, person_id, event_id, kind, crew_id, suggested_name, matched_person_id, confidence, photo_count, decided_at, events!inner(name)"
      )
      .eq("user_id", user!.id)
      .eq("decided_by", "auto")
      .is("reviewed_at", null)
      .order("decided_at", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw error;

    const { count: total } = await supabase
      .from("person_identity_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .eq("decided_by", "auto")
      .is("reviewed_at", null);

    const crewIds = [...new Set((rows ?? []).map((r) => r.crew_id).filter((v): v is string => !!v))];
    let crewAvatarByCrewId: Awaited<ReturnType<typeof import("@/lib/crew-faces/store").crewAvatars>> = {};
    if (crewIds.length > 0) {
      const { crewAvatars } = await import("@/lib/crew-faces/store");
      crewAvatarByCrewId = await crewAvatars(supabase, user!.id, crewIds);
    }

    const cards = await Promise.all(
      (rows ?? []).map(async (r) => {
        const crewView = r.crew_id ? crewAvatarByCrewId[r.crew_id] : null;
        return {
          id: r.id,
          personId: r.person_id,
          eventId: r.event_id,
          eventName: (r.events as unknown as { name: string }).name,
          kind: (r.kind ?? "guest") as "guest" | "crew",
          suggestedName: r.suggested_name,
          confidence: r.confidence,
          photoCount: r.photo_count,
          decidedAt: r.decided_at,
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
    return NextResponse.json({ cards, total: total ?? 0 });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.auto.list", error);
    return NextResponse.json({ error: "Failed to load auto matches" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const body = (await request.json()) as { action?: string; id?: string; ids?: string[] };

    if (body.action === "reviewed") {
      const ids = Array.isArray(body.ids)
        ? [...new Set(body.ids.filter((x) => typeof x === "string" && x))]
        : "all";
      if (ids !== "all" && ids.length === 0) {
        return NextResponse.json({ error: "ids is empty" }, { status: 400 });
      }
      const reviewed = await markAutoReviewed(supabase, user!.id, ids);
      return NextResponse.json({ reviewed });
    }

    if (body.action === "undo") {
      if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      const result = await undoAutoDecision(supabase, user!.id, body.id);
      if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (result.status === "not_auto") return NextResponse.json({ error: "Not an auto decision" }, { status: 409 });
      if (result.status === "gone") return NextResponse.json({ error: "Cluster is gone" }, { status: 410 });
      // The name came off a card — the wall's snapshot is stale.
      await requestPeopleIndexRefresh(user!.id);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "action must be reviewed or undo" }, { status: 400 });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.auto.decide", error);
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}
