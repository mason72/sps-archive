import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { FILL_PAGE, loadFillJob, pickSource } from "@/lib/site/fill";
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";

/**
 * GET /api/fill/[sectionId]/photos?source=<eventId>&offset=<n>
 *
 * "Show all": every photo of one of the job's source galleries, a page at a
 * time, in shooting order. The ranked shortlist covers most picks; this is the
 * way out when the photographer knows the frame they want.
 *
 * Ordered on a unique column last (id), so paging neither repeats nor skips.
 */
export async function GET(
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

    const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") || "0", 10) || 0);
    const { data, error } = await supabase
      .from("images")
      .select("id, r2_key, site_published_at")
      .eq("event_id", source.eventId)
      .eq("is_cover_upload", false)
      .order("taken_at", { ascending: true, nullsFirst: false })
      .order("original_filename", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + FILL_PAGE - 1);
    if (error) throw error;

    const photos = await Promise.all(
      (data ?? []).map(async (r) => ({
        id: r.id as string,
        thumbnailUrl: await getCachedThumbnailUrl(getThumbnailKey(r.r2_key as string, "thumb-md")),
        thumbnailLgUrl: await getCachedThumbnailUrl(getThumbnailKey(r.r2_key as string, "thumb-lg")),
        onSite: !!r.site_published_at,
      }))
    );
    const nextOffset = offset + photos.length < source.photoCount && photos.length === FILL_PAGE
      ? offset + photos.length
      : null;
    return NextResponse.json({ photos, nextOffset, total: source.photoCount });
  } catch (error) {
    await reportSystemError("fill.photos", error, { sectionId });
    return NextResponse.json({ error: "Could not load photos" }, { status: 500 });
  }
}
