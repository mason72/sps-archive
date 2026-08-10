import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * PATCH /api/people/[personId] — name (or un-name) a clustered person.
 * A named person is permanent: clustering never auto-deletes it.
 * Ownership-scoped via person → event → user.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const { personId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json()) as { name?: string | null };
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null;

    const { data: person } = await supabase
      .from("persons")
      .select("id, events!inner(user_id)")
      .eq("id", personId)
      .maybeSingle();
    if (!person || (person.events as unknown as { user_id: string }).user_id !== user!.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { error } = await supabase.from("persons").update({ name }).eq("id", personId);
    if (error) throw error;

    return NextResponse.json({ id: personId, name });
  } catch (error) {
    await reportSystemError("people.rename", error, { personId });
    return NextResponse.json({ error: "Failed to update person" }, { status: 500 });
  }
}
