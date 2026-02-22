import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const eventId = searchParams.get("eventId") || undefined;
  const searchType = searchParams.get("type") || "auto";
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!query) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  const supabase = createServiceClient();

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
      // Semantic search: generate CLIP embedding for query text, then vector search
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
  supabase: ReturnType<typeof createServiceClient>,
  query: string,
  eventId: string | undefined,
  limit: number
) {
  let dbQuery = supabase
    .from("images")
    .select("id, event_id, original_filename, parsed_name, r2_key, aesthetic_score, stack_id, stack_rank")
    .eq("processing_status", "complete")
    .or(`original_filename.ilike.%${query}%,parsed_name.ilike.%${query}%`)
    .order("original_filename")
    .limit(limit);

  if (eventId) {
    dbQuery = dbQuery.eq("event_id", eventId);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;

  return (data || []).map((img: Record<string, unknown>) => ({
    id: img.id,
    eventId: img.event_id,
    filename: img.original_filename,
    parsedName: img.parsed_name,
    r2Key: img.r2_key,
    score: 1.0, // exact match
    stackId: img.stack_id,
    stackRank: img.stack_rank,
  }));
}

/** Search by semantic similarity using CLIP embeddings */
async function searchBySemantic(
  supabase: ReturnType<typeof createServiceClient>,
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

  return (data || []).map((result: { id: string; event_id: string; filename: string; original_filename: string; r2_key: string; similarity: number }) => ({
    id: result.id,
    eventId: result.event_id,
    filename: result.original_filename,
    r2Key: result.r2_key,
    score: result.similarity,
  }));
}
