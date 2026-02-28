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
export async function GET(request: NextRequest) {
  const { supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const eventId = searchParams.get("eventId") || undefined;
  const searchType = searchParams.get("type") || "auto";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!query) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  try {
    if (searchType === "filename" || searchType === "auto") {
      // Try filename search first
      const filenameResults = await searchByFilename(supabase, query, eventId, limit);

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

      const semanticResults = await searchBySemantic(supabase, query, eventId, limit);
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
  eventId: string | undefined,
  limit: number
) {
  let dbQuery = supabase
    .from("images")
    .select("id, event_id, original_filename, parsed_name, r2_key, aesthetic_score, stack_id, stack_rank")
    .or(`original_filename.ilike.%${query}%,parsed_name.ilike.%${query}%`)
    .order("original_filename")
    .limit(limit);

  if (eventId) {
    dbQuery = dbQuery.eq("event_id", eventId);
  }

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
  eventId: string | undefined,
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

  // Vector similarity search via Supabase RPC
  const { data, error } = await supabase.rpc("search_images_by_embedding", {
    query_embedding: embedding,
    target_event_id: eventId || null,
    match_threshold: 0.2,
    match_count: limit,
  });

  if (error) throw error;

  return Promise.all(
    (data || []).map(async (result: { id: string; event_id: string; filename: string; original_filename: string; r2_key: string; similarity: number }) => {
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
