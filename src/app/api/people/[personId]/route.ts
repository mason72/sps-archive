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
    let name =
      typeof body.name === "string" ? body.name.trim().slice(0, 120) || null : null;
    // Typing the UI's own "Unnamed" label is a request to clear, not a name.
    if (name && name.toLowerCase() === "unnamed") name = null;

    const { data: person } = await supabase
      .from("persons")
      .select("id, name, rejected_names, events!inner(user_id)")
      .eq("id", personId)
      .maybeSingle();
    if (!person || (person.events as unknown as { user_id: string }).user_id !== user!.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Typing a CREW member's name is a link, never a name write — crew stay
    // out of guest identity space no matter which door they come through.
    // Mason typed "Joey Nagoshiner" into the rename box and minted a second
    // Joey beside the crew-linked one; the API is the choke point every
    // rename passes, so the invariant is enforced here, not in each UI.
    if (name) {
      const { normalizeNameKey } = await import("@/lib/people/index-people");
      const typedKey = normalizeNameKey(name);
      const { data: crewRows } = await supabase
        .from("crew")
        .select("id, display_name, aliases")
        .eq("user_id", user!.id);
      const crewMatch = (crewRows ?? []).find((c) =>
        [c.display_name, ...((c.aliases as string[] | null) ?? [])].some(
          (n) => normalizeNameKey(n ?? "") === typedKey
        )
      );
      if (crewMatch) {
        const { confirmCrewPerson } = await import("@/lib/crew-faces/match");
        const linked = await confirmCrewPerson(supabase, {
          userId: user!.id,
          crewId: crewMatch.id,
          personId,
        });
        if (!linked.ok) throw new Error(linked.error ?? "Crew link failed");
        // Clear any existing junk name; the link is the identity now.
        const rejected = new Set(person.rejected_names ?? []);
        if (person.name) rejected.add(person.name);
        const { error: clearErr } = await supabase
          .from("persons")
          .update({ name: null, rejected_names: [...rejected] })
          .eq("id", personId);
        if (clearErr) throw clearErr;
        return NextResponse.json({
          id: personId,
          name: null,
          linkedCrew: crewMatch.display_name,
        });
      }
    }

    // Clearing a name is a statement — "the filename is wrong" — and it must
    // outlive this request. Without recording it, the fill-nulls-only
    // consensus namer re-applies the SAME wrong name on the next clustering
    // run (seen live 2026-08-16: a stranger's photos exported under "Jenna
    // Wombles"'s filename). Rejection gates only the AUTOMATIC path — a human
    // typing a name is never blocked.
    const rejected = new Set(person.rejected_names ?? []);
    if (person.name && name === null) rejected.add(person.name);
    // Typing a name un-rejects it: the human is overriding their own earlier
    // clear, and the auto-namer should be allowed to agree with them again.
    if (name) {
      for (const r of [...rejected]) {
        if (r.toLowerCase() === name.toLowerCase()) rejected.delete(r);
      }
    }

    const { error } = await supabase
      .from("persons")
      .update({ name, rejected_names: [...rejected] })
      .eq("id", personId);
    if (error) throw error;

    return NextResponse.json({ id: personId, name });
  } catch (error) {
    await reportSystemError("people.rename", error, { personId });
    return NextResponse.json({ error: "Failed to update person" }, { status: 500 });
  }
}
