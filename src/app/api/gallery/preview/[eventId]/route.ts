import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getCachedThumbnailUrl, getThumbnailKey, getDisplayKey, getCachedDownloadUrl } from "@/lib/r2/client";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { DEFAULT_EVENT_SETTINGS, normalizeCoverSettings } from "@/types/event-settings";
import { coverGalleryFields } from "@/lib/cover/payload";
import type { GalleryBranding, GallerySettings } from "@/types/gallery";
import { selfieSearchAvailable } from "@/lib/faces/selfie-availability";
import { detectStackable } from "@/lib/gallery/stackable";
import { loadSectionLinks } from "@/lib/sections/gallery-members";
import { readGalleryImageRows } from "@/lib/gallery/image-rows";
import { firstScreenImageIds } from "@/lib/gallery/first-screen";

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

    // 3. Photos and sections, read together, through the same readers as the
    // public gallery so Preview keeps matching what clients see: photos by
    // readGalleryImageRows (parallel pages, `id` tiebreaker, throws on a
    // failed page; the old loop here waited on each page in turn and paged
    // over a non-unique order), sections and their links by loadSectionLinks
    // (manual order, throws on a failed page).
    const gridSort = ((event.settings as Record<string, unknown>)?.grid as Record<string, unknown>)?.sortBy as string | undefined;
    const readSections = async () => {
      const { data, error } = await supabase
        .from("sections")
        .select("id, name, description, sort_mode, sort_seed")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      return { rows, links: await loadSectionLinks(supabase, rows.map((s) => s.id)) };
    };
    const [imageRows, sectionRead] = await Promise.all([
      readGalleryImageRows(supabase, { eventId, gridSort }),
      readSections(),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rawImages: any[] = imageRows;
    const rawSections = sectionRead.rows;
    const sectionImageRows = sectionRead.links;

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
    // A cover upload (a client logo, marked is_cover_upload) is never a gallery
    // photo, whatever the cover type is now. The exclusion above covers only
    // the CURRENT photo cover; a mosaic cover's logo and every replaced cover
    // used to reach the "All" tab, search and the mosaic tiles (lesson 184).
    // Filtered AFTER coverImageRow is captured, because a logo can BE the cover.
    rawImages = rawImages.filter((img) => !img.is_cover_upload);

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
      // Was missing until 2026-10-28, so "Find my photos" never showed in a
      // preview at all. Same resolver as the guest payload: the preview shows
      // the button exactly when a guest would see it.
      selfieSearch: await selfieSearchAvailable(
        supabase,
        eventId,
        (eventSettings.sharing ?? {}) as { selfieSearch?: boolean }
      ),
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

    // 6. Group the section links read in 3 into each section's imageIds.
    const imageIdSet = new Set((rawImages || []).map((img) => img.id));

    const sectionImageMap = new Map<string, string[]>();
    for (const row of sectionImageRows) {
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
        sortMode: s.sort_mode ?? null,
        sortSeed: s.sort_seed ?? null,
        imageIds: sectionImageMap.get(s.id) || [],
      }))
      .filter((s) => s.imageIds.length > 0);

    // 6b. Which photos go out: the same two-part payload as the public
    // gallery (`?part=first` then `?part=rest`; first-screen.ts), so the
    // preview opens as fast as the gallery a guest gets.
    const firstIds =
      request.nextUrl.searchParams.get("part") === "first"
        ? firstScreenImageIds({
            images: rawImages.map((img) => ({
              id: img.id as string,
              parsedName: img.parsed_name as string | null,
              originalFilename: img.original_filename as string,
              mediaType: (img.media_type ?? "image") as string,
            })),
            sections: sections.length > 0 ? sections : undefined,
            settings: gallerySettings,
          })
        : null;
    const sentRows = firstIds
      ? rawImages.filter((img) => firstIds.has(img.id))
      : rawImages;

    // 7. Sign the photos going out (grid thumbs via the presign memo + srcset
    // pair, same as the live gallery)
    const images = await Promise.all(
      sentRows.map(async (img) => {
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
      ...(firstIds ? { partial: { imageCount: rawImages.length } } : {}),
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
