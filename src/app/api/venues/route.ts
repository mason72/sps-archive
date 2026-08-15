import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Venues — name, address, city, and what we know about the room.
 *
 * 10 of 17 venues are NAMED BY THEIR STREET ADDRESS, because the calendar's
 * `location` was a bare address and the parser correctly refused to invent a
 * venue name from one ("301 Battery St" names no venue). That was the right
 * call at parse time and it leaves a list only a human can finish.
 *
 * So: rename, add an address to one that has none, fix a city. `name` is what
 * gets shown; the address is detail. Editing here is also how a city gets
 * corrected — cities are DERIVED from venues, not a table of their own, and
 * inventing one would mean two places to keep in sync.
 */

export async function GET() {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { data, error } = await db
      .from("venues")
      .select("id, name, address, city, region, notes")
      .eq("user_id", user!.id)
      .order("name");
    if (error) throw error;

    // Events per venue — the number that decides whether deleting is safe.
    const { data: intel, error: iErr } = await db
      .from("event_intel").select("venue_id").eq("user_id", user!.id).not("venue_id", "is", null);
    if (iErr) throw iErr;
    const counts = new Map<string, number>();
    for (const r of intel ?? []) counts.set(r.venue_id, (counts.get(r.venue_id) ?? 0) + 1);

    return NextResponse.json({
      venues: (data ?? []).map((v: Record<string, unknown>) => ({
        ...v,
        eventCount: counts.get(v.id as string) ?? 0,
        /**
         * A leading digit means the "name" is really a street address — the
         * parser's own rule, reported rather than re-derived in the UI so both
         * sides cannot drift.
         */
        namedByAddress: /^\d/.test(String(v.name ?? "").trim()),
      })),
    });
  } catch (err) {
    await reportSystemError("api.venues.GET", err);
    return NextResponse.json({ error: "Could not load venues" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const b = (await request.json()) as Record<string, string>;
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });

    const { data, error } = await db.from("venues").insert({
      user_id: user!.id,
      name,
      address: String(b.address ?? "").trim() || null,
      city: String(b.city ?? "").trim() || null,
      region: String(b.region ?? "").trim() || null,
      notes: String(b.notes ?? "").trim() || null,
    }).select("id").single();
    // The unique index is on (user_id, lower(name)) — say so in words.
    if (error) {
      if (String(error.code) === "23505") {
        return NextResponse.json({ error: `You already have a venue called “${name}”` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    await reportSystemError("api.venues.POST", err);
    return NextResponse.json({ error: "Could not add" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const b = (await request.json()) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
    if (typeof b.address === "string") patch.address = b.address.trim() || null;
    if (typeof b.city === "string") patch.city = b.city.trim() || null;
    if (typeof b.region === "string") patch.region = b.region.trim() || null;
    if (typeof b.notes === "string") patch.notes = b.notes.trim() || null;

    const { error } = await db.from("venues").update(patch).eq("id", id).eq("user_id", user!.id);
    if (error) {
      if (String(error.code) === "23505") {
        return NextResponse.json({ error: "Another venue already has that name" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.venues.PATCH", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

/** Delete only when no event points at it — checked here, not trusted. */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { count, error: cErr } = await db
      .from("event_intel").select("*", { count: "exact", head: true })
      .eq("venue_id", id).eq("user_id", user!.id);
    if (cErr) throw cErr;
    if (count && count > 0) {
      return NextResponse.json(
        { error: `${count} event${count === 1 ? " uses" : "s use"} this venue`, eventCount: count },
        { status: 409 }
      );
    }

    const { error } = await db.from("venues").delete().eq("id", id).eq("user_id", user!.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.venues.DELETE", err);
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  }
}
