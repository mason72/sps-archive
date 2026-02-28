import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getAuthUser } from "@/lib/auth/helpers";
import { hashPassword } from "@/lib/shares/hash";

/**
 * POST /api/shares — Create a new share link for an event.
 *
 * Body: {
 *   eventId: string,
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

    // Verify user owns this event
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const slug = nanoid(10);
    const passwordHash = password ? await hashPassword(password) : null;

    // Determine share type: 'selection' if imageIds provided, else 'full'
    const isSelection = imageIds && imageIds.length > 0;

    const { data, error } = await supabase
      .from("shares")
      .insert({
        event_id: eventId,
        slug,
        password_hash: passwordHash,
        allow_download: allowDownload ?? true,
        allow_favorites: allowFavorites ?? true,
        expires_at: expiresAt || null,
        custom_message: customMessage || null,
        is_active: true,
        share_type: isSelection ? "selection" : "full",
        image_ids: isSelection ? imageIds : null,
        download_pin: downloadPin || null,
        require_pin_bulk: requirePinBulk ?? false,
        require_pin_individual: requirePinIndividual ?? false,
      })
      .select()
      .single();

    if (error) throw error;

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
