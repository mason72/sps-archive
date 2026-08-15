import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Clients — the label, not the identity.
 *
 * The DOMAIN keys an organisation: opusagency.com is one company however the
 * gig was titled. The NAME is what Mason calls them, and deriving it from the
 * domain produced "Collegeboard", "Ebay", "Fm", "Getclario Ai". Six fixed
 * themselves from his own gig titles; the rest need a human, which is what
 * this is for.
 *
 * Editing the name never touches `domains`, so correcting a label can never
 * split one company into two — the trap this separation exists to avoid.
 */

const KINDS = ["agency", "brand", "venue_host", "individual", "unknown"];

export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { data, error } = await db
      .from("organizations")
      .select("id, name, domains, kind, notes")
      .eq("user_id", user!.id)
      .order("name");
    if (error) throw error;

    const { data: links, error: lErr } = await db
      .from("event_orgs").select("org_id").eq("user_id", user!.id);
    if (lErr) throw lErr;
    const counts = new Map<string, number>();
    for (const r of links ?? []) counts.set(r.org_id, (counts.get(r.org_id) ?? 0) + 1);

    return NextResponse.json({
      orgs: (data ?? []).map((o: Record<string, unknown>) => ({
        ...o,
        eventCount: counts.get(o.id as string) ?? 0,
      })),
      kinds: KINDS,
    });
  } catch (err) {
    await reportSystemError("api.organizations.GET", err);
    return NextResponse.json({ error: "Could not load clients" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const b = (await request.json()) as Record<string, string>;
    const name = String(b.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });

    const domain = String(b.domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    const { data, error } = await db.from("organizations").insert({
      user_id: user!.id,
      name,
      domains: domain ? [domain] : [],
      kind: KINDS.includes(String(b.kind)) ? b.kind : "unknown",
      notes: String(b.notes ?? "").trim() || null,
    }).select("id").single();
    if (error) {
      if (String(error.code) === "23505") {
        return NextResponse.json({ error: `You already have a client called “${name}”` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    await reportSystemError("api.organizations.POST", err);
    return NextResponse.json({ error: "Could not add" }, { status: 500 });
  }
}

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
    if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
    if (typeof b.kind === "string" && KINDS.includes(b.kind)) patch.kind = b.kind;
    if (typeof b.notes === "string") patch.notes = b.notes.trim() || null;
    // Domains are the IDENTITY. Editable, but deliberately as a whole list and
    // never as a side effect of renaming.
    if (Array.isArray(b.domains)) {
      patch.domains = b.domains
        .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter(Boolean);
    }

    const { error } = await db.from("organizations").update(patch).eq("id", id).eq("user_id", user!.id);
    if (error) {
      if (String(error.code) === "23505") {
        return NextResponse.json({ error: "Another client already has that name" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.organizations.PATCH", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { count, error: cErr } = await db
      .from("event_orgs").select("*", { count: "exact", head: true })
      .eq("org_id", id).eq("user_id", user!.id);
    if (cErr) throw cErr;
    if (count && count > 0) {
      return NextResponse.json(
        { error: `On ${count} event${count === 1 ? "" : "s"} — rename it instead`, eventCount: count },
        { status: 409 }
      );
    }

    const { error } = await db.from("organizations").delete().eq("id", id).eq("user_id", user!.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.organizations.DELETE", err);
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  }
}
