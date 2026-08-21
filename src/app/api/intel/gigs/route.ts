import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * "Which gig is this from?" — the composer's gig picker.
 *
 *   ?venueId=   gigs held at this venue
 *   ?orgId=     gigs for this client
 *   ?on=ISO     gigs within a day of this date (a photo's EXIF date)
 *
 * Filters intersect when several are given. Newest first, capped, and
 * every leg scoped to the owner. The date leg is what lets a dropped photo
 * propose its own gig: EXIF says Tuesday, exactly one event sits on Tuesday.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;
    const sp = new URL(request.url).searchParams;
    const venueId = sp.get("venueId");
    const orgId = sp.get("orgId");
    const on = sp.get("on");

    let ids: Set<string> | null = null;
    const narrow = (list: string[]) => {
      const s = new Set(list);
      ids = ids ? new Set([...ids].filter((x) => s.has(x))) : s;
    };
    if (venueId) {
      const { data, error } = await db.from("event_intel").select("event_id").eq("user_id", user!.id).eq("venue_id", venueId);
      if (error) throw error;
      narrow((data ?? []).map((r: { event_id: string }) => r.event_id));
    }
    if (orgId) {
      const { data, error } = await db.from("event_orgs").select("event_id").eq("user_id", user!.id).eq("org_id", orgId);
      if (error) throw error;
      narrow((data ?? []).map((r: { event_id: string }) => r.event_id));
    }

    let q = db.from("events").select("id, name, sort_date").eq("user_id", user!.id)
      .order("sort_date", { ascending: false, nullsFirst: false }).order("id").limit(40);
    if (ids) {
      const list = [...(ids as Set<string>)];
      if (list.length === 0) return NextResponse.json({ gigs: [] });
      q = q.in("id", list.slice(0, 200));
    }
    if (on && Number.isFinite(Date.parse(on))) {
      const d = new Date(on);
      const lo = new Date(d.getTime() - 36 * 3600 * 1000).toISOString().slice(0, 10);
      const hi = new Date(d.getTime() + 36 * 3600 * 1000).toISOString().slice(0, 10);
      q = q.gte("sort_date", lo).lte("sort_date", hi);
    }
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({
      gigs: (data ?? []).map((e: { id: string; name: string; sort_date: string | null }) => ({ id: e.id, name: e.name, date: e.sort_date })),
    });
  } catch (err) {
    await reportSystemError("api.intel.gigs.GET", err);
    return NextResponse.json({ error: "Could not load gigs" }, { status: 500 });
  }
}
