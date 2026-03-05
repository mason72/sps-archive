import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getAuthUser } from "@/lib/auth/helpers";
import { hashPassword } from "@/lib/shares/hash";
import { logActivity } from "@/lib/analytics/log";
import { DEFAULT_SHARING_SETTINGS } from "@/types/event-settings";
import type { SharingSettings } from "@/types/event-settings";

/**
 * POST /api/shares — Create a new share link for an event.
 *
 * Body: {
 *   eventId: string,
 *   useEventDefaults?: boolean,   // pull defaults from event settings.sharing
 *   password?: string,
 *   allowDownload?: boolean,
 *   allowFavorites?: boolean,
 *   expiresAt?: string (ISO date),
 *   customMessage?: string,
 *   imageIds?: string[],  // when provided, creates a 'selection' share
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const {
      eventId,
      useEventDefaults,
      password,
      allowDownload,
      allowFavorites,
      expiresAt,
      customMessage,
      imageIds,
      downloadPin,
      requirePinBulk,
      requirePinIndividual,
    } = body as {
      eventId: string;
      useEventDefaults?: boolean;
      password?: string;
      allowDownload?: boolean;
      allowFavorites?: boolean;
      expiresAt?: string;
      customMessage?: string;
      imageIds?: string[];
      downloadPin?: string;
      requirePinBulk?: boolean;
      requirePinIndividual?: boolean;
    };

    if (!eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

    // Verify user owns this event (and fetch settings when needed)
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Resolve share settings — either from event defaults or request body
    const eventSettings = (event.settings ?? {}) as Record<string, unknown>;
    const sharing: SharingSettings = useEventDefaults
      ? { ...DEFAULT_SHARING_SETTINGS, ...((eventSettings.sharing ?? {}) as Partial<SharingSettings>) }
      : DEFAULT_SHARING_SETTINGS;

    const resolvedPassword = useEventDefaults ? sharing.password : password;
    const resolvedAllowDownload = useEventDefaults ? sharing.allowDownload : (allowDownload ?? true);
    const resolvedAllowFavorites = useEventDefaults ? sharing.allowFavorites : (allowFavorites ?? true);
    const resolvedExpiresAt = useEventDefaults ? sharing.expiresAt : expiresAt;
    const resolvedCustomMessage = useEventDefaults ? sharing.customMessage : customMessage;
    const resolvedDownloadPin = useEventDefaults ? sharing.downloadPin : downloadPin;
    const resolvedRequirePinBulk = useEventDefaults ? sharing.requirePinBulk : (requirePinBulk ?? false);
    const resolvedRequirePinIndividual = useEventDefaults ? sharing.requirePinIndividual : (requirePinIndividual ?? false);

    const slug = nanoid(10);
    const passwordHash = resolvedPassword ? await hashPassword(resolvedPassword) : null;

    // Determine share type: 'selection' if imageIds provided, else 'full'
    const isSelection = imageIds && imageIds.length > 0;

    const { data, error } = await supabase
      .from("shares")
      .insert({
        event_id: eventId,
        slug,
        password_hash: passwordHash,
        allow_download: resolvedAllowDownload,
        allow_favorites: resolvedAllowFavorites,
        expires_at: resolvedExpiresAt || null,
        custom_message: resolvedCustomMessage || null,
        is_active: true,
        share_type: isSelection ? "selection" : "full",
        image_ids: isSelection ? imageIds : null,
        download_pin: resolvedDownloadPin || null,
        require_pin_bulk: resolvedRequirePinBulk,
        require_pin_individual: resolvedRequirePinIndividual,
      })
      .select()
      .single();

    if (error) throw error;

    // Log share creation (fire and forget)
    logActivity({
      userId: user!.id,
      action: "share_created",
      eventId,
      shareId: data.id,
    });

    return NextResponse.json(
      {
        share: {
          id: data.id,
          slug: data.slug,
          shareType: data.share_type,
          isPasswordProtected: !!passwordHash,
          allowDownload: data.allow_download,
          allowFavorites: data.allow_favorites,
          expiresAt: data.expires_at,
          customMessage: data.custom_message,
          isActive: data.is_active,
          imageIds: data.image_ids || null,
          createdAt: data.created_at,
          requirePinBulk: data.require_pin_bulk,
          requirePinIndividual: data.require_pin_individual,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create share error:", error);
    return NextResponse.json({ error: "Failed to create share" }, { status: 500 });
  }
}

/**
 * GET /api/shares?eventId=<id> — List all shares for an event.
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("shares")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const shares = (data || []).map((s) => ({
      id: s.id,
      slug: s.slug,
      shareType: s.share_type,
      isPasswordProtected: !!s.password_hash,
      allowDownload: s.allow_download,
      allowFavorites: s.allow_favorites,
      expiresAt: s.expires_at,
      customMessage: s.custom_message,
      isActive: s.is_active,
      viewCount: s.view_count,
      imageIds: s.image_ids || null,
      createdAt: s.created_at,
      requirePinBulk: s.require_pin_bulk,
      requirePinIndividual: s.require_pin_individual,
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("List shares error:", error);
    return NextResponse.json({ error: "Failed to list shares" }, { status: 500 });
  }
}
