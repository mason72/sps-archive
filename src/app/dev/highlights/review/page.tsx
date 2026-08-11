import { ReviewPlayground } from "./ReviewPlayground";
import type { HighlightProposal } from "@/components/events/HighlightsReview";
import { MAX_HIGHLIGHTS } from "@/lib/highlights/limits";

/**
 * Review-screen playground, driven by real frames from the Jordan x Kids Foot
 * Locker event so the burst-swap interaction is exercised against moments that
 * genuinely have siblings.
 *
 * /dev is on the middleware's PUBLIC list, so this route is reachable without a
 * session. Real customer thumbnails must therefore never be fetched outside
 * local development — the gate is on NODE_ENV explicitly, never on "is the data
 * missing", which would be true in production too and would fail open.
 */
export const dynamic = "force-dynamic";

const EVENT = "e8459f76-1212-461e-9078-cdc6e945e68c";

async function loadRealProposals(): Promise<{
  proposals: HighlightProposal[];
  totalMoments: number;
} | null> {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const { getCachedThumbnailUrl, getThumbnailKey } = await import(
    "@/lib/r2/client"
  );
  const supabase = createServiceClient();

  const { data: images } = await supabase
    .from("images")
    .select(
      "id, r2_key, taken_at, width, height, original_filename, processing_status, created_at, focal_x, focal_y"
    )
    .eq("event_id", EVENT)
    .not("taken_at", "is", null)
    .order("taken_at")
    .limit(1000);
  if (!images?.length) return null;

  // Same grouping rule the generator uses: exact capture time. On a
  // fixed-backdrop shoot embedding similarity cannot separate duplicate
  // renditions from unrelated frames (0.918 vs 0.915 median cosine).
  const byTime = new Map<string, typeof images>();
  for (const img of images) {
    const k = img.taken_at as string;
    if (!byTime.has(k)) byTime.set(k, []);
    byTime.get(k)!.push(img);
  }

  // Rank: the published Highlights order first, everything else behind it.
  const { data: section } = await supabase
    .from("sections")
    .select("id")
    .eq("event_id", EVENT)
    .eq("name", "Highlights")
    .single();
  const rankByImage = new Map<string, number>();
  if (section) {
    const { data: members } = await supabase
      .from("section_images")
      .select("image_id, sort_order")
      .eq("section_id", section.id);
    for (const m of members ?? [])
      rankByImage.set(m.image_id as string, (m.sort_order as number) ?? 999);
  }

  const moments = [...byTime.entries()].map(([takenAt, frames]) => {
    const ranked = frames
      .map((f) => rankByImage.get(f.id))
      .filter((v): v is number => v != null);
    return {
      takenAt,
      frames,
      rank: ranked.length ? Math.min(...ranked) : 9999,
    };
  });
  moments.sort((a, b) => a.rank - b.rank || a.takenAt.localeCompare(b.takenAt));

  // Deeper than the slider max so dismissals can always backfill and the
  // 100-highlight ceiling is actually reachable.
  const pool = moments.slice(0, MAX_HIGHLIGHTS + 40);

  const proposals: HighlightProposal[] = await Promise.all(
    pool.map(async (m, i) => {
      const chosenIndex = Math.max(
        0,
        m.frames.findIndex((f) => rankByImage.has(f.id))
      );
      // Real ImageData: the review renders through the section's own grid, so
      // it needs the same shape the event API hands it — natural dimensions and
      // the focal point included, since those are what keep faces safe.
      const frames = await Promise.all(
        m.frames.map(async (f) => ({
          id: f.id,
          r2Key: f.r2_key as string,
          thumbnailUrl: await getCachedThumbnailUrl(
            getThumbnailKey(f.r2_key as string, "thumb-md")
          ),
          thumbnailLgUrl: await getCachedThumbnailUrl(
            getThumbnailKey(f.r2_key as string, "thumb-lg")
          ),
          originalFilename: (f.original_filename as string) ?? "",
          aestheticScore: null,
          sharpnessScore: null,
          stackId: null,
          stackRank: null,
          parsedName: null,
          processingStatus: (f.processing_status as string) ?? "complete",
          width: f.width,
          height: f.height,
          createdAt: (f.created_at as string) ?? new Date(0).toISOString(),
          takenAt: f.taken_at as string | null,
          focalX: f.focal_x as number | null,
          focalY: f.focal_y as number | null,
        }))
      );
      return { momentId: m.takenAt, rank: i + 1, frames, chosenIndex };
    })
  );

  return { proposals, totalMoments: moments.length };
}

export default async function DevHighlightsReviewPage() {
  const isLocal = process.env.NODE_ENV === "development";
  const real = isLocal ? await loadRealProposals() : null;

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-8 py-12">
        <h1 className="font-editorial text-3xl text-stone-900 italic">
          Highlights review
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-stone-500">
          {real
            ? "Real frames from the Foot Locker event. Cut a tile and the next-best backfills; open a frame badge to swap within the moment."
            : "Real frames load in local development only — this route is publicly reachable, so customer photos stay off it everywhere else."}
        </p>
      </div>

      {real ? (
        <ReviewPlayground
          proposals={real.proposals}
          totalMoments={real.totalMoments}
        />
      ) : (
        <p className="mx-auto max-w-6xl px-8 pb-24 font-editorial text-lg text-stone-400 italic">
          Run locally to see it with photographs.
        </p>
      )}
    </div>
  );
}
