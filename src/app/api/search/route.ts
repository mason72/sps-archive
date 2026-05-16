import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";

type SupabaseDB = AppSupabaseClient;

/**
 * GET /api/search?q=<query>&eventId=<optional>
 *
 * Filename + parsed-name search across the caller's archive.
 *
 * Semantic / visual-similarity search lives in the AI pipeline
 * (lib/ai) but is currently disabled at the boundary while the Modal
 * GPU infra is being re-evaluated. The old `?type=semantic` branch is
 * removed — it pointed at a non-existent `MODAL_API_URL/embed-text`
 * endpoint and 404'd in production anyway. The route still accepts
 * `type=auto|filename` for forward compatibility but always serves
 * filename results.
 */
export async function GET(request: NextRequest) {
  const { supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");
  const eventId = searchParams.get("eventId") || undefined;
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  if (!query) {
    return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
  }

  try {
    const results = await searchByFilename(supabase, query, eventId, limit);
    return NextResponse.json({
      type: "filename",
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

/**
 * Filename / parsed-name search. PostgREST .or() takes a comma-separated
 * filter expression; commas/parens in user input would break the parser,
 * so we strip them before interpolating.
 */
async function searchByFilename(
  supabase: SupabaseDB,
  query: string,
  eventId: string | undefined,
  limit: number
) {
  const sanitized = query.replace(/[,()]/g, " ").trim();
  if (!sanitized) return [];

  // RLS scopes images to the caller's events automatically; no need for an
  // explicit user_id filter.
  let dbQuery = supabase
    .from("images")
    .select(
      "id, event_id, original_filename, parsed_name, r2_key, aesthetic_score, stack_id, stack_rank"
    )
    .or(
      `original_filename.ilike.%${sanitized}%,parsed_name.ilike.%${sanitized}%`
    )
    .order("original_filename")
    .limit(limit);

  if (eventId) {
    dbQuery = dbQuery.eq("event_id", eventId);
  }

  const { data, error } = await dbQuery;
  if (error) throw error;

  return Promise.all(
    (data || []).map(async (img) => {
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
