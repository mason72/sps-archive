import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getCachedThumbnailUrl, getThumbnailKey, getDisplayKey, getCachedDownloadUrl } from "@/lib/r2/client";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { DEFAULT_EVENT_SETTINGS, normalizeCoverSettings } from "@/types/event-settings";
import { coverGalleryFields } from "@/lib/cover/payload";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";
import { detectStackable } from "@/lib/gallery/stackable";

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

    // 3. Fetch all images for this event (paginated to avoid 1000-row limit)
    const PREVIEW_IMG_FIELDS = "id, r2_key, original_filename, parsed_name, width, height, aesthetic_score, taken_at, dominant_color, media_type, focal_x, focal_y";
    const PREVIEW_PAGE_SIZE = 1000;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawImages: any[] = [];
    let previewOffset = 0;

    // Determine sort order from event settings
    const gridSort = ((event.settings as Record<string, unknown>)?.grid as Record<string, unknown>)?.sortBy as string | undefined;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let pageQuery = supabase
        .from("images")
        .select(PREVIEW_IMG_FIELDS)
        .eq("event_id", eventId)
        // Display gate = thumbnail ready, not AI-pipeline complete. Keep this in
        // lockstep with the public gallery route so Preview matches what clients
        // see. (See gallery/[slug]/route.ts for the full rationale.)
        .eq("thumbnail_generated", true);

      if (gridSort === "filename") {
        pageQuery = pageQuery.order("original_filename", { ascending: true });
      } else if (gridSort === "date-taken") {
        pageQuery = pageQuery.order("taken_at", { ascending: true, nullsFirst: false });
      } else {
        pageQuery = pageQuery.order("created_at", { ascending: true });
      }

      const { data, error: pageError } = await pageQuery
        .range(previewOffset, previewOffset + PREVIEW_PAGE_SIZE - 1);

      if (pageError) throw pageError;
      if (!data || data.length === 0) break;
      rawImages = rawImages.concat(data);
      if (data.length < PREVIEW_PAGE_SIZE) break;
      previewOffset += PREVIEW_PAGE_SIZE;
    }

    // 3b. Save cover image data before excluding from gallery grid.
    // Same rule as the public gallery: only an ACTIVE photo cover excludes
    // its image from the grid.
    const cover = normalizeCoverSettings(
      ((event.settings ?? {}) as Record<string, unknown>).cover
    );
    const coverImageId =
      cover.enabled && cover.type === "image" ? cover.imageId : undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coverImageRow = coverImageId ? rawImages.find((img: any) => img.id === coverImageId) : null;
    if (coverImageId) {
      rawImages = rawImages.filter((img) => img.id !== coverImageId);
    }

    // 4. Generate presigned URLs (grid thumbs via the presign memo + srcset
    // pair, same as the live gallery)
    const images = await Promise.all(
      (rawImages || []).map(async (img) => {
        const [thumbnailUrl, thumbnailLgUrl, originalUrl] = await Promise.all([
          getCachedThumbnailUrl(getThumbnailKey(img.r2_key)),
          getCachedThumbnailUrl(getThumbnailKey(img.r2_key, "thumb-lg")),
          // Non-renderable originals (TIFF) fall back to the 800px JPEG so the
          // preview lightbox shows them instead of a broken image.
          getCachedDownloadUrl(getDisplayKey(img.r2_key), 14400),
        ]);

        return {
          id: img.id,
          thumbnailUrl,
          thumbnailLgUrl,
          originalUrl,
          originalFilename: img.original_filename,
          parsedName: img.parsed_name,
          width: img.width,
          height: img.height,
          dominantColor: img.dominant_color ?? null,
          takenAt: img.taken_at,
          mediaType: img.media_type ?? "image",
          focalX: img.focal_x ?? null,
          focalY: img.focal_y ?? null,
        };
      })
    );

    // 5. Build gallery settings from event settings
    const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
    const typography = (eventSettings.typography ?? DEFAULT_EVENT_SETTINGS.typography) as { headingFont: string; bodyFont: string };
    const color = (eventSettings.color ?? DEFAULT_EVENT_SETTINGS.color) as { primary: string; secondary: string; accent: string; background: string };
    const grid = (eventSettings.grid ?? DEFAULT_EVENT_SETTINGS.grid) as { columns: number; gap: string; style: string; smartStacks?: boolean };

    const gallerySettings: GallerySettings = {
      ...(await coverGalleryFields(cover, eventId)),
      headingFont: typography.headingFont,
      bodyFont: typography.bodyFont,
      colorPrimary: color.primary,
      colorSecondary: color.secondary,
      colorAccent: color.accent,
      colorBackground: color.background,
      gridStyle: grid.style as "masonry" | "uniform",
      gridColumns: grid.columns,
      gridGap: grid.gap as "tight" | "normal" | "loose",
      // Preview mirrors the public gallery: seed the sort dropdown from the
      // admin's chosen sort so preview shows what clients will see.
      gridSort: (["manual", "upload", "filename", "date-taken"].includes(gridSort ?? "")
        ? gridSort
        : "manual") as GallerySettings["gridSort"],
      // Detected from the filenames when the photographer hasn't chosen, so a
      // headshot day stacks and a wedding or photo booth doesn't. Resolved with
      // the SAME function the editor uses, so guest and admin can never disagree.
      smartStacks:
        grid.smartStacks ??
        detectStackable(
          (rawImages ?? []).map((r) => ({
            parsedName: (r as { parsed_name: string | null }).parsed_name,
            originalFilename:
              (r as { original_filename: string }).original_filename,
          }))
        ).stackable,
      // Opt-in "All" tab — serialized the same as the guest route so the
      // preview can't drift from the client-facing gallery.
      showAllPhotos:
        (((event.settings as Record<string, unknown>)?.sharing ?? {}) as {
          showAllPhotos?: boolean;
        }).showAllPhotos === true,
    };

    // Generate presigned URL for cover image if cover is enabled
    if (cover.enabled && cover.imageId && coverImageRow) {
      gallerySettings.coverImageUrl = await getPresignedDownloadUrl(coverImageRow.r2_key, 14400);
      // Same face-focal fallback as the public gallery.
      if (!cover.focalPoint && coverImageRow.focal_x != null && coverImageRow.focal_y != null) {
        gallerySettings.coverFocalPoint = {
          x: coverImageRow.focal_x / 100,
          y: coverImageRow.focal_y / 100,
        };
      }
      // Photo-cover fit — serialized identically to the guest route so the
      // preview can't drift.
      gallerySettings.coverImageFit = cover.image?.fit ?? "cover";
      gallerySettings.coverImagePadding = cover.image?.padding;
    }

    // 6. Fetch sections with their image assignments
    const { data: rawSections } = await supabase
      .from("sections")
      .select("id, name, description")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    const imageIdSet = new Set((rawImages || []).map((img) => img.id));
    const sectionIds = (rawSections || []).map((s) => s.id);

    // Paginate — a single select caps at 1000 rows, which would drop sections
    // in large events (same bug fixed in the public gallery route).
    const sectionImageRows: { section_id: string; image_id: string }[] = [];
    if (sectionIds.length > 0) {
      const SI_PAGE = 1000;
      for (let off = 0; ; off += SI_PAGE) {
        const { data: page } = await supabase
          .from("section_images")
          .select("section_id, image_id")
          .in("section_id", sectionIds)
          .range(off, off + SI_PAGE - 1);
        if (!page || page.length === 0) break;
        sectionImageRows.push(...page);
        if (page.length < SI_PAGE) break;
      }
    }

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

    const response = NextResponse.json({
      eventName: event.name,
      eventDate: event.event_date,
      customMessage: null,
      allowDownload: true,
      allowFavorites: false,
      requirePinBulk: false,
      requirePinIndividual: false,
      images,
      sections: sections.length > 0 ? sections : undefined,
      shareId: `preview-${eventId}`,
      branding,
      settings: gallerySettings,
    });
    // Prevent caching so the preview always reflects latest settings
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error) {
    console.error("Preview gallery error:", error);
    return NextResponse.json(
      { error: "Failed to load preview" },
      { status: 500 }
    );
  }
}
