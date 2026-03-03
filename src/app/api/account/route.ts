import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  business_name: string | null;
  bio: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  location: string | null;
  branding: Record<string, unknown>;
  gallery_defaults: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/account
 * Fetch the authenticated user's profile.
 * Auto-creates profile if it doesn't exist yet.
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // Try to fetch existing profile
    const profileResult = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user!.id)
      .single() as { data: ProfileRow | null; error: unknown };

    let profile = profileResult.data;

    // Auto-create if not found (handles users created before the trigger)
    if (profileResult.error || !profile) {
      const { data: newProfile, error: insertError } = await supabase
        .from("user_profiles")
        .upsert({ user_id: user!.id })
        .select()
        .single() as { data: ProfileRow | null; error: unknown };

      if (insertError) throw insertError;
      profile = newProfile;
    }

    if (!profile) {
      return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
    }

    const branding: Branding = {
      ...DEFAULT_BRANDING,
      ...(profile.branding as Partial<Branding> || {}),
    };

    return NextResponse.json({
      profile: {
        userId: profile.user_id,
        email: user!.email,
        displayName: profile.display_name,
        businessName: profile.business_name,
        bio: profile.bio,
        logoUrl: profile.logo_url
          ? profile.logo_url.startsWith("branding/")
            ? await getPresignedDownloadUrl(profile.logo_url, 86400) // 1 day TTL, refreshed each load
            : profile.logo_url // Legacy presigned URLs still work until they expire
          : null,
        website: profile.website,
        phone: profile.phone,
        location: profile.location,
        branding,
        galleryDefaults: profile.gallery_defaults || {},
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    });
  } catch (error) {
    console.error("Get account error:", error);
    return NextResponse.json(
      { error: "Failed to load account" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/account
 * Update user profile fields.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.displayName !== undefined) updates.display_name = body.displayName;
    if (body.businessName !== undefined) updates.business_name = body.businessName;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.logoUrl !== undefined) updates.logo_url = body.logoUrl;
    if (body.website !== undefined) updates.website = body.website;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.location !== undefined) updates.location = body.location;

    // Branding: deep merge with existing
    if (body.branding !== undefined) {
      const { data: existing } = await supabase
        .from("user_profiles")
        .select("branding")
        .eq("user_id", user!.id)
        .single();

      const currentBranding = (existing?.branding ?? {}) as Record<string, unknown>;
      updates.branding = { ...currentBranding, ...body.branding };
    }

    // Gallery defaults: deep merge with existing
    if (body.galleryDefaults !== undefined) {
      const { data: existing } = await supabase
        .from("user_profiles")
        .select("gallery_defaults")
        .eq("user_id", user!.id)
        .single();

      const currentDefaults = (existing?.gallery_defaults ?? {}) as Record<string, unknown>;
      updates.gallery_defaults = { ...currentDefaults, ...body.galleryDefaults };
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("user_profiles")
      .update(updates)
      .eq("user_id", user!.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ profile: data });
  } catch (error) {
    console.error("Update account error:", error);
    return NextResponse.json(
      { error: "Failed to update account" },
      { status: 500 }
    );
  }
}
