import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";

/**
 * GET /api/gallery/preview/[eventId]
 *
 * Owner-only preview — returns GalleryData shape without requiring a share.
 * Auth-gated: only the event owner can access.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // 1. Fetch event — verify ownership
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, name, event_date, user_id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // 2. Fetch photographer branding
    let branding: GalleryBranding | null = null;
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, business_name, logo_url, website, branding")
      .eq("user_id", user!.id)
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

    // 3. Fetch all images for this event (paginated to avoid 1000-row limit)
    const PREVIEW_IMG_FIELDS = "id, r2_key, original_filename, parsed_name, width, height, aesthetic_score";
    const PREVIEW_PAGE_SIZE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawImages: any[] = [];
    let previewOffset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error: pageError } = await supabase
        .from("images")
        .select(PREVIEW_IMG_FIELDS)
        .eq("event_id", eventId)
        .eq("processing_status", "complete")
        .order("created_at", { ascending: true })
        .range(previewOffset, previewOffset + PREVIEW_PAGE_SIZE - 1);

      if (pageError) throw pageError;
      if (!data || data.length === 0) break;
      rawImages = rawImages.concat(data);
      if (data.length < PREVIEW_PAGE_SIZE) break;
      previewOffset += PREVIEW_PAGE_SIZE;
    }

    // 4. Generate presigned URLs
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const thumbKey = getThumbnailKey(img.r2_key);
        const [thumbnailUrl, originalUrl] = await Promise.all([
          getPresignedDownloadUrl(thumbKey, 14400),
          getPresignedDownloadUrl(img.r2_key, 14400),
        ]);

        return {
          id: img.id,
          thumbnailUrl,
          originalUrl,
          originalFilename: img.original_filename,
          parsedName: img.parsed_name,
          width: img.width,
          height: img.height,
        };
      })
    );

    // 5. Build gallery settings from event settings
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

    return NextResponse.json({
      eventName: event.name,
      eventDate: event.event_date,
      customMessage: null,
      allowDownload: true,
      allowFavorites: false,
      requirePinBulk: false,
      requirePinIndividual: false,
      images,
      shareId: `preview-${eventId}`,
      branding,
      settings: gallerySettings,
    });
  } catch (error) {
    console.error("Preview gallery error:", error);
    return NextResponse.json(
      { error: "Failed to load preview" },
      { status: 500 }
    );
  }
}
