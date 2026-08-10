import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  filterSemanticMatches,
  SEMANTIC_RPC_THRESHOLD,
} from "@/lib/ai-index/search-filter";

/**
 * GET /api/gallery/[slug]/search?q=<query>
 *
 * Guest-facing semantic search WITHIN one shared gallery.
 *
 * Leak-proofing, in layers:
 *  1. Share must be active + unexpired; password-protected shares require the
 *     same gallery_auth cookie the payload route checks.
 *  2. The vector RPC is scoped to the share's event via the owner's user_id
 *     (its required parameter), and selection shares are intersected with
 *     share.image_ids server-side.
 *  3. The response contains ONLY image ids + similarity — no URLs, no
 *     filenames. The client resolves ids against the gallery payload it
 *     already holds, so an id outside the share's visible set renders nothing.
 *
 * Gated per event by settings.sharing.guestSearch (default ON) — enforced
 * here, not just hidden in the UI. Rate-limited per (slug, ip).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const supabase = createServiceClient();
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 3) {
      return NextResponse.json({ results: [] });
    }
    if (!process.env.MODAL_AI_EMBED_TEXT_URL) {
      return NextResponse.json({ results: [], message: "Search not configured" });
    }

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

    // Same gate as the gallery payload route: a protected share needs the
    // cookie set by /verify.
    if (share.password_hash) {
      const cookie = request.cookies.get(`gallery_auth_${slug}`);
      if (cookie?.value !== share.id) {
        return NextResponse.json({ error: "Locked" }, { status: 401 });
      }
    }

    if (!(await checkAuthRateLimit(supabase, "search", slug, clientIp(request)))) {
      return NextResponse.json({ error: "Too many searches" }, { status: 429 });
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

    const sharing = ((event.settings ?? {}) as { sharing?: { guestSearch?: boolean } })
      .sharing;
    if (sharing?.guestSearch === false) {
      return NextResponse.json({ error: "Search disabled" }, { status: 403 });
    }

    const embedRes = await fetch(process.env.MODAL_AI_EMBED_TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipeline_key: process.env.VIDEO_PIPELINE_KEY,
        texts: [query],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!embedRes.ok) throw new Error(`embed_text ${embedRes.status}`);
    const { embeddings } = (await embedRes.json()) as { embeddings: number[][] };

    const { data: matches, error: rpcErr } = await supabase.rpc(
      "search_images_by_embedding",
      {
        query_embedding: JSON.stringify(embeddings[0]),
        target_user_id: event.user_id,
        target_event_id: share.event_id,
        match_threshold: SEMANTIC_RPC_THRESHOLD,
        match_count: 100,
      }
    );
    if (rpcErr) throw rpcErr;

    // Selection shares expose an explicit subset — intersect server-side.
    const allowed =
      share.share_type === "selection" && share.image_ids?.length
        ? new Set(share.image_ids)
        : null;
    const results = filterSemanticMatches(matches ?? [])
      .filter((m: { id: string }) => !allowed || allowed.has(m.id))
      .map((m: { id: string; similarity: number }) => ({
        id: m.id,
        similarity: m.similarity,
      }));

    return NextResponse.json({ results });
  } catch (error) {
    await reportSystemError("gallery.search", error, { slug });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
