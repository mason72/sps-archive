import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import {
  JOB_KEY_PREFIX,
  jobSlugFromKey,
  parseJobMeta,
  isJobComplete,
  serializeJob,
} from "@/lib/site/jobs";
import { getPublicLaneUrl } from "@/lib/r2/public-lane";
import { publicLaneKeys } from "@/lib/site/publish";

/**
 * GET /api/site/jobs
 *
 * Site-facing endpoint for the Two Dudes Photo website's job-based Featured
 * Work. Each section of the "TDP Work" gallery (site_scene_key = "job/<slug>")
 * is one job; this returns them in section order (= the order jobs lead on
 * the site), each with its job-sheet metadata and its images in drag order —
 * the FIRST image is the job's cover. Image objects are the exact shape the
 * scene API returns (public non-expiring URLs, width/height, focal points).
 *
 * Contract guarantees:
 *  - anonymized jobs return alias and a NULL client — the client name never
 *    leaves the server (enforced in serializeJob)
 *  - jobs missing required metadata or without a published image are omitted
 *    (the site's Job type needs the required fields non-null)
 *  - only published images are served (site_published_at gate), same as scenes
 *
 * Auth: shared secret header `X-SPS-Key: <SPS_INTEGRATION_KEY>` — and the
 * response must stay `private` for the same reason as the scene API (shared
 * caches don't key on X-SPS-Key).
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifySharedSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized. Provide X-SPS-Key header." },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Every job section, in the gallery's sidebar order. The job/ namespace
    // is only ever assigned inside the TDP Work gallery (sections POST), so
    // the key prefix alone scopes this query.
    const { data: sections, error: sectionsError } = await supabase
      .from("sections")
      .select("id, site_scene_key, job_meta, sort_order")
      .like("site_scene_key", `${JOB_KEY_PREFIX}%`)
      .order("sort_order", { ascending: true });

    if (sectionsError) {
      console.error("Site jobs sections query error:", sectionsError);
      return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
    }

    const jobSections = (sections ?? [])
      .map((s) => ({
        id: s.id,
        slug: jobSlugFromKey(s.site_scene_key as string),
        meta: parseJobMeta(s.job_meta),
      }))
      // Draft jobs (incomplete metadata) stay editor-only.
      .filter((s) => isJobComplete(s.meta));

    type MemberRow = {
      section_id: string;
      sort_order: number;
      images: {
        id: string;
        r2_key: string;
        width: number | null;
        height: number | null;
        service: string | null;
        featured: boolean;
        created_at: string;
        focal_x: number | null;
        focal_y: number | null;
        events: { name: string | null; city: string | null } | null;
      };
    };

    let rows: MemberRow[] = [];
    if (jobSections.length > 0) {
      const { data, error } = await supabase
        .from("section_images")
        .select(
          "section_id, sort_order, images!inner(id, r2_key, width, height, service, featured, created_at, focal_x, focal_y, events!event_id(name, city))"
        )
        .in("section_id", jobSections.map((s) => s.id))
        .eq("images.thumbnail_generated", true)
        .not("images.site_published_at", "is", null);

      if (error) {
        console.error("Site jobs images query error:", error);
        return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
      }
      rows = (data ?? []) as unknown as MemberRow[];
    }

    // Exact drag order within each job (cover = position 1); newest-first as
    // a stable tiebreak. No featured boost — a job gallery is a curated
    // sequence, like ordered scenes.
    const rowsBySection = new Map<string, MemberRow[]>();
    for (const row of rows) {
      const arr = rowsBySection.get(row.section_id);
      if (arr) arr.push(row);
      else rowsBySection.set(row.section_id, [row]);
    }
    for (const arr of rowsBySection.values()) {
      arr.sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return b.images.created_at.localeCompare(a.images.created_at);
      });
    }

    const jobs = jobSections
      .map((section) => {
        const images = (rowsBySection.get(section.id) ?? []).map(
          ({ images: img }) => {
            const event = img.events ?? { name: null, city: null };
            const { thumbKey, displayKey } = publicLaneKeys(img.r2_key);
            return {
              id: img.id,
              event: event.name ?? null,
              city: event.city ?? null,
              service: img.service ?? null,
              featured: img.featured ?? false,
              width: img.width,
              height: img.height,
              thumbUrl: getPublicLaneUrl(thumbKey),
              fullUrl: getPublicLaneUrl(displayKey),
              focalX: img.focal_x ?? null,
              focalY: img.focal_y ?? null,
            };
          }
        );
        return { ...serializeJob(section.slug, section.meta), images };
      })
      // A job with no published images yet has nothing to show — omit it.
      .filter((job) => job.images.length > 0);

    return NextResponse.json(
      { count: jobs.length, jobs },
      // `private` is load-bearing — see the scene route: Vercel's edge cache
      // doesn't key on X-SPS-Key, so a shared-cacheable 200 would leak to
      // unauthenticated requests.
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    console.error("Site jobs error:", err);
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
  }
}
