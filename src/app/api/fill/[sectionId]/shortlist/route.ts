import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { FILL_SHORTLIST, loadFillJob, pickSource } from "@/lib/site/fill";
import { proposeHighlights } from "@/lib/highlights/propose";
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";

/** Same headroom as the Highlights propose route: a cold ranker can be slow. */
export const maxDuration = 300;

/**
 * POST /api/fill/[sectionId]/shortlist?source=<eventId>
 *
 * The source gallery's best photos, ranked by the Highlights ranker: on a
 * headshot gallery by likeness to the owner's curated website headshots (the
 * path Mason approved 2026-11-23), otherwise by the learned taste; the rule
 * bans and one-frame-per-person apply. One frame per moment (the ranker's
 * chosen one). Proposes only; nothing is written. POST because it is
 * expensive and must never be prefetched.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const load = await loadFillJob(supabase, user.id, sectionId);
    if (!load.ok) return NextResponse.json({ error: load.error }, { status: load.status });
    const source = pickSource(load.job, request.nextUrl.searchParams.get("source"));
    if (!source) return NextResponse.json({ error: "Source gallery not found" }, { status: 404 });

    const result = await proposeHighlights(supabase, source.eventId, user.id, {
      count: FILL_SHORTLIST,
      coverage: true,
      poolExtra: 0,
    });
    const frames = result.proposals
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.frames[p.chosenIndex] ?? p.frames[0])
      .filter((f): f is NonNullable<typeof f> => !!f);

    const onSite = new Set<string>();
    if (frames.length) {
      const { data, error } = await supabase
        .from("images")
        .select("id")
        .in("id", frames.map((f) => f.id))
        .not("site_published_at", "is", null);
      if (error) throw error;
      for (const r of data ?? []) onSite.add(r.id as string);
    }

    const photos = await Promise.all(
      frames.map(async (f) => ({
        id: f.id,
        thumbnailUrl: await getCachedThumbnailUrl(getThumbnailKey(f.r2Key, "thumb-md")),
        thumbnailLgUrl: await getCachedThumbnailUrl(getThumbnailKey(f.r2Key, "thumb-lg")),
        onSite: onSite.has(f.id),
      }))
    );
    return NextResponse.json({ photos, ranker: result.ranker });
  } catch (error) {
    await reportSystemError("fill.shortlist", error, { sectionId });
    return NextResponse.json({ error: "Could not rank this gallery" }, { status: 500 });
  }
}
