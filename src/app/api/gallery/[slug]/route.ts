import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { verifyPassword } from "@/lib/shares/hash";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
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
            authBranding = {
              businessName: authProfile.business_name,
              logoUrl: authProfile.logo_url,
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
      branding = {
        businessName: profile.business_name,
        logoUrl: profile.logo_url,
        website: profile.website,
        primaryColor: (b.primaryColor as string) || DEFAULT_BRANDING.primaryColor,
        secondaryColor: (b.secondaryColor as string) || DEFAULT_BRANDING.secondaryColor,
        accentColor: (b.accentColor as string) || DEFAULT_BRANDING.accentColor,
        backgroundColor: (b.backgroundColor as string) || DEFAULT_BRANDING.backgroundColor,
        logoPlacement: (b.logoPlacement as "left" | "center") || DEFAULT_BRANDING.logoPlacement,
        fontFamily: (b.fontFamily as string) || DEFAULT_BRANDING.fontFamily,
      };
    }

    // 5. Fetch images — filter to selection if share_type is 'selection'
    let imagesQuery = supabase
      .from("images")
      .select("id, r2_key, original_filename, parsed_name, width, height, aesthetic_score")
      .eq("event_id", share.event_id)
      .neq("processing_status", "error");

    if (share.share_type === "selection" && share.image_ids?.length) {
      imagesQuery = imagesQuery.in("id", share.image_ids);
    }

    const { data: rawImages, error: imagesError } = await imagesQuery.order(
      "created_at",
      { ascending: true }
    );

    if (imagesError) throw imagesError;

    // 5. Generate presigned URLs (thumbnail for grid, original for lightbox)
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const thumbKey = getThumbnailKey(img.r2_key);
        const urls = await Promise.all([
          getPresignedDownloadUrl(thumbKey, 14400),
          getPresignedDownloadUrl(img.r2_key, 14400),
          share.allow_download ? getPresignedDownloadUrl(img.r2_key, 3600) : Promise.resolve(null),
        ]);

        const result: Record<string, unknown> = {
          id: img.id,
          thumbnailUrl: urls[0],
          originalUrl: urls[1],
          originalFilename: img.original_filename,
          parsedName: img.parsed_name,
          width: img.width,
          height: img.height,
        };

        if (urls[2]) {
          result.downloadUrl = urls[2];
        }

        return result;
      })
    );

    // 6. Build gallery settings from event settings
    const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
    const cover = (eventSettings.cover ?? DEFAULT_EVENT_SETTINGS.cover) as { layout: string; imageId?: string };
    const typography = (eventSettings.typography ?? DEFAULT_EVENT_SETTINGS.typography) as { headingFont: string; bodyFont: string };
    const grid = (eventSettings.grid ?? DEFAULT_EVENT_SETTINGS.grid) as { columns: number; gap: string; style: string };

    const gallerySettings: GallerySettings = {
      coverLayout: cover.layout,
      headingFont: typography.headingFont,
      bodyFont: typography.bodyFont,
      gridStyle: grid.style as "masonry" | "uniform",
      gridColumns: grid.columns,
      gridGap: grid.gap as "tight" | "normal" | "loose",
    };

    // Generate presigned URL for cover image if set
    if (cover.imageId) {
      const coverImage = (rawImages || []).find((img) => img.id === cover.imageId);
      if (coverImage) {
        gallerySettings.coverImageUrl = await getPresignedDownloadUrl(coverImage.r2_key, 14400);
      }
    }

    // Smart Mosaic: select top 5 images by aesthetic score
    if (cover.layout === "mosaic") {
      const scored = (rawImages || [])
        .filter((img) => img.aesthetic_score != null)
        .sort(
          (a, b) =>
            ((b.aesthetic_score as number) ?? 0) -
            ((a.aesthetic_score as number) ?? 0)
        )
        .slice(0, 5);

      const mosaicSources =
        scored.length >= 3 ? scored : (rawImages || []).slice(0, 5);

      if (mosaicSources.length > 0) {
        gallerySettings.mosaicImageUrls = await Promise.all(
          mosaicSources.map((img) =>
            getPresignedDownloadUrl(img.r2_key, 14400)
          )
        );
      }
    }

    // 7. Fetch sections with their image assignments
    const { data: rawSections } = await supabase
      .from("sections")
      .select("id, name, description")
      .eq("event_id", share.event_id)
      .order("sort_order", { ascending: true });

    const imageIdSet = new Set((rawImages || []).map((img) => img.id));
    const sectionIds = (rawSections || []).map((s) => s.id);

    // Batch-fetch all section_images for these sections
    const { data: sectionImageRows } = sectionIds.length > 0
      ? await supabase
          .from("section_images")
          .select("section_id, image_id")
          .in("section_id", sectionIds)
      : { data: [] as { section_id: string; image_id: string }[] };

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
