import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * GET /api/people/identity-suggestions/[id]/photos — the photos behind one
 * "Who is this?" card: the anonymous face group's frames, and the named
 * person's frames the engine matched it against.
 *
 * Two small face crops cannot carry this decision (2026-09-30: a card offered
 * a HAND as "Vijaya Kumar Vegi" and nothing on it could be opened). The event
 * page's review modals read photos the page already holds; /people spans
 * galleries, so the review modal there asks for them here.
 *
 * Frames come best face first (quality-desc), so a group's clearest shot of
 * the person leads and its background glimpses trail. Capped per side: this
 * is a comparison, not a gallery. Crew suggestions return no reference side —
 * crew reference sets live in their own store and the card's crop covers it.
 */
const PER_SIDE = 48;

type Photo = { imageId: string; filename: string; thumbnailUrl: string; largeUrl: string };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // Service client: the ownership filter is the protection (CLAUDE.md, IDOR).
    const { data: suggestion, error } = await supabase
      .from("person_identity_suggestions")
      .select("id, person_id, matched_person_id, kind")
      .eq("id", id)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (error) throw error;
    if (!suggestion) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const photosOf = async (personId: string): Promise<{ total: number; photos: Photo[] }> => {
      const order: string[] = [];
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        const { data, error: fErr } = await supabase
          .from("faces")
          .select("id, image_id")
          .eq("person_id", personId)
          // Paged reads carry a unique tiebreak (lesson 88).
          .order("quality", { ascending: false, nullsFirst: false })
          .order("id")
          .range(page * 1000, page * 1000 + 999);
        if (fErr) throw fErr;
        for (const f of data ?? []) {
          if (!seen.has(f.image_id)) {
            seen.add(f.image_id);
            order.push(f.image_id);
          }
        }
        if (!data || data.length < 1000) break;
      }
      const shown = order.slice(0, PER_SIDE);
      if (shown.length === 0) return { total: 0, photos: [] };
      const { data: imgs, error: iErr } = await supabase
        .from("images")
        .select("id, r2_key, original_filename")
        .in("id", shown);
      if (iErr) throw iErr;
      const byId = new Map((imgs ?? []).map((img) => [img.id, img]));
      const photos = await Promise.all(
        shown
          .map((imageId) => byId.get(imageId))
          .filter((img): img is NonNullable<typeof img> => !!img)
          .map(async (img) => ({
            imageId: img.id,
            filename: img.original_filename ?? "",
            thumbnailUrl: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key), 14400),
            largeUrl: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key, "thumb-lg"), 14400),
          }))
      );
      return { total: order.length, photos };
    };

    const [cluster, reference] = await Promise.all([
      photosOf(suggestion.person_id),
      suggestion.kind === "guest" && suggestion.matched_person_id
        ? photosOf(suggestion.matched_person_id)
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      cluster: { personId: suggestion.person_id, ...cluster },
      reference: reference && { personId: suggestion.matched_person_id, ...reference },
    });
  } catch (error) {
    await reportSystemError("people.identity-suggestions.photos", error, { id });
    return NextResponse.json({ error: "Failed to load photos" }, { status: 500 });
  }
}
