import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { buildPersonDetail } from "@/lib/people/index-people";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/people/detail?name=Jeff%20Roark
 *
 * Every photo of one person across the whole archive — the payload behind the
 * spotlight on /people. Lives at /detail rather than /[key] because
 * /api/people/[personId] is already the cluster-rename route, and a name key
 * arriving where a UUID is expected is the kind of collision that only shows
 * up in production.
 *
 * Internal, owner-scoped: `buildPersonDetail` filters events by user_id, which
 * is the boundary — getAuthUser hands back the SERVICE client.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { user, supabase, error } = await getAuthUser();
  if (error) return error;

  const name = request.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }

  try {
    const person = await buildPersonDetail(supabase, user!.id, name);
    if (!person) {
      return NextResponse.json({ error: "No photos for that name" }, { status: 404 });
    }

    const events = await Promise.all(
      person.events.map(async (e) => ({
        eventId: e.eventId,
        eventName: e.eventName,
        eventDate: e.eventDate,
        imageCount: e.images.length,
        images: await Promise.all(
          e.images.map(async (img) => ({
            id: img.id,
            filename: img.filename,
            thumbnailUrl: await getPresignedDownloadUrl(
              getThumbnailKey(img.r2Key),
              14400
            ),
          }))
        ),
      }))
    );

    return NextResponse.json({
      key: person.key,
      name: person.name,
      imageCount: person.imageCount,
      events,
    });
  } catch (err) {
    await reportSystemError("people.detail", err, { userId: user!.id, name });
    return NextResponse.json(
      { error: "Couldn't load that person" },
      { status: 500 }
    );
  }
}
