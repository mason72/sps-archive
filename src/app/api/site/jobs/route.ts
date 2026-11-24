import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import {
  JOB_KEY_PREFIX,
  WORK_EVENT_SLUG,
  jobSlugFromKey,
  parseJobMeta,
  isJobComplete,
  serializeJob,
} from "@/lib/site/jobs";
import {
  SITE_ASSET_COLUMNS,
  serializeSiteAsset,
  type SiteAssetRow,
} from "@/lib/site/serialize";

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
 *  - `story` is sent only when PUBLISHED (drafts stay here), and never when an
 *    anonymized job's story names the client; `proof` is counts only, counted
 *    from the job's source galleries on save (src/lib/site/job-proof.ts)
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

    // The TDP Work gallery, by its server-generated unique slug. The key
    // prefix alone USED to scope this query, on the belief that job/ keys are
    // only assigned inside TDP Work, but that was decided by a client-writable
    // settings flag, so any account could put a job on the public site (pilot
    // audit, 2026-11-14). Both layers are now closed; this is the one that
    // still holds if a job key reaches some other gallery by a road not yet
    // thought of.
    const { data: workEvent, error: workError } = await supabase
      .from("events")
      .select("id")
      .eq("slug", WORK_EVENT_SLUG)
      .maybeSingle();
    if (workError) {
      console.error("Site jobs work-gallery lookup error:", workError);
      return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
    }
    if (!workEvent) {
      return NextResponse.json({ count: 0, jobs: [] }, { headers: { "Cache-Control": "private, max-age=300" } });
    }

    // Every job section, in the gallery's sidebar order.
    const { data: sections, error: sectionsError } = await supabase
      .from("sections")
      .select("id, site_scene_key, job_meta, sort_order")
      .eq("event_id", workEvent.id)
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
      images: SiteAssetRow;
    };

    // Paged: PostgREST answers at most 1,000 rows with no error, and past that
    // the newest jobs would silently lose their photos (and then vanish, as
    // "no published images"). Total order on the primary key so pages neither
    // skip nor repeat; complete only at a short page; any failed page fails
    // the request rather than serving a partial site.
    const rows: MemberRow[] = [];
    if (jobSections.length > 0) {
      const PAGE = 1000;
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("section_images")
          .select(`section_id, image_id, sort_order, images!inner(${SITE_ASSET_COLUMNS})`)
          .in("section_id", jobSections.map((s) => s.id))
          .eq("images.thumbnail_generated", true)
          .not("images.site_published_at", "is", null)
          .order("section_id", { ascending: true })
          .order("image_id", { ascending: true })
          .range(page * PAGE, page * PAGE + PAGE - 1);

        if (error) {
          console.error("Site jobs images query error:", error);
          return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
        }
        const got = (data ?? []) as unknown as MemberRow[];
        rows.push(...got);
        if (got.length < PAGE) break;
      }
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
        // Shared site-asset shape — image contract unchanged, videos add
        // kind/duration/posterUrl/videoUrl.
        // Job images never carry the upload filename (it often holds the
        // client's or a guest's name, "250423_a16z-4454.jpg",
        // "CaseyGraul_25-06-05_..."; the site does not read it), and an
        // anonymized job's images do not carry their gallery's name either.
        // Found by review 2026-11-23; the site was already whitelisting
        // image fields, so nothing reached visitors.
        const images = (rowsBySection.get(section.id) ?? []).map(({ images: img }) => ({
          ...serializeSiteAsset(img),
          name: null,
          ...(section.meta.anonymize ? { event: null } : {}),
        }));
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
