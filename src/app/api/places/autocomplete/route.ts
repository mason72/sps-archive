import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";
import { autocompletePlaces, placesConfigured } from "@/lib/places/google";

/**
 * Venue search against Google Places, proxied so the key never leaves the
 * server. Gated on Event Intel like every other venue route: this is a paid
 * upstream and the only caller is the venue picker.
 *
 * `configured: false` is a real answer, not an error — the picker shows known
 * venues and says Maps search is off, rather than a spinner that never ends.
 */
export async function GET(request: NextRequest) {
  try {
    const { error: authError } = await getIntelUser();
    if (authError) return authError;
    if (!placesConfigured()) return NextResponse.json({ configured: false, suggestions: [] });

    const sp = new URL(request.url).searchParams;
    const q = sp.get("q") ?? "";
    const session = sp.get("session") ?? "";
    if (!session || session.length > 64) return NextResponse.json({ error: "session required" }, { status: 400 });
    const lat = Number(sp.get("lat"));
    const lng = Number(sp.get("lng"));
    const bias = Number.isFinite(lat) && Number.isFinite(lng) && sp.get("lat") ? { lat, lng } : undefined;

    const suggestions = await autocompletePlaces(q, session, bias);
    return NextResponse.json({ configured: true, suggestions });
  } catch (err) {
    await reportSystemError("api.places.autocomplete", err);
    return NextResponse.json({ error: "Maps search failed" }, { status: 502 });
  }
}
