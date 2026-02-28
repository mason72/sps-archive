import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/** GET /api/templates/[templateId] — Get a single template */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { templateId } = await params;

    const { data, error } = await supabase
      .from("event_templates")
      .select("*")
      .eq("id", templateId)
      .eq("user_id", user!.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ template: data });
  } catch (error) {
    console.error("Get template error:", error);
    return NextResponse.json(
      { error: "Failed to load template" },
      { status: 500 }
    );
  }
}

/** DELETE /api/templates/[templateId] — Delete a template */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { templateId } = await params;

    const { error } = await supabase
      .from("event_templates")
      .delete()
      .eq("id", templateId)
      .eq("user_id", user!.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete template error:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
