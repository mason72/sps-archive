import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";


/**
 * PATCH /api/emails/templates/[templateId]
 * Update a template's name, subject, or body.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { templateId } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.subject !== undefined) updates.subject = body.subject;
    if (body.bodyHtml !== undefined) updates.body_html = body.bodyHtml;
    if (body.isDefault !== undefined) updates.is_default = body.isDefault;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("email_templates")
      .update(updates)
      .eq("id", templateId)
      .eq("user_id", user!.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      template: {
        id: data.id,
        userId: data.user_id,
        name: data.name,
        subject: data.subject,
        bodyHtml: data.body_html,
        isDefault: data.is_default,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    console.error("Update template error:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/emails/templates/[templateId]
 * Delete a template.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { templateId } = await params;

    const { error } = await supabase
      .from("email_templates")
      .delete()
      .eq("id", templateId)
      .eq("user_id", user!.id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete template error:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}
