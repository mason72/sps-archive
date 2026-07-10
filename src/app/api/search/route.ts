import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * GET /api/search?q=<query>&eventId=<optional>&type=<semantic|filename|person>
 *
 * Unified search across the archive.
 *
 * Search types:
 *   - semantic: Uses CLIP embeddings to find visually/conceptually matching images
 *     e.g., "first dance", "people laughing", "food"
 *   - filename: Direct filename/parsed name search
 *     e.g., "Smith", "IMG_4532"
 *   - person: Face similarity search (requires selfie upload via POST)
 *   - auto: Tries filename first, falls back to semantic
 */
/** Hard ceiling on results so a caller can't request the whole archive. */
const MAX_SEARCH_LIMIT = 200;

export async function GET(request: NextRequest) {
  // getAuthUser hands back the SERVICE client (bypasses RLS). Search reads the
  // images table and hands out presigned ORIGINAL URLs, so it MUST be scoped to
  // the caller's own events — otherwise it's a cross-tenant exfil endpoint
  // (the exact IDOR class as lessons #2/#14). Scope = the user's owned events.
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const requestedEventId = searchParams.get("eventId") || undefined;
  const searchType = searchParams.get("type") || "auto";
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1),
    MAX_SEARCH_LIMIT
  );

  if (!query) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  try {
    // Resolve the caller's owned events. If a specific eventId was requested,
    // it must be one of them; otherwise search spans all the user's events.
    const { data: ownedEvents, error: ownedErr } = await supabase
      .from("events")
      .select("id")
      .eq("user_id", user!.id);
    if (ownedErr) throw ownedErr;

    let scopeEventIds = (ownedEvents ?? []).map((e) => e.id);
    if (requestedEventId) {
      if (!scopeEventIds.includes(requestedEventId)) {
        // Not the caller's event — reveal nothing (don't 404-oracle either).
        return NextResponse.json({ type: searchType, results: [], count: 0 });
      }
      scopeEventIds = [requestedEventId];
    }
    if (scopeEventIds.length === 0) {
      return NextResponse.json({ type: searchType, results: [], count: 0 });
    }

    if (searchType === "filename" || searchType === "auto") {
      // Try filename search first
      const filenameResults = await searchByFilename(supabase, query, scopeEventIds, limit);

      if (filenameResults.length > 0 || searchType === "filename") {
        return NextResponse.json({
          type: "filename",
          results: filenameResults,
          count: filenameResults.length,
        });
      }
    }

    if (searchType === "semantic" || searchType === "auto") {
      // Semantic search requires Modal API — gracefully skip if not configured
      if (!process.env.MODAL_API_URL) {
        return NextResponse.json({
          type: "filename",
          results: [],
          count: 0,
          message: "Semantic search is not configured yet",
        });
      }

      const semanticResults = await searchBySemantic(supabase, query, scopeEventIds, limit);
      return NextResponse.json({
        type: "semantic",
        results: semanticResults,
        count: semanticResults.length,
      });
    }

    return NextResponse.json({ error: "Invalid search type" }, { status: 400 });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

/** Search by filename or parsed name (fast, exact-ish matching) */
async function searchByFilename(
  supabase: SupabaseDB,
  query: string,
  scopeEventIds: string[],
  limit: number
) {
  // Neutralize PostgREST filter metacharacters in the user's query so a comma
  // or paren can't perturb the .or() expression (can't broaden past the owned
  // scope — the .in() still ANDs — but keeps the filter well-formed).
  const safe = query.replace(/[,()\\%_]/g, " ").trim();
  const dbQuery = supabase
    .from("images")
    .select("id, event_id, original_filename, parsed_name, r2_key, aesthetic_score, stack_id, stack_rank")
    // Ownership scope: only the caller's events (never the whole archive).
    .in("event_id", scopeEventIds)
    .or(`original_filename.ilike.%${safe}%,parsed_name.ilike.%${safe}%`)
    .order("original_filename")
    .limit(limit);

  const { data, error } = await dbQuery;
  if (error) throw error;

  return Promise.all(
    (data || []).map(async (img: Record<string, unknown>) => {
      const r2Key = img.r2_key as string;
      const thumbKey = getThumbnailKey(r2Key);
      const [thumbnailUrl, originalUrl] = await Promise.all([
        getPresignedDownloadUrl(thumbKey, 14400),
        getPresignedDownloadUrl(r2Key, 14400),
      ]);
      return {
        id: img.id,
        eventId: img.event_id,
        filename: img.original_filename,
        parsedName: img.parsed_name,
        r2Key,
        thumbnailUrl,
        originalUrl,
        score: 1.0,
        stackId: img.stack_id,
        stackRank: img.stack_rank,
      };
    })
  );
}

/** Search by semantic similarity using CLIP embeddings */
async function searchBySemantic(
  supabase: SupabaseDB,
  query: string,
  scopeEventIds: string[],
  limit: number
) {
  // Get text embedding from Modal
  const embeddingResponse = await fetch(
    process.env.MODAL_API_URL + "/embed-text",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: query }),
    }
  );

  if (!embeddingResponse.ok) {
    throw new Error("Failed to generate text embedding");
  }

  const { embedding } = await embeddingResponse.json();

  // The RPC scopes to a single event; when searching across all the caller's
  // events we pass null and post-filter to the owned set below. Either way the
  // result set can never escape the caller's events. Because that post-filter
  // runs AFTER the RPC's match_count cap, over-fetch when spanning multiple
  // events so the caller's own matches aren't crowded out before scoping, then
  // truncate to the requested limit. (Semantic search is currently disabled —
  // MODAL_API_URL is unset — so this path is belt-and-suspenders.)
  const singleEvent = scopeEventIds.length === 1 ? scopeEventIds[0] : null;
  const fetchCount = singleEvent ? limit : Math.min(limit * 10, 2000);
  const { data, error } = await supabase.rpc("search_images_by_embedding", {
    query_embedding: embedding,
    target_event_id: singleEvent,
    match_threshold: 0.2,
    match_count: fetchCount,
  });

  if (error) throw error;

  const ownedSet = new Set(scopeEventIds);
  const scoped = (data || [])
    .filter((r: { event_id: string }) => ownedSet.has(r.event_id))
    .slice(0, limit);

  return Promise.all(
    scoped.map(async (result: { id: string; event_id: string; filename: string; original_filename: string; r2_key: string; similarity: number }) => {
      const thumbKey = getThumbnailKey(result.r2_key);
      const [thumbnailUrl, originalUrl] = await Promise.all([
        getPresignedDownloadUrl(thumbKey, 14400),
        getPresignedDownloadUrl(result.r2_key, 14400),
      ]);
      return {
        id: result.id,
        eventId: result.event_id,
        filename: result.original_filename,
        r2Key: result.r2_key,
        thumbnailUrl,
        originalUrl,
        score: result.similarity,
      };
    })
  );
}
