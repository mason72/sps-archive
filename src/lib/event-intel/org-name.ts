/**
 * What to CALL an organisation.
 *
 * The domain is the identity — opusagency.com is one company however the gig was
 * titled — but it is a terrible display name. Capitalising the stem produced
 * "Collegeboard", "Ebay", "Fm", "Getclario Ai" and "Episode1agency", none of
 * which is what anyone calls those companies.
 *
 * So identity and label are separated, exactly as they are for crew: the domain
 * keys the row, and the NAME comes from how Mason actually writes it in his gig
 * titles. Same principle as the gallery-name suggester — his wording wins, and
 * anything else is a machine overruling the person who knows the client.
 *
 * Order of preference:
 *   1. `BRAND_CASE`, for companies whose own orthography is a known fact.
 *   2. The gig titles this org appears in, matched against the domain stem.
 *      "College Board // NASAI 2026" yields "College Board" for collegeboard.org
 *      because a two-token window concatenates to the stem.
 *   3. The domain stem, spaced and cased as well as can be managed.
 *
 * Step 2 is why this takes the titles rather than living in the importer: the
 * answer is in the corpus of names, not in the address.
 */
import { BRAND_CASE_LOOKUP } from "./parse-calendar";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The label part of a domain: "getclario.ai" → "getclario". */
export function domainStem(domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length === 0) return "";
  // Drop the TLD, and a country-code second level ("co.uk") with it.
  const drop = parts.length >= 3 && parts[parts.length - 2].length <= 3 ? 2 : 1;
  return parts.slice(0, Math.max(1, parts.length - drop)).join("");
}

/**
 * Find the org's own name inside a gig title.
 *
 * Windows of one to four tokens are concatenated and compared to the stem, so
 * "College Board" finds collegeboard and "Type A Events" finds typeaevents. Only
 * the first segment is searched — "Appfolio Headshots // Goleta office" names
 * the client at the front and the location after, and a window that crossed the
 * separator could return "Headshots Goleta".
 */
export function nameFromTitles(stem: string, titles: string[]): string | null {
  const target = norm(stem);
  if (!target) return null;
  let best: string | null = null;
  for (const title of titles) {
    const head = title.split(/\s*(?:\/\/|\|)\s*/)[0];
    const tokens = head.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      for (let n = 1; n <= 4 && i + n <= tokens.length; n++) {
        const window = tokens.slice(i, i + n);
        const joined = norm(window.join(""));
        if (joined !== target) continue;
        const candidate = window.join(" ").replace(/[^A-Za-z0-9&'\s.-]/g, "").trim();
        // Prefer the spaced form: "College Board" over "CollegeBoard", because
        // the spacing is the fact Mason corrected me on.
        if (!best || window.length > best.split(/\s+/).length) best = candidate;
      }
    }
  }
  return best;
}

/** Last resort: make the stem as readable as it can be without inventing words. */
function humanizeStem(stem: string): string {
  if (!stem) return "";
  // An all-consonant short stem is an acronym, not a word: oxw → OXW, str → STR.
  if (stem.length <= 4 && !/[aeiou]/.test(stem.replace(/^[aeiou]/, ""))) return stem.toUpperCase();
  if (stem.length <= 3) return stem.toUpperCase();
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Marketing prefixes a company puts on its domain but not on its name.
 * getclario.ai is Clario; the "get" was only ever there because clario.ai was
 * taken. Stripped only for the TITLE search — never for the identity key, which
 * stays the full domain.
 */
const DOMAIN_PREFIX = /^(?:get|try|use|join|go|my|the|hey|with)(?=[a-z]{4,})/;

export function orgDisplayName(domain: string, titles: string[] = []): string {
  const stem = domainStem(domain);
  const brand = BRAND_CASE_LOOKUP(stem);
  if (brand) return brand;

  const fromTitle = nameFromTitles(stem, titles);
  if (fromTitle) return fromTitle;

  const stripped = stem.replace(DOMAIN_PREFIX, "");
  if (stripped !== stem) {
    const brandStripped = BRAND_CASE_LOOKUP(stripped);
    if (brandStripped) return brandStripped;
    const fromTitleStripped = nameFromTitles(stripped, titles);
    if (fromTitleStripped) return fromTitleStripped;
  }

  return humanizeStem(stem);
}
