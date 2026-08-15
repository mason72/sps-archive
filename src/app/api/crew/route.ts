import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * The roster — add, edit, archive.
 *
 * 89 people arrived from a spreadsheet import and there has been no way to
 * touch them since: no search, no adding, no removing. Mason wants ~80% gone.
 *
 * ARCHIVE, NOT DELETE, is the default. `event_crew` references these rows, so
 * deleting someone who worked a 2018 gig either cascades that history away or
 * fails on the constraint. Archiving keeps the record and removes them from
 * every picker, which is what "get them off my list" actually means. A true
 * delete is offered ONLY when nobody is linked to them — checked server-side,
 * never assumed from the client.
 *
 * Identity is `primary_email` + `aliases`, never the name: twelve years of
 * calendars spell the same person three ways. `display_name` is what the team
 * calls them ("Stretch"), which matches neither an email nor a legal name and
 * is therefore its own column.
 */

/**
 * What someone DOES. Not how often you use them — that is `is_regular`, and
 * conflating the two is what the old staff/local/client/other vocabulary did.
 *
 * Mason, 2026-08-14: "I think that's redundant with 'regular' — maybe we change
 * staff to photographer, stylist, MUA... we don't need 'other'."
 *
 * No catch-all on purpose. "other" absorbs everyone nobody classified and the
 * list stops meaning anything; three real disciplines force a real answer.
 */
const KINDS = ["photographer", "stylist", "makeup artist"];

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("archived") === "1";

    let q = db
      .from("crew")
      .select("id, display_name, full_name, primary_email, aliases, kind, city, region, can_lead, travels, archived, notes, is_regular")
      .eq("user_id", user!.id)
      // Regulars first, then alphabetical. The people Mason works with most
      // should never be scrolled past to reach — and this is the ONE place the
      // order is decided, so every picker inherits it.
      .order("is_regular", { ascending: false })
      .order("display_name");
    if (!includeArchived) q = q.eq("archived", false);

    const { data, error } = await q;
    if (error) throw error;

    // How many events each person is on — the number that decides whether
    // removing them is safe, so it travels with the row rather than being
    // fetched again when someone clicks delete.
    const { data: links, error: linkErr } = await db
      .from("event_crew").select("crew_id").eq("user_id", user!.id);
    if (linkErr) throw linkErr;
    const counts = new Map<string, number>();
    for (const l of links ?? []) counts.set(l.crew_id, (counts.get(l.crew_id) ?? 0) + 1);

    return NextResponse.json({
      crew: (data ?? []).map((c: Record<string, unknown>) => ({
        ...c,
        eventCount: counts.get(c.id as string) ?? 0,
      })),
      kinds: KINDS,
    });
  } catch (err) {
    await reportSystemError("api.crew.GET", err);
    return NextResponse.json({ error: "Could not load the roster" }, { status: 500 });
  }
}

/** Add someone. Only a name is required — the rest is fill-in-as-you-learn-it. */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const b = (await request.json()) as Record<string, string | boolean | null>;
    const name = String(b.display_name ?? "").trim();
    if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });

    const email = String(b.primary_email ?? "").trim().toLowerCase() || null;
    if (email) {
      // The unique index would reject this anyway; catching it here gives a
      // sentence instead of a Postgres constraint name.
      const { data: clash } = await db
        .from("crew").select("display_name").eq("user_id", user!.id)
        .ilike("primary_email", email).maybeSingle();
      if (clash) {
        return NextResponse.json(
          { error: `${clash.display_name} already uses that email` },
          { status: 409 }
        );
      }
    }

    const { data, error } = await db.from("crew").insert({
      user_id: user!.id,
      display_name: name,
      full_name: String(b.full_name ?? "").trim() || null,
      primary_email: email,
      kind: KINDS.includes(String(b.kind)) ? b.kind : "photographer",
      is_regular: b.is_regular === true,
      city: String(b.city ?? "").trim() || null,
      can_lead: ["yes", "maybe", "no"].includes(String(b.can_lead)) ? b.can_lead : null,
      travels: typeof b.travels === "boolean" ? b.travels : null,
      notes: String(b.notes ?? "").trim() || null,
    }).select("id").single();
    if (error) throw error;

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    await reportSystemError("api.crew.POST", err);
    return NextResponse.json({ error: "Could not add" }, { status: 500 });
  }
}

/** Edit, archive, or restore. */
export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const b = (await request.json()) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.display_name === "string" && b.display_name.trim()) patch.display_name = b.display_name.trim();
    if (typeof b.full_name === "string") patch.full_name = b.full_name.trim() || null;
    if (typeof b.primary_email === "string") patch.primary_email = b.primary_email.trim().toLowerCase() || null;
    if (typeof b.kind === "string" && KINDS.includes(b.kind)) patch.kind = b.kind;
    if (typeof b.city === "string") patch.city = b.city.trim() || null;
    if (typeof b.can_lead === "string" || b.can_lead === null) {
      patch.can_lead = ["yes", "maybe", "no"].includes(String(b.can_lead)) ? b.can_lead : null;
    }
    if (typeof b.travels === "boolean" || b.travels === null) patch.travels = b.travels;
    if (typeof b.notes === "string") patch.notes = b.notes.trim() || null;
    if (typeof b.archived === "boolean") patch.archived = b.archived;
    if (typeof b.is_regular === "boolean") patch.is_regular = b.is_regular;

    const { error } = await db.from("crew").update(patch).eq("id", id).eq("user_id", user!.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.crew.PATCH", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

/**
 * Delete for real — only when nobody is linked.
 *
 * Checked here rather than trusted from the client, and refused with the count
 * so the UI can say "on 3 events — archive instead" rather than a bare failure.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { count, error: cErr } = await db
      .from("event_crew").select("*", { count: "exact", head: true })
      .eq("crew_id", id).eq("user_id", user!.id);
    if (cErr) throw cErr;
    if (count && count > 0) {
      return NextResponse.json(
        { error: `On ${count} event${count === 1 ? "" : "s"} — archive instead of deleting`, eventCount: count },
        { status: 409 }
      );
    }

    const { error } = await db.from("crew").delete().eq("id", id).eq("user_id", user!.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.crew.DELETE", err);
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  }
}
