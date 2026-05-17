import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { log } from "@/lib/log";

/**
 * PUT /api/stacks/[stackId]/cover
 *
 * Promote `imageId` to the cover of `stackId`. RLS on stacks scopes the
 * RPC call to stacks the caller owns; non-owned stackIds appear empty to
 * the SECURITY DEFINER function and raise no_data_found, which we map to
 * 404 without leaking which stacks exist.
 *
 * The actual rank swap runs inside set_stack_cover() (migration 016) as
 * one transaction — previously this route did read-then-two-writes and
 * two concurrent requests could leave the stack with duplicate rank=1.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ stackId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { stackId } = await params;
    const { imageId } = (await request.json()) as { imageId?: string };

    if (!imageId || typeof imageId !== "string") {
      return NextResponse.json(
        { error: "imageId is required" },
        { status: 400 }
      );
    }

    // Ownership check via RLS — non-owned stack rows are invisible here.
    const { data: stack } = await supabase
      .from("stacks")
      .select("id")
      .eq("id", stackId)
      .single();

    if (!stack) {
      return NextResponse.json({ error: "Stack not found" }, { status: 404 });
    }

    const { error: rpcError } = await supabase.rpc("set_stack_cover", {
      p_stack_id: stackId,
      p_image_id: imageId,
    });

    if (rpcError) {
      // Code 'P0001' from RAISE EXCEPTION in plpgsql, or 'no_data_found'.
      const code = (rpcError as { code?: string }).code;
      if (code === "P0001" || code === "no_data_found") {
        return NextResponse.json(
          { error: "Image not found in this stack" },
          { status: 404 }
        );
      }
      log.error("stacks/cover", "set_stack_cover failed", {
        stackId,
        imageId,
        err: rpcError,
      });
      throw rpcError;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("stacks/cover", "request failed", { err });
    return NextResponse.json(
      { error: "Failed to set cover" },
      { status: 500 }
    );
  }
}
