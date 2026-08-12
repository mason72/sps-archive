import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { proposeHighlights } from "@/lib/highlights/propose";
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";
import {
  MAX_HIGHLIGHTS,
  MIN_HIGHLIGHTS,
  DEFAULT_HIGHLIGHTS,
} from "@/lib/highlights/limits";

/** Fitting the direction is a cold-start cost; give it room. */
export const maxDuration = 60;

/**
 * POST /api/events/[eventId]/highlights/propose
 *
 * Rank the event's moments and return a pool deeper than the ask, each moment
 * carrying every frame that collapsed into it so the review can swap within a
 * moment without another round trip.
 *
 * Proposes only. Nothing is written here — the section changes when the
 * photographer accepts, and not before.
 *
 * Body: { count?: number, coverage?: boolean }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: event, error: evErr } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      count?: number;
      coverage?: boolean;
    };
    const count = Math.max(
      MIN_HIGHLIGHTS,
      Math.min(MAX_HIGHLIGHTS, Math.round(body.count ?? DEFAULT_HIGHLIGHTS))
    );
    const coverage = body.coverage !== false;

    const result = await proposeHighlights(supabase, eventId, user.id, {
      count,
      coverage,
    });

    // Sign thumbnails here so the client renders through the normal grid.
    const proposals = await Promise.all(
      result.proposals.map(async (p) => ({
        momentId: p.momentId,
        rank: p.rank,
        chosenIndex: p.chosenIndex,
        frames: await Promise.all(
          p.frames.map(async (f) => ({
            id: f.id,
            r2Key: f.r2Key,
            thumbnailUrl: await getCachedThumbnailUrl(
              getThumbnailKey(f.r2Key, "thumb-md")
            ),
            thumbnailLgUrl: await getCachedThumbnailUrl(
              getThumbnailKey(f.r2Key, "thumb-lg")
            ),
            originalFilename: f.originalFilename,
            aestheticScore: null,
            sharpnessScore: null,
            stackId: null,
            stackRank: null,
            parsedName: null,
            processingStatus: f.processingStatus,
            width: f.width,
            height: f.height,
            createdAt: f.createdAt,
            takenAt: f.takenAt,
            focalX: f.focalX,
            focalY: f.focalY,
          }))
        ),
      }))
    );

    return NextResponse.json({
      proposals,
      totalMoments: result.totalMoments,
      ranker: result.ranker,
      trainedOnPicks: result.trainedOnPicks,
      count,
    });
  } catch (err) {
    await reportSystemError("highlights-propose", err, { eventId });
    return NextResponse.json(
      { error: "Could not choose highlights" },
      { status: 500 }
    );
  }
}
