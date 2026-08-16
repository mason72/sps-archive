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
        "id, person_id, event_id, suggested_name, matched_person_id, confidence, photo_count, events!inner(name)"
      )
      .eq("user_id", user!.id)
      .eq("status", "pending")
      .order("photo_count", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw error;

    const { count: pendingTotal } = await supabase
      .from("person_identity_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .eq("status", "pending");

    const suggestions = await Promise.all(
      (rows ?? []).map(async (r) => ({
        id: r.id,
        personId: r.person_id,
        eventId: r.event_id,
        eventName: (r.events as unknown as { name: string }).name,
        suggestedName: r.suggested_name,
        confidence: r.confidence,
        photoCount: r.photo_count,
        clusterFace: await repFaceCrop(supabase, r.person_id),
        referenceFace: await repFaceCrop(supabase, r.matched_person_id),
      }))
    );

    return NextResponse.json({ suggestions, pendingTotal: pendingTotal ?? 0 });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.list", error);
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json()) as { id?: string; action?: string };
    if (!body.id || (body.action !== "confirm" && body.action !== "reject")) {
      return NextResponse.json({ error: "id and action are required" }, { status: 400 });
    }

    const { data: suggestion } = await supabase
      .from("person_identity_suggestions")
      .select("id, user_id, person_id, event_id, suggested_name, status")
      .eq("id", body.id)
      .maybeSingle();
    if (!suggestion || suggestion.user_id !== user!.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (suggestion.status !== "pending") {
      return NextResponse.json({ error: "Already decided" }, { status: 409 });
    }

    const { data: person } = await supabase
      .from("persons")
      .select("id, name, rejected_names")
      .eq("id", suggestion.person_id)
      .maybeSingle();
    if (!person) return NextResponse.json({ error: "Cluster is gone" }, { status: 410 });

    if (body.action === "confirm") {
      // Named some other way in the meantime? The human's earlier act wins —
      // supersede rather than overwrite.
      if (person.name) {
        await supabase
          .from("person_identity_suggestions")
          .update({ status: "superseded", decided_at: new Date().toISOString() })
          .eq("id", suggestion.id);
        return NextResponse.json({ status: "superseded", existingName: person.name });
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
      // Teach-on-confirm: the newly named cluster joins the reference library
      // now, not at the next scan. Best-effort with a REPORT — the confirm
      // stands either way, but a swallowed failure here would silently slow
      // the engine's learning (best-effort means the outcome is optional,
      // never the evidence).
      const { error: refreshErr } = await supabase.rpc("refresh_person_reference_centroids", {
        p_user_id: user!.id,
        p_event_id: suggestion.event_id,
      });
      if (refreshErr) {
        await reportSystemError("people.identity-suggestions.teach", refreshErr, {
          suggestionId: suggestion.id,
        });
      }
      return NextResponse.json({ status: "confirmed", name: suggestion.suggested_name });
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
    return NextResponse.json({ status: "rejected" });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.decide", error);
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}
