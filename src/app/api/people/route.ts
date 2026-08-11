import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { buildPeopleIndex } from "@/lib/people/index-people";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/people — the archive-wide people index for the signed-in
 * photographer (their own events only; getAuthUser hands back the SERVICE
 * client, so the ownership filter inside buildPeopleIndex is the boundary).
 *
 * Internal by design: this aggregates named faces across clients, which is
 * exactly the shape you never expose publicly.
 */
export const dynamic = "force-dynamic";
// A full-archive scan (20k+ rows) plus presigning; comfortably under this.
export const maxDuration = 60;

export async function GET() {
  const { user, supabase, error } = await getAuthUser();
  if (error) return error;

  try {
    const people = await buildPeopleIndex(supabase, user!.id);

    // Presign hero thumbnails only — one per person, not per appearance.
    const withHeroes = await Promise.all(
      people.map(async (p) => ({
        ...p,
        heroUrl: p.heroKey
          ? await getPresignedDownloadUrl(getThumbnailKey(p.heroKey), 14400)
          : null,
        events: await Promise.all(
          p.events.map(async (e) => ({
            ...e,
            heroUrl: e.heroKey
              ? await getPresignedDownloadUrl(getThumbnailKey(e.heroKey), 14400)
              : null,
          }))
        ),
      }))
    );

    return NextResponse.json({
      people: withHeroes,
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
