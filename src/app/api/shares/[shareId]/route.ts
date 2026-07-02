import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { hashPassword } from "@/lib/shares/hash";

/**
 * PUT /api/shares/[shareId] — Update share settings.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { shareId } = await params;

    // Ownership gate — the service client bypasses RLS, so verify the share
    // belongs to one of the caller's events before touching it.
    const { data: owned } = await supabase
      .from("shares")
      .select("id, events!inner(user_id)")
      .eq("id", shareId)
      .eq("events.user_id", user!.id)
      .single();

    if (!owned) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const body = await request.json();
    const { isActive, allowDownload, allowFavorites, password, expiresAt, customMessage } =
      body as {
        isActive?: boolean;
        allowDownload?: boolean;
        allowFavorites?: boolean;
        password?: string | null;
        expiresAt?: string | null;
        customMessage?: string | null;
      };

    const updates: Record<string, unknown> = {};
    if (isActive !== undefined) updates.is_active = isActive;
    if (allowDownload !== undefined) updates.allow_download = allowDownload;
    if (allowFavorites !== undefined) updates.allow_favorites = allowFavorites;
    if (expiresAt !== undefined) updates.expires_at = expiresAt;
    if (customMessage !== undefined) updates.custom_message = customMessage;

    // Password: null clears it, string sets it
    if (password === null) {
      updates.password_hash = null;
    } else if (password) {
      updates.password_hash = await hashPassword(password);
    }

    const { data, error } = await supabase
      .from("shares")
      .update(updates)
      .eq("id", shareId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      share: {
        id: data.id,
        slug: data.slug,
        isPasswordProtected: !!data.password_hash,
        allowDownload: data.allow_download,
        allowFavorites: data.allow_favorites,
        expiresAt: data.expires_at,
        customMessage: data.custom_message,
        isActive: data.is_active,
        viewCount: data.view_count,
      },
    });
  } catch (error) {
    console.error("Update share error:", error);
    return NextResponse.json({ error: "Failed to update share" }, { status: 500 });
  }
}

/**
 * DELETE /api/shares/[shareId] — Revoke (deactivate) a share.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { shareId } = await params;

    // Ownership gate — see PUT above.
    const { data: owned } = await supabase
      .from("shares")
      .select("id, events!inner(user_id)")
      .eq("id", shareId)
      .eq("events.user_id", user!.id)
      .single();

    if (!owned) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const { error } = await supabase
      .from("shares")
      .update({ is_active: false })
      .eq("id", shareId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete share error:", error);
    return NextResponse.json({ error: "Failed to revoke share" }, { status: 500 });
  }
}
