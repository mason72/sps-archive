/**
 * Reading a Two Dudes calendar entry — crew, client, city, venue.
 *
 * This is the load-bearing half of Event Intel (`tasks/event-intel.md`). The
 * backfill runs it over twelve years of history; the upload-time confirm card
 * runs it over one gig. Same function, two callers — which is why it is pure and
 * takes plain data rather than reaching for a calendar client.
 *
 * DELIBERATELY BESPOKE. The title convention, the `** SECTION` headers and the
 * pasted intake form are Two Dudes habits, not a standard. Do not try to
 * generalise this into "a calendar parser"; the schema it feeds is generic, this
 * is not (see the doc's "generic tables, bespoke ingestion").
 *
 * Everything here is a SUGGESTION for a human to confirm. It never decides.
 * Every extraction carries what it was derived from so the confirm card can show
 * its working, and a wrong guess is visible rather than silently authoritative.
 */

/** Shapes we need from a Google Calendar event. Structural on purpose. */
export interface CalendarEventLike {
  id?: string;
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  start?: { date?: string | null; dateTime?: string | null } | null;
  end?: { date?: string | null; dateTime?: string | null } | null;
  attendees?: { email?: string | null; displayName?: string | null }[] | null;
}

export interface ParsedGig {
  /** Crew names as WRITTEN IN THE TITLE — uppercase first names, usually. */
  titleCrew: string[];
  /** Attendees, which carry the stable identity. */
  attendees: { email: string; displayName: string | null }[];
  /** Client/brand as written in the title, e.g. "Perkin Elmer SKO". */
  client: string | null;
  /** City when the title carries one as its own segment. */
  city: string | null;
  /** The calendar's own `location` field, untouched. */
  venue: string | null;
  /** Named sections lifted from the description (`** ONSITE CONTACT`, etc.). */
  sections: Record<string, string>;
  /** Any email found in the body — the onsite contact resolves the payer. */
  contactEmails: string[];
  /** Why we think this is (or is not) a gig. */
  kind: GigKind;
  /** Human-readable trace of what was derived from where. */
  notes: string[];
}

export type GigKind =
  | "gig"        // a real job
  | "setup"      // load-in / set-up for a job, same client
  | "travel"     // flight, hotel, car
  | "admin"      // meetings, holds, availability
  | "unknown";

/** Title separators, in the order they are tried. Both are in real use. */
const SEGMENT_SPLIT = /\s*(?:\/\/|\|)\s*/;

/** Crew are separated by & or comma: "JOEY & JERRICK & CARI", "JOEY, JERRICK". */
const CREW_SPLIT = /\s*(?:&|,|\+)\s*/;

/**
 * Bracketed or all-caps status words that lead a title and are not crew.
 * Seen live: "[SLAM]", "BOOKED | …", "HOLD", "TENTATIVE".
 */
const STATUS_PREFIX = /^\s*(?:\[[^\]]*\]|\b(?:BOOKED|HOLD|TENTATIVE|CONFIRMED|CANCELLED|POSTPONED)\b)\s*[|/]*\s*/i;

const TRAVEL = /\b(?:flight|hotel|airbnb|rental car|check[- ]?in|check[- ]?out|departs?|arrives?)\b/i;
/**
 * Admin words split by strength, which real data forced.
 *
 * STRONG words are never a job, whatever else the entry carries: a BNI meeting
 * held at Le Méridien has a venue, and the first version required the ABSENCE of
 * a venue before calling something admin, so it fell through to "unknown" and
 * was then counted as a gig.
 *
 * WEAK words can legitimately name a job — Mason has 76 holiday parties — so
 * they only mean admin when there is no crew, no attendees and no venue.
 */
const ADMIN_STRONG = /\b(?:BNI|meeting|sync|stand[- ]?up|1:1|payroll|invoice|reminder|demo|training|webinar|interview)\b/i;
const ADMIN_WEAK = /\b(?:holiday|vacation|unavailab|available|PTO|blocked|out of office|OOO)\b/i;
const SETUP = /\b(?:set[- ]?up|setup|load[- ]?in|strike|tear[- ]?down|breakdown)\b/i;

/** A crew segment is short, mostly letters, and usually shouty. */
function looksLikeCrewSegment(seg: string): boolean {
  if (!seg) return false;
  const parts = seg.split(CREW_SPLIT).filter(Boolean);
  if (!parts.length || parts.length > 6) return false;
  // Every part should read like a first name: one or two words, no digits.
  if (!parts.every((p) => /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?$/.test(p.trim()))) {
    return false;
  }
  // The convention is uppercase. Requiring it is what stops "Stanford Event"
  // (a client) being read as a crew member called Stanford.
  const letters = seg.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  const upperRatio = (seg.replace(/[^A-Z]/g, "").length) / letters.length;
  return upperRatio > 0.8;
}

/** Cities appear as their own trailing segment, e.g. "… // Scottsdale". */
function looksLikeCitySegment(seg: string): boolean {
  if (!seg) return false;
  const words = seg.trim().split(/\s+/);
  if (words.length > 3) return false;
  if (/\d/.test(seg)) return false;
  // A city segment is Title Case or an uppercase abbreviation (SF, NYC, DC).
  return /^[A-Z]/.test(seg.trim());
}

/**
 * Split the description into its `** SECTION` blocks.
 *
 * The 2014–2018 entries use `** ONSITE CONTACT`, `** SCHEDULE`, `** LOAD IN`;
 * by 2023 the body is a pasted intake form with bold labels instead. Both are
 * handled — the later ones simply yield more sections.
 */
export function parseDescriptionSections(html: string | null | undefined): Record<string, string> {
  if (!html) return {};
  const text = htmlToText(html);
  const out: Record<string, string> = {};

  // `** SECTION NAME` … up to the next `**` or end.
  const starRe = /^\s*\*{2,}\s*([A-Z][A-Z0-9 &/'’-]{2,40})\s*$/gm;
  const marks: { name: string; at: number; len: number }[] = [];
  for (let m = starRe.exec(text); m; m = starRe.exec(text)) {
    marks.push({ name: m[1].trim(), at: m.index, len: m[0].length });
  }
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].at + marks[i].len;
    const to = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const body = text.slice(from, to).trim();
    if (body) out[normaliseSectionName(marks[i].name)] = body;
  }

  // Bare "LABEL" on its own line followed by content — the 2023 intake shape.
  if (Object.keys(out).length === 0) {
    const lineRe = /^([A-Z][A-Za-z0-9 &/'’-]{2,40})\s*$/gm;
    const hits: { name: string; at: number; len: number }[] = [];
    for (let m = lineRe.exec(text); m; m = lineRe.exec(text)) {
      hits.push({ name: m[1].trim(), at: m.index, len: m[0].length });
    }
    for (let i = 0; i < hits.length; i++) {
      const from = hits[i].at + hits[i].len;
      const to = i + 1 < hits.length ? hits[i + 1].at : text.length;
      const body = text.slice(from, to).trim();
      if (body && body.length < 2000) out[normaliseSectionName(hits[i].name)] = body;
    }
  }
  return out;
}

const SECTION_ALIASES: Record<string, string> = {
  "ONSITE CONTACT": "onsiteContact",
  "PRIMARY CONTACT": "primaryContact",
  "LOAD IN": "loadIn",
  "LOAD OUT": "loadOut",
  SCHEDULE: "schedule",
  BACKDROP: "backdrop",
  PROPS: "props",
  PRINTS: "prints",
  FREIGHT: "freight",
  GALLERY: "gallery",
  LOCATION: "location",
  NOTES: "notes",
  SHARING: "sharing",
  "SAVE FOLDER": "saveFolder",
  "WORKING FOLDER": "saveFolder",
  "DATA CAPTURE": "dataCapture",
};

function normaliseSectionName(raw: string): string {
  const key = raw.toUpperCase().replace(/\s+/g, " ").trim();
  return SECTION_ALIASES[key] ?? key.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
}

/** Google stores descriptions as HTML with entities and <br>. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h\d)>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Google escapes some bodies as \x3C etc.
    .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Trim an address that ran into the text after it.
 *
 * Descriptions concatenate without spaces once the tags are stripped, so
 * "…mtran@axosbank.com" followed by "Onsite Contact" matches as
 * "mtran@axosbank.comOnsite" — and the payer domain came out as
 * "episode1agency.comonsite", which would have created an organisation per
 * typo. A lowercase→uppercase transition inside the domain is the seam.
 */
function trimRunOnEmail(email: string): string {
  const m = /^([\w.+-]+@[\w-]+(?:\.[a-z]{2,24})*?\.[a-z]{2,6})(?=[A-Z]|$)/.exec(email);
  return m ? m[1] : email;
}

/** Emails inside the body — the onsite contact is how the payer is resolved. */
export function extractContactEmails(html: string | null | undefined): string[] {
  if (!html) return [];
  const text = htmlToText(html);
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => trimRunOnEmail(e).toLowerCase()))];
}

/** Is this entry a job, or calendar furniture? */
export function classifyGig(ev: CalendarEventLike): GigKind {
  const title = (ev.summary ?? "").trim();
  if (!title) return "unknown";
  if (TRAVEL.test(title)) return "travel";
  // Strong admin outranks everything: a meeting is not a job even at a hotel.
  if (ADMIN_STRONG.test(title)) return "admin";
  if (SETUP.test(title)) return "setup";
  const hasCrew = looksLikeCrewSegment(stripStatus(title).split(SEGMENT_SPLIT)[0] ?? "");
  const hasPeople = (ev.attendees ?? []).length > 0;
  const hasVenue = !!(ev.location ?? "").trim();
  // Weak admin words only win when nothing suggests a job.
  if (ADMIN_WEAK.test(title) && !hasCrew && !hasPeople && !hasVenue) return "admin";
  if (hasCrew || (hasPeople && hasVenue)) return "gig";
  return "unknown";
}

const stripStatus = (t: string) => t.replace(STATUS_PREFIX, "");

/**
 * Parse one calendar entry into its parts.
 *
 * Title shapes seen live, all handled:
 *   JOEY & JERRICK & CRISTINA & CARI // Perkin Elmer SKO // Scottsdale
 *   CHRISTIE & JUSTIN | Grace Cathedral Event
 *   [SLAM] JOEY, JERRICK | Axos Bank Headshots
 *   BOOKED | Boxworks 2016 SF
 */
export function parseGig(ev: CalendarEventLike): ParsedGig {
  const notes: string[] = [];
  const rawTitle = (ev.summary ?? "").trim();
  const title = stripStatus(rawTitle);
  if (title !== rawTitle) notes.push("stripped a status prefix from the title");

  const segments = title.split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean);

  let titleCrew: string[] = [];
  let client: string | null = null;
  let city: string | null = null;

  if (segments.length) {
    if (looksLikeCrewSegment(segments[0])) {
      titleCrew = segments[0].split(CREW_SPLIT).map((s) => s.trim()).filter(Boolean);
      notes.push(`crew from title: ${titleCrew.join(", ")}`);
      if (segments.length >= 2) client = segments[1];
      // A third segment is the city by convention; a two-word Title Case tail
      // after the client is the giveaway.
      if (segments.length >= 3 && looksLikeCitySegment(segments[segments.length - 1])) {
        city = segments[segments.length - 1];
      }
    } else {
      // No crew in the title — the whole thing is the job name.
      client = segments.length > 1 ? segments[1] : segments[0];
      notes.push("no crew segment in the title; attendees are the only crew signal");
      if (segments.length >= 2 && looksLikeCitySegment(segments[segments.length - 1])) {
        city = segments[segments.length - 1];
      }
    }
  }
  // A city that is also the client segment is not a city.
  if (city && city === client) city = null;

  const attendees = (ev.attendees ?? [])
    .map((a) => ({
      email: (a.email ?? "").trim().toLowerCase(),
      displayName: (a.displayName ?? "").trim() || null,
    }))
    .filter((a) => a.email);

  const sections = parseDescriptionSections(ev.description);
  const contactEmails = extractContactEmails(ev.description);
  const venue = (ev.location ?? "").trim() || null;
  if (venue) notes.push(`venue from the calendar's location field`);

  const kind = classifyGig(ev);

  return { titleCrew, attendees, client, city, venue, sections, contactEmails, kind, notes };
}

/**
 * Group entries into gigs.
 *
 * ONE Pixieset collection is often several calendar entries — the Axos job is
 * set-up on the 16th, headshots on the 17th and an evening reception, three
 * rows. Matching 1:1 would pick one arbitrarily and lose the crew who appear
 * only on the others, so grouping happens BEFORE matching.
 *
 * Grouped by client (normalised) plus date adjacency: entries for the same
 * client whose days touch or overlap are one gig.
 */
export function groupIntoGigs(
  events: CalendarEventLike[],
  { maxGapDays = 1 }: { maxGapDays?: number } = {}
): { client: string | null; start: string; end: string; events: CalendarEventLike[] }[] {
  const dated = events
    .map((e) => ({ e, day: startDay(e), parsed: parseGig(e) }))
    /**
     * Only actual jobs group. Filtering by "not travel and not admin" let
     * `unknown` through, so on a real 2014 week three gigs were reported as
     * seven — every unclassifiable entry became its own gig. An entry we cannot
     * read is not evidence of a job.
     */
    .filter((x) => x.day && (x.parsed.kind === "gig" || x.parsed.kind === "setup"))
    .sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : 0));

  const out: { client: string | null; start: string; end: string; events: CalendarEventLike[] }[] = [];
  for (const item of dated) {
    const key = normaliseClient(item.parsed.client);
    const open = out.find(
      (g) =>
        normaliseClient(g.client) === key &&
        daysBetween(g.end, item.day!) <= maxGapDays
    );
    if (open) {
      open.events.push(item.e);
      if (item.day! > open.end) open.end = item.day!;
    } else {
      out.push({ client: item.parsed.client, start: item.day!, end: item.day!, events: [item.e] });
    }
  }
  return out;
}

export function startDay(e: CalendarEventLike): string | null {
  const raw = e.start?.date ?? e.start?.dateTime ?? null;
  return raw ? raw.slice(0, 10) : null;
}

/** Client names vary in case, punctuation and trailing year — normalise to compare. */
export function normaliseClient(name: string | null): string {
  if (!name) return "";
  return (
    name
      .toLowerCase()
      /**
       * A set-up entry names its gig: "Set Up for Axos Bank Headshots". Left in,
       * it normalises to a different client from the gig itself and the two
       * refuse to group — which is the exact failure this grouping exists to
       * prevent, since the set-up entry often carries crew the main day does not.
       */
      .replace(/^\s*(?:set[- ]?up|setup|load[- ]?in|strike|tear[- ]?down|breakdown)\s+(?:for\s+)?/i, " ")
      .replace(/\b(20\d{2}|fy\d{2})\b/g, " ")
      .replace(/\b(sko|headshots?|event|photos?|photo booth|gala|party|conference|summit)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86400000));
}

// ── venues ──────────────────────────────────────────────────────────────────

export interface ParsedVenue {
  /** The room, when the string names one. Null for a bare street address. */
  name: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  country: string | null;
  /** The original string, always kept — parsing is a convenience, not a truth. */
  raw: string;
}

const COUNTRY = /^(united states|usa|us|canada|united kingdom|uk|mexico|france|germany|spain|italy|japan|australia)$/i;
/** "CA" or "CA 94111" — a US state, optionally with its ZIP. */
const STATE_ZIP = /^([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/;
/** A part beginning with a house number is a street, not a venue name. */
const STARTS_WITH_NUMBER = /^\d/;

/**
 * Split a calendar `location` into its parts.
 *
 * Measured across 2,477 real strings: 2,114 are full Google-formatted addresses
 * ("Fox Theatre, 2215 Broadway Street, Redwood City, CA 94063, United States"),
 * 301 are a name with a partial address, and 62 are a bare name ("Four seasons").
 *
 * The distinction that matters is whether the FIRST part is a name or a street:
 * "301 Battery St, San Francisco, …" names no venue at all, and inventing one
 * called "301 Battery St" would create a venue per street address and defeat the
 * point of a venue registry. A leading house number is the tell.
 *
 * `raw` is always preserved. This parse is for grouping and display; when it is
 * wrong, the original string is still there to correct it from.
 */
export function parseVenue(location: string | null | undefined): ParsedVenue | null {
  const raw = (location ?? "").trim();
  if (!raw) return null;

  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const out: ParsedVenue = {
    name: null, street: null, city: null, region: null, postal: null, country: null, raw,
  };
  if (!parts.length) return out;

  if (COUNTRY.test(parts[parts.length - 1])) out.country = parts.pop()!;

  const tail = parts[parts.length - 1];
  const sz = tail ? STATE_ZIP.exec(tail) : null;
  if (sz) {
    out.region = sz[1];
    out.postal = sz[2] ?? null;
    parts.pop();
  }

  // Whatever is left is [name?] [street?] city
  if (parts.length >= 2) out.city = parts.pop()!;
  if (parts.length === 1) {
    if (STARTS_WITH_NUMBER.test(parts[0])) out.street = parts[0];
    else out.name = parts[0];
  } else if (parts.length >= 2) {
    if (STARTS_WITH_NUMBER.test(parts[0])) {
      out.street = parts.join(", ");
    } else {
      out.name = parts[0];
      out.street = parts.slice(1).join(", ") || null;
    }
  } else if (parts.length === 0 && !out.city) {
    out.name = raw;
  }
  // A single bare token with nothing else is a name, not a city.
  if (!out.name && !out.street && out.city && !out.region && !out.country) {
    out.name = out.city;
    out.city = null;
  }
  return out;
}

/** Key used to decide whether two location strings are the same venue. */
export function venueKey(v: ParsedVenue): string {
  const base = v.name ?? v.street ?? v.raw;
  return `${base.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${(v.city ?? "").toLowerCase()}`;
}

// ── studio sessions ─────────────────────────────────────────────────────────

/**
 * The STUDIO calendar is a THIRD format, and nothing above parses it.
 *
 * In-studio headshots are booked through Squarespace/Acuity, so the entry looks
 * nothing like a gig:
 *
 *   summary:     Nick Lombardo: Standard Headshot Session // $375 (Two Dudes Photo)
 *   location:    Two Dudes Photo
 *   description: Name: Nick Lombardo / Phone: … / Email: … / Price: $375.00
 *
 * There is no crew segment, no client company, and no attendees — the "client"
 * is an individual and the venue is always the studio. Feeding these through
 * `parseGig` yields nothing usable, which is why four of Mason's galleries
 * looked absent from the calendar when they were simply on a different one in a
 * different shape.
 */
/**
 * Words that describe the JOB, not the client. Never treated as a misspelling to
 * correct, because "Headshot" vs "Headshots" is wording and wording is Mason's.
 */
const COMMON_GIG_WORD = new Set([
  "headshot", "headshots", "photo", "photos", "photography", "booth", "booths",
  "intern", "interns", "event", "events", "party", "wedding", "portrait",
  "portraits", "session", "sessions", "conference", "summit", "festival",
  "meeting", "reception", "awards", "award", "show", "setup", "standard",
  "basic", "annual", "national", "corporate", "company", "holiday",
]);

/** Housekeeping on the studio calendar — never a client. */
const STUDIO_CHORE =
  /\b(?:studio\s+(?:busy|blocked|hold)|put\s+studio|trash|recycle|maintenance|cleaning|closed|out of office|blocked|available)\b/i;

export interface StudioSession {
  clientName: string | null;
  email: string | null;
  sessionType: string | null;
  price: number | null;
  /** "Studio Busy" and similar holds are not bookings. */
  isBooking: boolean;
}

const ACUITY_FIELD = (body: string, label: string): string | null => {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im");
  const m = re.exec(body);
  return m ? m[1].trim() || null : null;
};

export function parseStudioSession(ev: CalendarEventLike): StudioSession {
  const title = (ev.summary ?? "").trim();
  const body = htmlToText(ev.description ?? "");

  /**
   * The STUDIO calendar carries BOTH Acuity bookings and hand-typed entries.
   *
   * Requiring the Acuity shape ("Name: Session // $price") threw away
   * "PG&E Headshots" — a real 234-photo job typed straight into the calendar —
   * because it has no colon and no structured body. So the test is inverted:
   * anything that is not a chore or a hold is a job, and the chores are a short,
   * knowable list.
   */
  if (STUDIO_CHORE.test(title)) {
    return { clientName: null, email: null, sessionType: null, price: null, isBooking: false };
  }

  // Prefer the structured Acuity body; the title is a formatted summary of it.
  const nameFromBody = ACUITY_FIELD(body, "Name");
  const emailFromBody = ACUITY_FIELD(body, "Email");
  const priceRaw = ACUITY_FIELD(body, "Price");

  // "Nick Lombardo: Standard Headshot Session // $375 (Two Dudes Photo)"
  const titleMatch = /^(.+?):\s*(.+?)(?:\s*\/\/\s*\$?([\d.,]+))?(?:\s*\(.*\))?$/.exec(title);

  const clientName = nameFromBody ?? titleMatch?.[1]?.trim() ?? null;
  const sessionType = titleMatch?.[2]?.replace(/\s*\/\/.*$/, "").trim() ?? null;
  const price =
    priceRaw ? Number(priceRaw.replace(/[^0-9.]/g, "")) || null
    : titleMatch?.[3] ? Number(titleMatch[3].replace(/[^0-9.]/g, "")) || null
    : null;

  // A hand-typed entry has no colon, so the whole title is the client.
  const resolvedName = clientName ?? (title || null);

  return {
    clientName: resolvedName,
    email: emailFromBody ? emailFromBody.toLowerCase() : null,
    sessionType,
    price,
    isBooking: !!resolvedName,
  };
}

// ── suggesting a gallery name ───────────────────────────────────────────────

export interface NameSuggestion {
  suggested: string;
  /** Why it differs — shown next to the Accept button so the change is legible. */
  reasons: string[];
  /** The city, when the calendar knows one the name does not already carry.
   *  Offered as a hint the caller may apply — never folded into the name, since
   *  whether a gallery name carries its city is Mason's convention to set. */
  cityHint?: string | null;
  /** False when the current name is already fine; the card should stay quiet. */
  worthChanging: boolean;
}

/**
 * Acronyms that stay shouting.
 *
 * Explicit, with NO generic "short all-caps word" catch-all. That catch-all was
 * the bug: in "NYC PHOTO BOOTH" every word is uppercase, so it preserved PHOTO
 * and BOOTH as acronyms and the all-caps name came back unchanged — which is the
 * exact thing this function exists to fix. In a shouted title, case carries no
 * information about what is an acronym, so only a known list can tell.
 */
const KNOWN_UPPER = /^(?:SKO|HDC|NYC|LA|SF|DC|SLC|MUA|DT|CEO|CTO|EOY|BBQ|VIP|AI|IT|HR|PR|QA|UK|CEA|DAIS|NASAI|HBCU|SDP|SB)$/;
/** Lowercase inside a title unless first or last. */
const MINOR = new Set(["a","an","the","and","or","but","for","of","in","on","at","to","by","vs","with"]);

/** Brands whose own casing is the correct casing. */
const BRAND_CASE: Record<string, string> = {
  ebay: "eBay", iphone: "iPhone", ipad: "iPad", youtube: "YouTube",
  linkedin: "LinkedIn", tiktok: "TikTok", docusign: "DocuSign",
  // "College Board" is two words (Mason, 2026-08-13). Appfolio is deliberately
  // absent: the company brands itself AppFolio but Mason writes Appfolio, and
  // the point of this is to reduce his editing, not to correct his house style.
  collegeboard: "College Board", purestorage: "Pure Storage",
  "pg&e": "PG&E", sonos: "Sonos", paypal: "PayPal",
};

/**
 * Is this name mostly shouting?
 *
 * ONE definition, used by both the title-caser and the suggester. They had two,
 * and the strict one lost: "eBay NATIONAL INTERNS DAY" is not 100% uppercase
 * because of the brand's lowercase "e", so the loudest name in the archive was
 * treated as deliberate capitalisation and left alone. Proportional, and
 * requiring one genuinely shouted word so "PG&E" alone does not qualify.
 */
export function isShoutedName(raw: string): boolean {
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length <= 3) return false;
  const upper = raw.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8 && /\b[A-Z]{4,}\b/.test(raw);
}

/**
 * Title-case a gallery name without destroying the bits that are meant to shout.
 *
 * Mason: "Some people (Joey) like to use all caps and not name their events very
 * well so I'm often left cleaning it up afterwards." A naive lowercase would
 * turn NYC into Nyc and PG&E into Pg&e, which is a different kind of wrong — so
 * acronyms, brand casing and minor words are all handled explicitly.
 */
export function titleCaseEventName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  /**
   * When the name shouts, an existing uppercase word proves nothing. When it is
   * genuinely mixed case, an all-caps word was deliberate and is preserved.
   */
  const allCaps = isShoutedName(raw);

  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9&']/g, "");
      const brand = BRAND_CASE[bare.toLowerCase()];
      if (brand) return w.replace(bare, brand);

      const lower = w.toLowerCase();
      const bareLower = lower.replace(/[^a-z]/g, "");
      // Minor words first — "OF" is not an acronym, whatever its case.
      if (i !== 0 && i !== words.length - 1 && MINOR.has(bareLower)) return lower;

      if (KNOWN_UPPER.test(bare.toUpperCase())) return w.toUpperCase();
      // Mixed-case input: someone typed those capitals on purpose.
      if (!allCaps && bare.length > 1 && bare === bare.toUpperCase() && /[A-Z]/.test(bare)) return w;

      return lower
        .replace(/^([a-z])/, (c) => c.toUpperCase())
        .replace(/([\/(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}

/**
 * Propose a cleaned-up gallery name.
 *
 * ⚠️ THE OBVIOUS VERSION OF THIS IS WRONG, and it took running it over 23 real
 * galleries to see it. Taking the calendar's client name as the answer proposed
 * a rename for every single one, and most were worse:
 *
 *   Jordan x Kids Foot Locker Back to School // NYC → NYC Photo Booth // Bronx
 *   Hotel Data Conference 2026                      → HDC 2026
 *   CollegeBoard // A Dream Deferred HBCU           → College Board // Philadelphia
 *
 * The calendar name is an INTERNAL BOOKING LABEL — short, jargon-heavy, written
 * to be recognised at a glance while scheduling ("Appfolio SB", "PS What If?
 * Summit", "Anti-Booth"). The gallery name is written for the client. Mason's
 * names are usually better and a tool that argues with them every time gets
 * ignored, which costs more than it saves.
 *
 * So the calendar is consulted for SPELLING, never for wording:
 *
 *  1. Fix shouting. "NICK LAMBARDO'S HEADSHOTS" → "Nick Lombardo's Headshots".
 *     This is the actual complaint: "Joey likes to use all caps".
 *  2. Fix a misspelled name, only when the calendar plainly has the same name
 *     spelled correctly (within two characters). LAMBARDO → Lombardo.
 *  3. Otherwise leave the wording exactly alone.
 *
 * The city is offered separately as a HINT the caller may apply, not folded into
 * the name — appending it changes a convention that is Mason's to set.
 */
export function suggestEventName(
  currentName: string,
  gig: { client?: string | null; city?: string | null; venueCity?: string | null; date?: string | null }
): NameSuggestion {
  const reasons: string[] = [];
  const current = currentName.trim();
  /**
   * "Mostly shouting" rather than "entirely shouting".
   *
   * "eBay NATIONAL INTERNS DAY" is not 100% uppercase — the lowercase "e" in a
   * brand defeated a strict test, so the loudest name in the archive was left
   * exactly as it was. Judge by proportion, and require at least one genuinely
   * shouted word so "PG&E" alone does not trigger it.
   */
  const isShouted = isShoutedName(current);

  // Always start from HIS wording, merely de-shouted.
  let suggested = isShouted ? titleCaseEventName(current) : current;
  if (isShouted) reasons.push("was all caps");

  /**
   * Spelling rescue: only for a name the calendar clearly holds correctly.
   * Compares word-by-word so "LAMBARDO" finds "Lombardo" without the rest of
   * the title being replaced.
   */
  const client = (gig.client ?? "").trim();
  if (client) {
    /**
     * STRICT, because a wrong "correction" silently rewrites a client's name.
     *
     * The permissive version turned "Kids Foot Locker" into "Kids Booth Locker":
     * foot→booth is two edits, and "Booth" appears in half the calendar titles.
     * So: at least six letters, and the allowance scales with length — one edit
     * for a short word, two only for eight letters or more. LAMBARDO (8) still
     * finds Lombardo; FOOT (4) is never touched.
     */
    /**
     * Only PROPER NOUNS get corrected.
     *
     * The rescue was rewriting ordinary words: "Headshot" → "Headshots",
     * "INTERNS" → "Intern". Those are not misspellings, they are Mason's
     * wording, and changing them is the same error as replacing his whole name
     * with the calendar's label — just smaller and harder to notice. A word is
     * eligible only if the calendar capitalised it and it is not a common gig
     * word.
     */
    const clientWords = client.split(/\s+/)
      .filter((w) => /^[A-Z]/.test(w))
      .map((w) => w.replace(/[^A-Za-z'-]/g, ""))
      .filter((w) => w.length >= 6 && !COMMON_GIG_WORD.has(w.toLowerCase()));

    suggested = suggested
      .split(/\s+/)
      .map((w) => {
        // Compare without a possessive: "Lambardo's" must still find "Lombardo".
        const bare = w.replace(/[^A-Za-z'-]/g, "");
        const stem = bare.replace(/['’]s$/i, "");
        if (stem.length < 6) return w;
        for (const cw of clientWords) {
          if (stem.toLowerCase() === cw.toLowerCase()) return w;
          const allowed = stem.length >= 8 ? 2 : 1;
          const d = smallEdit(stem.toLowerCase(), cw.toLowerCase());
          if (d > 0 && d <= allowed) {
            reasons.push(`"${stem}" → "${cw}" (calendar spelling)`);
            return w.replace(stem, cw);
          }
        }
        return w;
      })
      .join(" ");
  }

  const cityHint = (gig.city ?? gig.venueCity ?? "").trim() || null;
  const saysCity =
    cityHint && new RegExp(`\\b${cityHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(suggested);

  // Nothing to offer if nothing actually changed. "DAIS 26" was being proposed
  // as "DAIS 26" merely because it is uppercase, which is noise.
  return {
    suggested,
    reasons,
    cityHint: saysCity ? null : cityHint,
    worthChanging: suggested !== current,
  };
}

/** Capped edit distance, small inputs only. */
function smallEdit(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
