/**
 * One vocabulary for "where".
 *
 * The city axis was joining two incompatible lists and silently returning zero.
 * Venues carry precise cities from Google ("San Jose", "Goleta", "Bronx",
 * "Coppell"); crew carry how a person describes home on a roster spreadsheet
 * ("Bay Area", "LA", "SLC", "Seattle/LV/NYC", "Orlando? Florida?"). Neither is
 * wrong — they answer different questions — but "who is local to this gig" needs
 * them in the same space.
 *
 * So both sides normalise to a METRO key. San Jose and "Bay Area" both become
 * `bay area`; Coppell becomes `dallas`; Goleta becomes `santa barbara`.
 *
 * YES, THIS IS A HAND-KEPT LIST, and I wrote a lesson this week against exactly
 * that. The difference is what a hand-kept list costs when it goes stale. A
 * recurring-client list is wrong the moment a client books again — the world
 * moves and the list does not. Metro geography does not move, and a MISS here
 * degrades to "no local crew in this city", which is the same answer as today
 * and visibly incomplete. It never invents a person in the wrong place. That
 * asymmetry is what makes the list acceptable here and not there.
 *
 * A roster entry can name several places ("Seattle/LV/NYC", "San Antonio /
 * Austin", "OC/LA") and all of them count — that is a person telling you where
 * they can work.
 */

/** Shorthand people actually type. */
const ALIAS: Record<string, string> = {
  sf: "san francisco",
  "san fran": "san francisco",
  la: "los angeles",
  oc: "orange county",
  nyc: "new york",
  slc: "salt lake city",
  lv: "las vegas",
  vegas: "las vegas",
  dc: "washington",
  "washington dc": "washington",
  "washington d.c.": "washington",
  "d.c.": "washington",
  "the bay": "bay area",
  bay: "bay area",
};

/**
 * City → metro. Only the cities that actually appear on either side, plus the
 * obvious neighbours; a speculative gazetteer would be pure maintenance cost.
 */
const METRO: Record<string, string> = {
  // Bay Area
  "san francisco": "bay area", oakland: "bay area", alameda: "bay area",
  berkeley: "bay area", "walnut creek": "bay area", novato: "bay area",
  "san jose": "bay area", "palo alto": "bay area", saratoga: "bay area",
  "santa clara": "bay area", sunnyvale: "bay area", "mountain view": "bay area",
  fremont: "bay area", hayward: "bay area", "san mateo": "bay area",
  "redwood city": "bay area", milpitas: "bay area", campbell: "bay area",
  "los gatos": "bay area", "menlo park": "bay area", cupertino: "bay area",
  "bay area": "bay area",
  // Greater LA
  "los angeles": "los angeles", "orange county": "los angeles",
  downey: "los angeles", hawthorne: "los angeles", "long beach": "los angeles",
  anaheim: "los angeles", pasadena: "los angeles", burbank: "los angeles",
  "santa monica": "los angeles", torrance: "los angeles", inglewood: "los angeles",
  socal: "los angeles",
  // New York
  "new york": "new york", bronx: "new york", brooklyn: "new york",
  queens: "new york", manhattan: "new york", "staten island": "new york",
  "jersey city": "new york", newark: "new york",
  // Phoenix
  phoenix: "phoenix", chandler: "phoenix", scottsdale: "phoenix",
  tempe: "phoenix", mesa: "phoenix", gilbert: "phoenix",
  // Dallas–Fort Worth
  dallas: "dallas", coppell: "dallas", plano: "dallas", irving: "dallas",
  frisco: "dallas", arlington: "dallas", "fort worth": "dallas",
  // Seattle
  seattle: "seattle", bellevue: "seattle", redmond: "seattle",
  kirkland: "seattle", tacoma: "seattle",
  // Singles that still need normalising
  goleta: "santa barbara", "santa barbara": "santa barbara",
  "salt lake city": "salt lake city",
  "las vegas": "las vegas",
  nashville: "nashville",
  washington: "washington",
};

const clean = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[?!]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Every metro a location string refers to.
 *
 * "Seattle/LV/NYC" → ["seattle", "las vegas", "new york"]. Unrecognised places
 * pass through as their own cleaned key, so a city nobody mapped still groups
 * with itself rather than vanishing.
 */
export function metroKeys(location: string | null | undefined): string[] {
  if (!location) return [];
  const parts = location.split(/\s*[/&,]\s*|\s+or\s+|\s+and\s+/i).map(clean).filter(Boolean);
  const out = new Set<string>();
  for (const p of parts) {
    // A string this code cannot read passes through UNCHANGED rather than being
    // guessed at. "Orlando? Florida?" has no separator to split on, so it stays
    // one key, `orlando florida`, which matches nothing and resolves to no
    // point — visibly unmapped, which is the honest outcome and is what
    // `unmappableLocations` reports so a human can fix the source string.
    const aliased = ALIAS[p] ?? p;
    out.add(METRO[aliased] ?? aliased);
  }
  return [...out];
}

/**
 * How to WRITE a metro key. The keys are lowercase and match-oriented; these are
 * what a person reads.
 *
 * Needed because the raw Google city is not the answer to "where was this".
 * A Bronx shoot and a Manhattan shoot are both New York; showing them as two
 * unrelated rows is how "Bronx" ended up in a list beside "San Francisco" as
 * though they were peers.
 */
const METRO_LABEL: Record<string, string> = {
  "new york": "New York City",
  "bay area": "Bay Area",
  "los angeles": "Los Angeles",
  phoenix: "Phoenix",
  dallas: "Dallas–Fort Worth",
  seattle: "Seattle",
  "salt lake city": "Salt Lake City",
  "las vegas": "Las Vegas",
  "santa barbara": "Santa Barbara",
  nashville: "Nashville",
  washington: "Washington DC",
};

/** Display name for a metro key; falls back to title-casing the key itself. */
export function metroLabel(key: string): string {
  return (
    METRO_LABEL[key] ??
    key.replace(/\b[a-z]/g, (c) => c.toUpperCase())
  );
}

/** The single best metro for a place — used where one label is needed. */
export function metroKey(location: string | null | undefined): string | null {
  return metroKeys(location)[0] ?? null;
}

// ── putting metros on a map ─────────────────────────────────────────────────

/**
 * Where each metro IS.
 *
 * Mason, 2026-08-15: "maybe a more useful tool is to choose a location and then
 * have a slider/field for MILES FROM so I can find anyone within 500 miles of
 * any city I want."
 *
 * That question cannot be answered by the keys above. A metro key is a MATCHING
 * VOCABULARY — two strings that mean the same market — and it is deliberately
 * permissive: anything unrecognised passes through as itself so it still groups
 * with its own kind. "east coast", "kentucky" and "eu" are perfectly good keys
 * and are not places you can measure from. Distance needs points, and points
 * have to be curated.
 *
 * ── Why a hand-kept table is right HERE and wrong elsewhere ──
 *
 * The same asymmetry that justifies METRO above. Coordinates do not go stale:
 * Chicago will not move, and a metro missing from this table degrades to "we
 * cannot place this person", which is exactly what the UI says and what
 * `unmappableLocations` lists for fixing. It never invents a person 200 miles
 * from where they live. A wrong-but-plausible distance would be the dangerous
 * failure; an absent one is merely incomplete.
 *
 * ── Why there is no `crew.home_metros` column ──
 *
 * The earlier plan was to store each person's markets. It is not needed and it
 * would be a cache to invalidate: 61 active crew is a roster already loaded
 * whole, `metroKeys(city)` already reads "Seattle/LV/NYC" as three markets, and
 * a stored copy would silently go stale the moment somebody edits their city on
 * /intel — the drift being invisible, which is the worst kind. Derive at read
 * time from the one string a human maintains. If a person works a market they
 * do not live in, the honest fix is their city string or a bigger radius, not a
 * second source of truth.
 *
 * Coordinates are metro centres to about a mile, which is far finer than any
 * band below cares about. Everything here appears on the live roster or on a
 * venue; a speculative gazetteer is pure maintenance cost.
 */
const METRO_POINT: Record<string, { lat: number; lng: number }> = {
  // West
  "bay area": { lat: 37.7749, lng: -122.4194 },
  "los angeles": { lat: 34.0522, lng: -118.2437 },
  "san diego": { lat: 32.7157, lng: -117.1611 },
  monterey: { lat: 36.6002, lng: -121.8947 },
  "santa barbara": { lat: 34.4208, lng: -119.6982 },
  tahoe: { lat: 39.0968, lng: -120.0324 },
  "las vegas": { lat: 36.1699, lng: -115.1398 },
  phoenix: { lat: 33.4484, lng: -112.074 },
  "salt lake city": { lat: 40.7608, lng: -111.891 },
  seattle: { lat: 47.6062, lng: -122.3321 },
  // Central
  dallas: { lat: 32.7767, lng: -96.797 },
  austin: { lat: 30.2672, lng: -97.7431 },
  "san antonio": { lat: 29.4241, lng: -98.4936 },
  "new orleans": { lat: 29.9511, lng: -90.0715 },
  nashville: { lat: 36.1627, lng: -86.7816 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  detroit: { lat: 42.3314, lng: -83.0458 },
  // East
  "new york": { lat: 40.7128, lng: -74.006 },
  boston: { lat: 42.3601, lng: -71.0589 },
  washington: { lat: 38.9072, lng: -77.0369 },
  atlanta: { lat: 33.749, lng: -84.388 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  miami: { lat: 25.7617, lng: -80.1918 },
  // Canada
  toronto: { lat: 43.6532, lng: -79.3832 },
};

/** Great-circle distance in statute miles. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // mean Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Every mappable point a location string refers to, with its metro key. */
export function metroPoints(
  location: string | null | undefined
): { key: string; lat: number; lng: number }[] {
  return metroKeys(location)
    .map((key) => {
      const p = METRO_POINT[key];
      return p ? { key, lat: p.lat, lng: p.lng } : null;
    })
    .filter((p): p is { key: string; lat: number; lng: number } => p !== null);
}

/** Can this location be put on a map at all? */
export function isMappable(location: string | null | undefined): boolean {
  return metroPoints(location).length > 0;
}

export interface MetroDistance {
  miles: number;
  /** WHICH of their markets this measured from — "Seattle/LV/NYC" has three. */
  fromKey: string;
  band: DistanceBand;
}

/**
 * How far is this person from that place, measured from their NEAREST market.
 *
 * Null when either side cannot be placed. A null is a reportable state, never a
 * silent exclusion: 3 of 61 active crew carry a location no map can read ("EU",
 * "Kentucky", "Orlando? Florida?"), and dropping them from a staffing search
 * without saying so is the same failure as reading an unset `travels` flag as
 * "will not travel" — half a roster gone with nothing on screen to explain it.
 */
export function metroDistance(
  from: string | null | undefined,
  to: string | null | undefined
): MetroDistance | null {
  const a = metroPoints(from);
  const b = metroPoints(to);
  if (!a.length || !b.length) return null;

  let best: MetroDistance | null = null;
  for (const p of a) {
    for (const q of b) {
      const miles = haversineMiles(p, q);
      if (!best || miles < best.miles) {
        best = { miles, fromKey: p.key, band: distanceBand(miles) };
      }
    }
  }
  return best;
}

/**
 * How you would GET there — Mason's own framing, and better than a number.
 *
 * ⚠️ These are STRAIGHT-LINE miles, not road miles. Driving is routinely 15–25%
 * further than the crow flies, so the thresholds are set against the crow
 * figure and read against the drive: 300 crow miles is roughly a 350–380 mile
 * drive, about six hours with gear, which is the real edge of "just drive it".
 * Never relabel these as road distance — a number that reads as one thing and
 * measures another is how an estimate becomes a fact nobody rechecks.
 *
 * The boundary that matters most here is Bay Area → Los Angeles, 347 crow
 * miles, which lands as a SHORT FLIGHT. That is the honest answer for a
 * one-day booking even though Mason has certainly driven it.
 */
export type DistanceBand = "drivable" | "short flight" | "long haul";

export const DISTANCE_BANDS: { band: DistanceBand; maxMiles: number | null }[] = [
  { band: "drivable", maxMiles: 300 },
  { band: "short flight", maxMiles: 1200 },
  { band: "long haul", maxMiles: null },
];

export function distanceBand(miles: number): DistanceBand {
  if (miles <= 300) return "drivable";
  if (miles <= 1200) return "short flight";
  return "long haul";
}

/**
 * The location strings on this roster that no map can read.
 *
 * Fixing one is editing that person's city on /intel — this exists so the gap
 * is a short, nameable list of human work rather than an unexplained hole in
 * every search result.
 */
export function unmappableLocations(
  people: { display_name?: string | null; city?: string | null }[]
): { name: string; city: string }[] {
  return people
    .filter((p) => (p.city ?? "").trim() && !isMappable(p.city))
    .map((p) => ({ name: p.display_name ?? "(unnamed)", city: (p.city ?? "").trim() }));
}
