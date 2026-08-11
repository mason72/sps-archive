import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";
import { recordUsage, secondsSince } from "@/lib/usage/record";
import { resolveShareImageScope, shareScopeIdFilter } from "@/lib/gallery/share-scope";
import { selfieSearchEnabled } from "@/types/event-settings";

export const runtime = "nodejs";

/**
 * POST /api/gallery/[slug]/selfie-search   { imageBase64 }
 *
 * Guest "find my photos": the selfie is forwarded to Modal, embedded in
 * memory, and never stored anywhere — the response is image ids only.
 *
 * Matching goes through CLUSTERING, not just visual similarity: the face
 * hits vote for a person, and the winner's complete photo set comes back —
 * so sunglasses-at-the-party still gets the dance-floor shots. Falls back to
 * direct face hits when no person wins the vote.
 *
 * ON by default per event, enforced here through `selfieSearchEnabled()` —
 * the same predicate the guest payload uses to decide whether to render the
 * button, so the endpoint can never be open behind a hidden button or shut
 * behind a visible one. Same share gates as guest search + a strict rate limit.
 */

/** A face hit at or above this cosine is evidence; ArcFace same-person ≥ ~0.5. */
const FACE_MATCH_FLOOR = 0.5;
/** A single hit this strong identifies a person on its own. */
const STRONG_MATCH = 0.6;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const supabase = createServiceClient();

    const { data: share } = await supabase
      .from("shares")
      .select("id, event_id, is_active, expires_at, password_hash, share_type, image_ids")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }
    if (share.password_hash) {
      const cookie = request.cookies.get(`gallery_auth_${slug}`);
      if (cookie?.value !== share.id) {
        return NextResponse.json({ error: "Locked" }, { status: 401 });
      }
    }

    // Resolved before the GPU call — an unnarrowable share type can't match
    // anything, so it must not spend the owner's money finding that out.
    const scope = resolveShareImageScope(share);
    if (scope.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!(await checkAuthRateLimit(supabase, "search", slug, clientIp(request)))) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("user_id, settings")
      .eq("id", share.event_id)
      .single();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // events.user_id is nullable — an ownerless event has no owner scope to
    // search within, so fail closed rather than run the RPC unscoped.
    if (!event.user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sharing = ((event.settings ?? {}) as { sharing?: { selfieSearch?: boolean } })
      .sharing;
    if (!selfieSearchEnabled(sharing)) {
      return NextResponse.json({ error: "Selfie search is not enabled" }, { status: 403 });
    }
    if (!process.env.MODAL_AI_SELFIE_URL) {
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const { imageBase64 } = (await request.json()) as { imageBase64?: string };
    if (!imageBase64 || imageBase64.length > 3_000_000) {
      // Client downscales to ~800px before upload; ~2MB base64 is plenty.
      return NextResponse.json({ error: "Bad selfie payload" }, { status: 400 });
    }

    // Embed in memory on Modal; nothing is persisted anywhere.
    const embedStarted = Date.now();
    const embedRes = await fetch(process.env.MODAL_AI_SELFIE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline_key: process.env.VIDEO_PIPELINE_KEY,
        image_b64: imageBase64,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!embedRes.ok) throw new Error(`embed_selfie ${embedRes.status}`);
    // Guest selfie search bills the event owner. Awaited — see embed-text.ts.
    await recordUsage({
      userId: event.user_id,
      eventId: share.event_id,
      kind: "ai_embed_selfie",
      quantity: secondsSince(embedStarted),
      unit: "seconds",
    });
    const { faces } = (await embedRes.json()) as {
      faces: { embedding: number[] | null; quality: number }[];
    };
    const best = (faces ?? [])
      .filter((f) => f.embedding)
      .sort((a, b) => b.quality - a.quality)[0];
    if (!best) {
      return NextResponse.json({ results: [], noFace: true });
    }

    const { data: hits, error: rpcErr } = await supabase.rpc("search_faces_by_embedding", {
      query_embedding: JSON.stringify(best.embedding),
      target_user_id: event.user_id,
      target_event_id: share.event_id,
      match_threshold: 0.4,
      match_count: 200,
    });
    if (rpcErr) throw rpcErr;

    const evidence = (hits ?? []).filter(
      (h: { similarity: number }) => h.similarity >= FACE_MATCH_FLOOR
    );

    // Person vote: the cluster with the most supporting hits wins; a single
    // very strong hit is enough on its own.
    const votes = new Map<string, { count: number; top: number }>();
    for (const h of evidence as { person_id: string | null; similarity: number }[]) {
      if (!h.person_id) continue;
      const v = votes.get(h.person_id) ?? { count: 0, top: 0 };
      v.count += 1;
      v.top = Math.max(v.top, h.similarity);
      votes.set(h.person_id, v);
    }
    let winner: string | null = null;
    for (const [personId, v] of votes) {
      if (v.count >= 2 || v.top >= STRONG_MATCH) {
        const cur = winner ? votes.get(winner)! : null;
        if (!cur || v.count > cur.count || (v.count === cur.count && v.top > cur.top)) {
          winner = personId;
        }
      }
    }

    let imageIds: string[];
    if (winner) {
      // The person's COMPLETE set (clustering recall beats raw similarity).
      const ids = new Set<string>();
      for (let page = 0; ; page++) {
        const { data: rows, error } = await supabase
          .from("faces")
          .select("image_id")
          .eq("person_id", winner)
          .order("id", { ascending: true })
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const r of rows ?? []) ids.add(r.image_id);
        if (!rows || rows.length < 1000) break;
      }
      imageIds = [...ids];
    } else {
      imageIds = [...new Set(evidence.map((h: { image_id: string }) => h.image_id))];
    }

    // Selection shares expose a subset — intersect server-side; ids only.
    const allowed = shareScopeIdFilter(scope);
    const results = imageIds.filter((id) => !allowed || allowed.has(id));

    return NextResponse.json({ results, matchedPerson: Boolean(winner) });
  } catch (error) {
    await reportSystemError("gallery.selfie-search", error, { slug });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
