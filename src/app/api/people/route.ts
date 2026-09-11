import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPeopleIndex, heroUrlsFor } from "@/lib/people/index-cache";
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/people — the archive-wide people index for the signed-in
 * photographer (their own events only; getAuthUser hands back the SERVICE
 * client, so the ownership filter inside buildPeopleIndex is the boundary).
 * Served from the same R2 snapshot as /people (src/lib/people/index-cache.ts).
 *
 * Internal by design: this aggregates named faces across clients, which is
 * exactly the shape you never expose publicly.
 */
export const dynamic = "force-dynamic";
// A cold build is a full-archive scan; a warm read is one R2 object.
export const maxDuration = 60;

export async function GET() {
  const { user, supabase, error } = await getAuthUser();
  if (error) return error;

  try {
    const { people, builtAt } = await getPeopleIndex(supabase, user!.id);

    const withHeroes = await Promise.all(
      people.map(async (p) => ({
        ...p,
        heroUrl: p.heroKey ? (await heroUrlsFor(p.heroKey)).md : null,
        events: await Promise.all(
          p.events.map(async (e) => ({
            ...e,
            heroUrl: e.heroKey
              ? await getCachedThumbnailUrl(getThumbnailKey(e.heroKey), 14400)
              : null,
          }))
        ),
      }))
    );

    return NextResponse.json({
      people: withHeroes,
      builtAt: new Date(builtAt).toISOString(),
      totals: {
        people: withHeroes.length,
        repeat: withHeroes.filter((p) => p.eventCount >= 2).length,
      },
    });
  } catch (err) {
    await reportSystemError("people.index", err, { userId: user!.id });
    return NextResponse.json(
      { error: "Couldn't build the people index" },
      { status: 500 }
    );
  }
}
