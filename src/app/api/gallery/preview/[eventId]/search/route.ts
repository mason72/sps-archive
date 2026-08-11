import { NextRequest, NextResponse } from "next/server";
import { embedTexts } from "@/lib/ai-index/embed-text";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  filterSemanticMatches,
  SEMANTIC_RPC_THRESHOLD,
} from "@/lib/ai-index/search-filter";

/**
 * GET /api/gallery/preview/[eventId]/search?q=<query>
 *
 * The preview's semantic search — the owner-scoped twin of the guest route
 * (`/api/gallery/[slug]/search`). Same embedding, same RPC, same threshold,
 * same ids-only response shape, so the preview ranks results identically to
 * what a client will see.
 *
 * The differences are only in the gate: ownership replaces the share checks
 * (no slug, no password cookie, no selection intersection — a preview shows
 * the whole event by definition), and there is no `guestSearch` toggle here.
 * That toggle governs what GUESTS may do; the photographer previewing their
 * own gallery is not a guest, and switching it off must not blind them to
 * their own archive.
 *
 * Still metered: it embeds text on Modal exactly like guest search does, and
 * the owner is the one billed either way.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 3) {
      return NextResponse.json({ results: [] });
    }
    if (!process.env.MODAL_AI_EMBED_TEXT_URL) {
      return NextResponse.json({ results: [], message: "Search not configured" });
    }

    // Ownership IS the boundary — getAuthUser hands back the service client.
    const { data: event } = await supabase
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event?.user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const embeddings = await embedTexts([query], {
      userId: event.user_id,
      eventId,
      purpose: "guest_search",
    });

    const { data: matches, error: rpcErr } = await supabase.rpc(
      "search_images_by_embedding",
      {
        query_embedding: JSON.stringify(embeddings[0]),
        target_user_id: event.user_id,
        target_event_id: eventId,
        match_threshold: SEMANTIC_RPC_THRESHOLD,
        match_count: 100,
      }
    );
    if (rpcErr) throw rpcErr;

    const results = filterSemanticMatches(matches ?? []).map(
      (m: { id: string; similarity: number }) => ({
        id: m.id,
        similarity: m.similarity,
      })
    );

    return NextResponse.json({ results });
  } catch (error) {
    await reportSystemError("gallery.preview-search", error, { eventId });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
