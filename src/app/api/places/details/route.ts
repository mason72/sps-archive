import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";
import { placeDetails, placesConfigured } from "@/lib/places/google";

/** Resolve one Places pick to name, address, city, region, country, lat/lng. */
export async function GET(request: NextRequest) {
  try {
    const { error: authError } = await getIntelUser();
    if (authError) return authError;
    if (!placesConfigured()) return NextResponse.json({ error: "Maps search is not configured" }, { status: 503 });

    const sp = new URL(request.url).searchParams;
    const id = sp.get("id") ?? "";
    const session = sp.get("session") ?? "";
    if (!id || !session || session.length > 64) return NextResponse.json({ error: "id and session required" }, { status: 400 });

    const place = await placeDetails(id, session);
    return NextResponse.json({ place });
  } catch (err) {
    await reportSystemError("api.places.details", err);
    return NextResponse.json({ error: "Could not load that place" }, { status: 502 });
  }
}
