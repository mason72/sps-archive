import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import {
  gallerySessionCookieName,
  verifyGallerySession,
} from "@/lib/shares/session";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";
import { DEFAULT_EVENT_SETTINGS } from "@/types/event-settings";
import { logActivity } from "@/lib/analytics/log";

/**
 * GET /api/gallery/[slug]
 *
 * Public endpoint — resolves a share slug to gallery data. Uses the service
 * client because share data lives behind dropped RLS policies (migration
 * 012); all share-state checks (active, expiry, password) are explicit here.
 *
 * Phase 0 hardening:
 *   - Gallery cookie verification uses HMAC tokens (lib/shares/session)
 *     instead of trusting raw share.id.
 *   - `section` and `person` share types now scope the image set; previously
 *     they leaked the entire event.
 *   - `originalUrl` only ships when allow_download is true. Setting
 *     allow_download=false in the UI now actually prevents downloads.
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
      const cookie = request.cookies.get(gallerySessionCookieName(slug));
      const authorized = verifyGallerySession(cookie?.value, slug, share.id);
      if (!authorized) {
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
            // Presign logo URL if it's an R2 key. 10 min TTL pre-auth (was
            // 24 h) so an unauthenticated link preview can't be cached and
            // replayed for a day.
            const presignedLogoUrl = authProfile.logo_url
              ? authProfile.logo_url.startsWith("branding/")
                ? await getPresignedDownloadUrl(authProfile.logo_url, 600)
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
          ? await getPresignedDownloadUrl(profile.logo_url, 14400)
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

    // 5. Resolve the set of image IDs this share is allowed to expose.
    // The previous implementation only scoped 'selection' shares — 'section'
    // and 'person' fell through to the whole event, leaking unrelated photos.
    const allowedImageIds = await resolveAllowedImageIds(supabase, {
      shareType: share.share_type,
      eventId: share.event_id,
      sectionId: share.section_id,
      personId: share.person_id,
      explicitImageIds: share.image_ids ?? null,
    });

    if (allowedImageIds !== null && allowedImageIds.length === 0) {
      // Share configured for a section/person/selection that has no images.
      return NextResponse.json({
        eventName: event.name,
        eventDate: event.event_date,
        customMessage: share.custom_message,
        allowDownload: share.allow_download,
        allowFavorites: share.allow_favorites,
        requirePinBulk: share.require_pin_bulk ?? false,
        requirePinIndividual: share.require_pin_individual ?? false,
        images: [],
        sections: undefined,
        shareId: share.id,
        branding,
        settings: defaultGallerySettings(event.settings),
      });
    }

    // 6. Fetch images — paginated to avoid Supabase 1000-row default limit
    const IMG_FIELDS = "id, r2_key, original_filename, parsed_name, width, height, aesthetic_score, taken_at";
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
        .eq("processing_status", "complete");

      // Apply sort order from event settings
      if (gridSort === "filename") {
        pageQuery = pageQuery.order("original_filename", { ascending: true });
      } else if (gridSort === "date-taken") {
        pageQuery = pageQuery.order("taken_at", { ascending: true, nullsFirst: false });
      } else {
        pageQuery = pageQuery.order("created_at", { ascending: true });
      }

      pageQuery = pageQuery.range(imgOffset, imgOffset + IMG_PAGE - 1);

      if (allowedImageIds !== null) {
        pageQuery = pageQuery.in("id", allowedImageIds);
      }

      const { data, error: pageError } = await pageQuery;
      if (pageError) throw pageError;
      if (!data || data.length === 0) break;
      rawImages = rawImages.concat(data);
      if (data.length < IMG_PAGE) break;
      imgOffset += IMG_PAGE;
    }

    // 5a. Save cover image data before excluding from gallery grid
    const coverImageId = ((event.settings as Record<string, unknown>)?.cover as Record<string, unknown>)?.imageId as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coverImageRow = coverImageId ? rawImages.find((img: any) => img.id === coverImageId) : null;
    if (coverImageId) {
      rawImages = rawImages.filter((img) => img.id !== coverImageId);
    }

    // 5b. Generate presigned URLs. Downloads are gated by `allow_download`
    // — and the full-resolution `originalUrl` is too, because it's the same
    // bytes. Previously originalUrl shipped regardless and made
    // allow_download=false a UI-only restriction (right-click → save).
    // When downloads aren't allowed, we only ship the thumbnail.
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const thumbKey = getThumbnailKey(img.r2_key);
        const thumbnailUrl = await getPresignedDownloadUrl(thumbKey, 14400);

        const result: Record<string, unknown> = {
          id: img.id,
          thumbnailUrl,
          originalFilename: img.original_filename,
          parsedName: img.parsed_name,
          width: img.width,
          height: img.height,
          takenAt: img.taken_at,
        };

        if (share.allow_download) {
          result.originalUrl = await getPresignedDownloadUrl(img.r2_key, 14400);
          result.downloadUrl = await getPresignedDownloadUrl(img.r2_key, 3600);
        } else {
          // No high-res leak — the lightbox uses the thumbnail.
          result.originalUrl = thumbnailUrl;
        }

        return result;
      })
    );

    // 6. Build gallery settings from event settings
    const gallerySettings = defaultGallerySettings(event.settings);
    const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
    const cover = (eventSettings.cover ?? DEFAULT_EVENT_SETTINGS.cover) as {
      enabled: boolean; imageId?: string;
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

/**
 * Resolve the set of image IDs this share is allowed to expose.
 *
 * Returns `null` to mean "everything in the event" (full share).
 * Returns `[]` to mean "nothing" (misconfigured / empty section etc).
 */
async function resolveAllowedImageIds(
  supabase: ReturnType<typeof createServiceClient>,
  args: {
    shareType: string;
    eventId: string;
    sectionId: string | null;
    personId: string | null;
    explicitImageIds: string[] | null;
  }
): Promise<string[] | null> {
  switch (args.shareType) {
    case "full":
      return null;
    case "selection":
      return args.explicitImageIds ?? [];
    case "section": {
      if (!args.sectionId) return [];
      const { data } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", args.sectionId);
      return (data ?? []).map((r) => r.image_id);
    }
    case "person": {
      if (!args.personId) return [];
      const { data } = await supabase
        .from("faces")
        .select("image_id")
        .eq("person_id", args.personId);
      // Dedupe — a person can have multiple face detections per image
      return Array.from(new Set((data ?? []).map((r) => r.image_id)));
    }
    default:
      return [];
  }
}

/** Build a GallerySettings from the event settings JSON. */
function defaultGallerySettings(eventSettingsJson: unknown): GallerySettings {
  const eventSettings = (eventSettingsJson ?? {}) as Record<string, unknown>;
  const cover = (eventSettings.cover ?? DEFAULT_EVENT_SETTINGS.cover) as {
    enabled: boolean; imageId?: string; titlePosition: string; titleAlignment: string;
    titlePlacement?: { vertical: string; horizontal: string };
  };
  const typography = (eventSettings.typography ?? DEFAULT_EVENT_SETTINGS.typography) as { headingFont: string; bodyFont: string };
  const color = (eventSettings.color ?? DEFAULT_EVENT_SETTINGS.color) as { primary: string; secondary: string; accent: string; background: string };
  const grid = (eventSettings.grid ?? DEFAULT_EVENT_SETTINGS.grid) as { columns: number; gap: string; style: string };

  return {
    coverEnabled: cover.enabled,
    titlePosition: cover.titlePosition as "above" | "over" | "below",
    titleAlignment: cover.titleAlignment as "left" | "center" | "right",
    titlePlacement: cover.titlePlacement,
    headingFont: typography.headingFont,
    bodyFont: typography.bodyFont,
    colorPrimary: color.primary,
    colorSecondary: color.secondary,
    colorAccent: color.accent,
    colorBackground: color.background,
    gridStyle: grid.style as "masonry" | "uniform",
    gridColumns: grid.columns,
    gridGap: grid.gap as "tight" | "normal" | "loose",
  };
}
