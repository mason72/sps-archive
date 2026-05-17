import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { log } from "@/lib/log";

/**
 * PUT /api/images/[imageId]/star
 *
 * Toggle (or explicitly set) the photographer's private star on an image.
 * Ownership is enforced by RLS — the cookie-bound client only sees images
 * whose parent event belongs to the caller, so a star request against a
 * non-owned imageId silently updates zero rows and returns 404.
 *
 * Body: { starred?: boolean }  // optional — when omitted the row's
 *                              // current state is flipped.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      starred?: boolean;
    };

    let next: boolean;
    if (typeof body.starred === "boolean") {
      next = body.starred;
    } else {
      // Toggle. One extra round-trip but avoids the client having to know
      // the current state — handy for keyboard shortcuts.
      const { data: current } = await supabase
        .from("images")
        .select("starred")
        .eq("id", imageId)
        .single();
      if (!current) {
        return NextResponse.json({ error: "Image not found" }, { status: 404 });
      }
      next = !current.starred;
    }

    const { data: updated, error } = await supabase
      .from("images")
      .update({ starred: next })
      .eq("id", imageId)
      .select("id, starred")
      .single();

    if (error || !updated) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    return NextResponse.json({ id: updated.id, starred: updated.starred });
  } catch (err) {
    log.error("images/star", "request failed", { err });
    return NextResponse.json(
      { error: "Failed to update star" },
      { status: 500 }
    );
  }
}
