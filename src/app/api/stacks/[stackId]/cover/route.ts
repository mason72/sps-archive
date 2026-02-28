import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * PUT /api/stacks/[stackId]/cover
 *
 * Change the cover image of a stack.
 * Swaps stack_rank values so the new cover gets rank 1.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ stackId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { stackId } = await params;
    const { imageId } = (await request.json()) as { imageId: string };

    if (!imageId) {
      return NextResponse.json(
        { error: "imageId is required" },
        { status: 400 }
      );
    }

    // Verify the image belongs to this stack
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("id, stack_id, stack_rank")
      .eq("id", imageId)
      .eq("stack_id", stackId)
      .single();

    if (imageError || !image) {
      return NextResponse.json(
        { error: "Image not found in this stack" },
        { status: 404 }
      );
    }

    // Get the current cover (rank 1)
    const { data: currentCover } = await supabase
      .from("images")
      .select("id, stack_rank")
      .eq("stack_id", stackId)
      .eq("stack_rank", 1)
      .single();

    if (currentCover && currentCover.id !== imageId) {
      // Swap ranks: new cover gets rank 1, old cover gets the new image's old rank
      const oldRank = image.stack_rank;

      await supabase
        .from("images")
        .update({ stack_rank: 1 })
        .eq("id", imageId);

      await supabase
        .from("images")
        .update({ stack_rank: oldRank })
        .eq("id", currentCover.id);
    }

    // Update the stack's cover_image_id
    await supabase
      .from("stacks")
      .update({ cover_image_id: imageId })
      .eq("id", stackId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Set cover error:", error);
    return NextResponse.json(
      { error: "Failed to set cover" },
      { status: 500 }
    );
  }
}
