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
    // "Orlando? Florida?" leaves two guesses; both are kept, both are weak, and
    // neither is a claim this code made up.
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
