import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getCachedThumbnailUrl, getThumbnailKey, getDisplayKey, getCachedDownloadUrl } from "@/lib/r2/client";
import { verifyPassword } from "@/lib/shares/hash";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";
import { DEFAULT_EVENT_SETTINGS, normalizeCoverSettings } from "@/types/event-settings";
import { coverGalleryFields } from "@/lib/cover/payload";
import { logActivity } from "@/lib/analytics/log";

/**
 * GET /api/gallery/[slug]
 *
 * Public endpoint — resolves a share slug to gallery data.
 * Uses service client (bypasses RLS) since this is a public route.
 *
 * If share is password-protected and no valid auth cookie exists,
 * returns { requiresAuth: true } without images.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = createServiceClient();

    // 1. Resolve slug → share
    const { data: share, error: shareError } = await supabase
      .from("shares")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (shareError || !share) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    // Check expiration
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "This gallery link has expired" }, { status: 410 });
    }

    // 2. Check password protection
    if (share.password_hash) {
      const authCookie = request.cookies.get(`gallery_auth_${slug}`);
      if (!authCookie || authCookie.value !== share.id) {
        // Return minimal data — client needs to authenticate
        // Include branding so the password gate looks branded
        const { data: authEvent } = await supabase
          .from("events")
          .select("name, user_id")
          .eq("id", share.event_id)
          .single();

        let authBranding: GalleryBranding | null = null;
        if (authEvent) {
          const { data: authProfile } = await supabase
            .from("user_profiles")
            .select("business_name, logo_url, website, branding")
            .eq("user_id", authEvent.user_id)
            .single();

          if (authProfile) {
            const ab = (authProfile.branding ?? {}) as Record<string, unknown>;
            // Presign logo URL if it's an R2 key
            const presignedLogoUrl = authProfile.logo_url
              ? authProfile.logo_url.startsWith("branding/")
                ? await getPresignedDownloadUrl(authProfile.logo_url, 86400)
                : authProfile.logo_url
              : null;
            authBranding = {
              businessName: authProfile.business_name,
              logoUrl: presignedLogoUrl,
              website: authProfile.website,
              primaryColor: (ab.primaryColor as string) || DEFAULT_BRANDING.primaryColor,
              secondaryColor: (ab.secondaryColor as string) || DEFAULT_BRANDING.secondaryColor,
              accentColor: (ab.accentColor as string) || DEFAULT_BRANDING.accentColor,
              backgroundColor: (ab.backgroundColor as string) || DEFAULT_BRANDING.backgroundColor,
              logoPlacement: (ab.logoPlacement as "left" | "center") || DEFAULT_BRANDING.logoPlacement,
              fontFamily: (ab.fontFamily as string) || DEFAULT_BRANDING.fontFamily,
            };
          }
        }

        return NextResponse.json({
          requiresAuth: true,
          eventName: authEvent?.name || "Gallery",
          customMessage: share.custom_message,
          branding: authBranding,
        });
      }
    }

    // 3. Fetch event + owner for branding + settings
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("name, event_date, user_id, settings")
      .eq("id", share.event_id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // 4. Fetch photographer branding
    let branding: GalleryBranding | null = null;
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, business_name, logo_url, website, branding")
      .eq("user_id", event.user_id)
      .single();

    if (profile) {
      const b = (profile.branding ?? {}) as Record<string, unknown>;
      // Presign logo URL if it's an R2 key
      const presignedLogoUrl = profile.logo_url
        ? profile.logo_url.startsWith("branding/")
          ? await getPresignedDownloadUrl(profile.logo_url, 86400)
          : profile.logo_url
        : null;
      branding = {
        businessName: profile.business_name,
        logoUrl: presignedLogoUrl,
        website: profile.website,
        primaryColor: (b.primaryColor as string) || DEFAULT_BRANDING.primaryColor,
        secondaryColor: (b.secondaryColor as string) || DEFAULT_BRANDING.secondaryColor,
        accentColor: (b.accentColor as string) || DEFAULT_BRANDING.accentColor,
        backgroundColor: (b.backgroundColor as string) || DEFAULT_BRANDING.backgroundColor,
        logoPlacement: (b.logoPlacement as "left" | "center") || DEFAULT_BRANDING.logoPlacement,
        fontFamily: (b.fontFamily as string) || DEFAULT_BRANDING.fontFamily,
      };
    }

    // 5. Fetch images — paginated to avoid Supabase 1000-row default limit
    const IMG_FIELDS = "id, r2_key, original_filename, parsed_name, width, height, aesthetic_score, taken_at, dominant_color";
    const IMG_PAGE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawImages: any[] = [];
    let imgOffset = 0;

    // Determine sort order from event settings
    const gridSort = (((event.settings as Record<string, unknown>)?.grid ?? {}) as Record<string, unknown>).sortBy as string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let pageQuery = supabase
        .from("images")
        .select(IMG_FIELDS)
        .eq("event_id", share.event_id)
        // An image is displayable once its thumbnail exists — NOT once the AI
        // pipeline finishes. processing_status tracks the (currently hidden)
        // Modal AI step (CLIP/faces/aesthetic); when that step fails or is
        // skipped, the photo is still fully viewable. Gating on
        // processing_status='complete' silently hid every photo whose AI step
        // failed, dropping whole sections from client galleries.
        .eq("thumbnail_generated", true);

      // Apply sort order from event settings
      if (gridSort === "filename") {
        pageQuery = pageQuery.order("original_filename", { ascending: true });
      } else if (gridSort === "date-taken") {
        pageQuery = pageQuery.order("taken_at", { ascending: true, nullsFirst: false });
      } else {
        pageQuery = pageQuery.order("created_at", { ascending: true });
      }

      pageQuery = pageQuery.range(imgOffset, imgOffset + IMG_PAGE - 1);

      if (share.share_type === "selection" && share.image_ids?.length) {
        pageQuery = pageQuery.in("id", share.image_ids);
      }

      const { data, error: pageError } = await pageQuery;
      if (pageError) throw pageError;
      if (!data || data.length === 0) break;
      rawImages = rawImages.concat(data);
      if (data.length < IMG_PAGE) break;
      imgOffset += IMG_PAGE;
    }

    // 5a. Save cover image data before excluding from gallery grid
    const cover = normalizeCoverSettings(
      ((event.settings ?? {}) as Record<string, unknown>).cover
    );
    const coverImageId = cover.imageId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coverImageRow = coverImageId ? rawImages.find((img: any) => img.id === coverImageId) : null;
    if (coverImageId) {
      rawImages = rawImages.filter((img) => img.id !== coverImageId);
    }

    // 5b. Generate presigned URLs (grid thumbnails at 400px + 800px for
    // srcset, original for lightbox). Thumbnails use the presign memo so
    // repeat visits within a session keep cache-friendly, stable URLs.
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const urls = await Promise.all([
          getCachedThumbnailUrl(getThumbnailKey(img.r2_key)),
          getCachedThumbnailUrl(getThumbnailKey(img.r2_key, "thumb-lg")),
          // Lightbox/full view: web-viewable original, or the 800px JPEG for
          // non-renderable formats (TIFF). Download still gets the raw original.
          getCachedDownloadUrl(getDisplayKey(img.r2_key), 14400),
          share.allow_download
            ? getCachedDownloadUrl(
                img.r2_key,
                3600,
                img.original_filename || "image"
              )
            : Promise.resolve(null),
        ]);

        const result: Record<string, unknown> = {
          id: img.id,
          thumbnailUrl: urls[0],
          thumbnailLgUrl: urls[1],
          originalUrl: urls[2],
          originalFilename: img.original_filename,
          parsedName: img.parsed_name,
          width: img.width,
          height: img.height,
          dominantColor: img.dominant_color ?? null,
          takenAt: img.taken_at,
        };

        if (urls[3]) {
          result.downloadUrl = urls[3];
        }

        return result;
      })
    );

    // 6. Build gallery settings from event settings
    const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
    const typography = (eventSettings.typography ?? DEFAULT_EVENT_SETTINGS.typography) as { headingFont: string; bodyFont: string };
    const color = (eventSettings.color ?? DEFAULT_EVENT_SETTINGS.color) as { primary: string; secondary: string; accent: string; background: string };
    const grid = (eventSettings.grid ?? DEFAULT_EVENT_SETTINGS.grid) as { columns: number; gap: string; style: string; smartStacks?: boolean };

    const gallerySettings: GallerySettings = {
      ...(await coverGalleryFields(cover)),
      headingFont: typography.headingFont,
      bodyFont: typography.bodyFont,
      colorPrimary: color.primary,
      colorSecondary: color.secondary,
      colorAccent: color.accent,
      colorBackground: color.background,
      gridStyle: grid.style as "masonry" | "uniform",
      gridColumns: grid.columns,
      gridGap: grid.gap as "tight" | "normal" | "loose",
      // The admin's sort choice — the client seeds its sort dropdown from this
      // (the image ordering above only affects the payload order, which manual
      // section order would otherwise override).
      gridSort: (["manual", "upload", "filename", "date-taken"].includes(gridSort ?? "")
        ? gridSort
        : "manual") as GallerySettings["gridSort"],
      smartStacks: grid.smartStacks === true,
      favoriteMilestones:
        ((eventSettings.sharing ?? {}) as { favoriteMilestones?: boolean })
          .favoriteMilestones !== false,
    };

    // Generate presigned URL for cover image if cover is enabled
    if (cover.enabled && cover.imageId && coverImageRow) {
      gallerySettings.coverImageUrl = await getPresignedDownloadUrl(coverImageRow.r2_key, 14400);
    }

    // 7. Fetch sections with their image assignments
    const { data: rawSections } = await supabase
      .from("sections")
      .select("id, name, description")
      .eq("event_id", share.event_id)
      .order("sort_order", { ascending: true });

    const imageIdSet = new Set((rawImages || []).map((img) => img.id));
    const sectionIds = (rawSections || []).map((s) => s.id);

    // Batch-fetch all section_images for these sections. MUST paginate —
    // Supabase caps a single select at 1000 rows, and a large event easily has
    // more links than that. Without paging, sections past the cap lost their
    // members (showed partial counts, or vanished via the length>0 filter).
    const sectionImageRows: { section_id: string; image_id: string }[] = [];
    if (sectionIds.length > 0) {
      const SI_PAGE = 1000;
      for (let off = 0; ; off += SI_PAGE) {
        const { data: page } = await supabase
          .from("section_images")
          // Manual (drag) order lives in sort_order; order by it so each
          // section's imageIds arrive in the photographer's arrangement. The
          // image_id tiebreaker keeps pagination deterministic across pages.
          .select("section_id, image_id")
          .in("section_id", sectionIds)
          .order("sort_order", { ascending: true })
          .order("image_id", { ascending: true })
          .range(off, off + SI_PAGE - 1);
        if (!page || page.length === 0) break;
        sectionImageRows.push(...page);
        if (page.length < SI_PAGE) break;
      }
    }

    // Group image IDs by section, filtering to images in this gallery
    const sectionImageMap = new Map<string, string[]>();
    for (const row of sectionImageRows || []) {
      if (!imageIdSet.has(row.image_id)) continue;
      const arr = sectionImageMap.get(row.section_id) || [];
      arr.push(row.image_id);
      sectionImageMap.set(row.section_id, arr);
    }

    const sections = (rawSections || [])
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        imageIds: sectionImageMap.get(s.id) || [],
      }))
      .filter((s) => s.imageIds.length > 0);

    // 8. Increment view count + log activity (deferred until after response)
    after(async () => {
      const svc = createServiceClient();
      await svc.rpc("increment_share_views", { p_share_id: share.id });
      logActivity({
        userId: event.user_id,
        action: "share_view",
        eventId: share.event_id,
        shareId: share.id,
      });
    });

    return NextResponse.json({
      eventName: event.name,
      eventDate: event.event_date,
      customMessage: share.custom_message,
      allowDownload: share.allow_download,
      allowFavorites: share.allow_favorites,
      requirePinBulk: share.require_pin_bulk ?? false,
      requirePinIndividual: share.require_pin_individual ?? false,
      images,
      sections: sections.length > 0 ? sections : undefined,
      shareId: share.id,
      branding,
      settings: gallerySettings,
    });
  } catch (error) {
    console.error("Gallery error:", error);
    return NextResponse.json({ error: "Failed to load gallery" }, { status: 500 });
  }
}
