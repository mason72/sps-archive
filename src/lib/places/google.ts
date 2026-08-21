/**
 * Google Places API (New) — server-side only.
 *
 * The key lives in `GOOGLE_PLACES_KEY` and reaches Google through a request
 * HEADER from this process; it is never shipped to the browser and never put
 * in a URL or an argv. The browser talks to `/api/places/*`, which talks here.
 *
 * Why Places at all: venues were "301 Battery St" for 10 of 17 rows because the
 * calendar gave bare addresses. A Places pick gives the real name, a clean
 * address, the city the Cities axis groups on, coordinates for the radius
 * search, and a `place_id` that makes the same building impossible to create
 * twice (unique index, migration 070).
 *
 * Cost: Autocomplete and Place Details (the fields used here) both sit in the
 * free monthly tier at this volume. A session token ties one typing session's
 * autocomplete calls to its final details call so they bill as one session.
 */

const BASE = "https://places.googleapis.com/v1";

export function placesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_KEY;
}

function headers(fieldMask: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY ?? "",
    "X-Goog-FieldMask": fieldMask,
  };
}

export interface PlaceSuggestion {
  placeId: string;
  /** The venue name as Google shows it. */
  name: string;
  /** The rest of the line — street, city. */
  secondary: string;
}

export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  bias?: { lat: number; lng: number }
): Promise<PlaceSuggestion[]> {
  const q = input.trim();
  if (q.length < 2) return [];
  const body: Record<string, unknown> = {
    input: q,
    sessionToken,
    // Establishments and addresses both; a venue can legitimately be either.
    includedRegionCodes: ["us", "ca", "mx"],
  };
  if (bias) {
    body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } };
  }
  const res = await fetch(`${BASE}/places:autocomplete`, {
    method: "POST",
    headers: headers("suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat"),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`places:autocomplete ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }[];
  };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    }))
    .filter((p) => p.name);
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails> {
  const url = `${BASE}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    headers: headers("id,displayName,formattedAddress,addressComponents,location"),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`places:details ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const p = (await res.json()) as {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
    location?: { latitude?: number; longitude?: number };
  };
  const comp = (type: string, short = false) => {
    const c = p.addressComponents?.find((x) => x.types?.includes(type));
    return (short ? c?.shortText : c?.longText) ?? null;
  };
  // Google's "city" is `locality`; some places only carry postal_town or a
  // sublocality (NYC boroughs). Take the first that exists, in that order.
  const city = comp("locality") ?? comp("postal_town") ?? comp("sublocality_level_1") ?? comp("sublocality");
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    city,
    region: comp("administrative_area_level_1", true),
    country: comp("country", true),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  };
}
