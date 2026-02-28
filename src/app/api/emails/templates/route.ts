import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { STARTER_TEMPLATES } from "@/types/email";


/**
 * GET /api/emails/templates
 * List all email templates for the authenticated user.
 * Auto-seeds starter templates on first call.
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;


    // Fetch existing templates
    let { data: templates, error } = await supabase
      .from("email_templates")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Auto-seed starter templates if none exist
    if (!templates || templates.length === 0) {
      const seeds = STARTER_TEMPLATES.map((t) => ({
        user_id: user!.id,
        name: t.name,
        subject: t.subject,
        body_html: t.bodyHtml,
        is_default: t.isDefault,
      }));

      const { data: seeded, error: seedError } = await supabase
        .from("email_templates")
        .insert(seeds)
        .select();

      if (seedError) throw seedError;
      templates = seeded;
    }

    return NextResponse.json({
      templates: (templates || []).map(mapTemplate),
    });
  } catch (error) {
    console.error("List templates error:", error);
    return NextResponse.json(
      { error: "Failed to load templates" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/emails/templates
 * Create a new email template.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();

    const { data: template, error } = await supabase
      .from("email_templates")
      .insert({
        user_id: user!.id,
        name: body.name || "Untitled Template",
        subject: body.subject || "",
        body_html: body.bodyHtml || "",
        is_default: false,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ template: mapTemplate(template) }, { status: 201 });
  } catch (error) {
    console.error("Create template error:", error);
    return NextResponse.json(
      { error: "Failed to create template" },
      { status: 500 }
    );
  }
}

function mapTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
